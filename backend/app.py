"""
app.py — CVI Engine Web API
============================
Flask REST API for the MindstriX Farm Visualization Interface.

Routes:
    GET  /health      → Health check
    POST /api/analyze → GeoJSON polygon → vegetation index heatmap grid
    POST /api/analyze-dates → GeoJSON polygon → list of available S2 dates (last 90 days)
    POST /api/analyze-day   → GeoJSON polygon + date → single-day NDVI tile + grid
    GET  /api/sample  → Single pixel hover sampling

Architecture:
    - Pure REST API — no HTML serving (frontend is a separate React/Vite app)
    - CORS enabled for React dev server (localhost:5173)
    - All business logic lives in services/
"""

import logging
import sys
import os
import datetime

# ── Windows UTF-8 fix ────────────────────────────────────────────────────────
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from flask import Flask, request, jsonify
from flask_cors import CORS

from config import LOG_LEVEL, LOG_FORMAT, LOG_DATE, LOG_FILE, GEE_PROJECT_ID, LOOKBACK_DAYS, MAX_CLOUD_COVER_PCT
from services.gee_service import (
    initialize_gee,
    get_sentinel_composite,
    get_smooth_tile_url,
    sample_point_value,
    get_available_dates,
    get_single_day_composite,
)
from services.index_service import compute_all_indices
from services.grid_service import generate_grid, reduce_grid_values
from services.stats_service import extract_farm_statistics
from utils.geo_utils import geojson_to_ee_geometry, validate_polygon

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format=LOG_FORMAT,
    datefmt=LOG_DATE,
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
logger = logging.getLogger("app")

# ─────────────────────────────────────────────────────────────────────────────
# Flask App + CORS
# ─────────────────────────────────────────────────────────────────────────────
app = Flask(__name__)

# Allow React dev server (port 5173) — adjust origins for production
CORS(app, resources={r"/api/*": {"origins": [
    "http://localhost:5173",   # Vite dev server
    "http://localhost:4173",   # Vite preview
    "http://localhost:3000",   # fallback
]}})

# ─────────────────────────────────────────────────────────────────────────────
# EOS-style NDVI palette (continuous gradient, beige → dark green)
# ─────────────────────────────────────────────────────────────────────────────
NDVI_PALETTE = [
    '#ce1124', '#ea232a', '#f14a38', '#f57049', '#f89252', 
    '#fca95e', '#fcbe6c', '#fcd380', '#fbe495', '#faf7ab', 
    '#eff4a3', '#d6e996', '#b3d982', '#8dc86f', '#67b65d', 
    '#43a64b', '#2a923a', '#137f2a', '#096b20', '#005716', '#003c00'
]
CVI_PALETTE  = ['#ef4444', '#f59e0b', '#22c55e']


# ─────────────────────────────────────────────────────────────────────────────
# GEE Initialisation (once at startup)
# ─────────────────────────────────────────────────────────────────────────────
@app.before_request
def _init_gee_once():
    """Initialise GEE exactly once before any request is processed."""
    if not hasattr(app, "_gee_ready"):
        app._gee_ready = initialize_gee()
        if app._gee_ready:
            logger.info("GEE initialised and ready.")
        else:
            logger.error("GEE initialisation failed — analysis requests will fail.")


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "gee_ready": getattr(app, "_gee_ready", False),
        "project": GEE_PROJECT_ID,
    })


@app.route("/api/analyze", methods=["POST"])
def analyze():
    """
    POST /api/analyze

    Request body (JSON):
        { "geometry": <GeoJSON Polygon object> }

    Response (JSON):
        GeoJSON FeatureCollection with per-cell vegetation metrics + farm_summary.
    """
    if not getattr(app, "_gee_ready", False):
        return jsonify({"error": "Google Earth Engine is not initialised. Check server logs."}), 503

    body = request.get_json(silent=True)
    if not body or "geometry" not in body:
        return jsonify({"error": "Request body must contain a 'geometry' key with a GeoJSON Polygon."}), 400

    geojson_geometry = body["geometry"]

    valid, validation_error = validate_polygon(geojson_geometry)
    if not valid:
        logger.warning("Invalid polygon received: %s", validation_error)
        return jsonify({"error": validation_error}), 400

    logger.info("Analysis request received. Converting geometry to EE…")

    try:
        ee_geometry = geojson_to_ee_geometry(geojson_geometry)
        composite, collection, scene_count = get_sentinel_composite(ee_geometry)

        if composite is None:
            return jsonify({
                "error": "No cloud-free Sentinel-2 imagery found for this area in the last 3 months."
            }), 200

        indexed_image   = compute_all_indices(composite)
        grid            = generate_grid(ee_geometry)
        result_geojson  = reduce_grid_values(indexed_image, grid, ee_geometry)
        farm_summary    = extract_farm_statistics(indexed_image, collection, ee_geometry, scene_count)
        result_geojson["farm_summary"] = farm_summary

        # Include the polygon coordinates for boundary rendering
        result_geojson["farm_boundary"] = geojson_geometry

        # Tile URLs (kept for optional overlay use)
        index_vis = {'min': 0.0, 'max': 1.0, 'palette': NDVI_PALETTE}
        cvi_vis   = {'min': 0.0, 'max': 1.0, 'palette': CVI_PALETTE}

        index_tiles = {}
        for band in ["NDVI", "EVI", "SAVI", "NDMI", "NDWI", "GNDVI"]:
            index_tiles[f"{band.lower()}_tile_url"] = get_smooth_tile_url(
                indexed_image, ee_geometry, band, index_vis
            )
        index_tiles["cvi_tile_url"] = get_smooth_tile_url(indexed_image, ee_geometry, "CVI", cvi_vis)

        result_geojson["ndvi_tile_url"] = index_tiles["ndvi_tile_url"]
        result_geojson["tile_url"]      = index_tiles["cvi_tile_url"]
        result_geojson["index_tiles"]   = index_tiles

        app._last_indexed_image = indexed_image
        app._last_ee_geometry   = ee_geometry

        logger.info(
            "Analysis complete — %d scenes, %d grid cells, confidence=%.4f",
            scene_count,
            len(result_geojson.get("features", [])),
            farm_summary["confidence"],
        )
        return jsonify(result_geojson), 200

    except Exception as exc:
        logger.exception("Pipeline error: %s", exc)
        return jsonify({"error": f"Pipeline error: {str(exc)}"}), 500


@app.route("/api/analyze-dates", methods=["POST"])
def analyze_dates():
    """
    POST /api/analyze-dates

    Request body (JSON):
        { "geometry": <GeoJSON Polygon object> }

    Response (JSON):
        { "dates": ["2026-01-10", "2026-01-15", ...] }
    
    Returns all available Sentinel-2 image dates for the polygon in the last 90 days.
    """
    if not getattr(app, "_gee_ready", False):
        return jsonify({"error": "GEE not initialised"}), 503

    body = request.get_json(silent=True)
    if not body or "geometry" not in body:
        return jsonify({"error": "Missing geometry"}), 400

    geojson_geometry = body["geometry"]
    valid, validation_error = validate_polygon(geojson_geometry)
    if not valid:
        return jsonify({"error": validation_error}), 400

    try:
        ee_geometry = geojson_to_ee_geometry(geojson_geometry)
        dates = get_available_dates(ee_geometry)
        logger.info("Found %d available dates for the polygon.", len(dates))
        return jsonify({"dates": dates}), 200
    except Exception as exc:
        logger.exception("Error fetching dates: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/analyze-day", methods=["POST"])
def analyze_day():
    """
    POST /api/analyze-day

    Request body (JSON):
        { "geometry": <GeoJSON Polygon object>, "date": "2026-01-15" }

    Response (JSON):
        { "ndvi_tile_url": "...", "date": "2026-01-15", "features": [...], "farm_boundary": {...} }
    
    Returns NDVI heatmap tile URL + grid data for a single specific date.
    """
    if not getattr(app, "_gee_ready", False):
        return jsonify({"error": "GEE not initialised"}), 503

    body = request.get_json(silent=True)
    if not body or "geometry" not in body or "date" not in body:
        return jsonify({"error": "Missing geometry or date"}), 400

    geojson_geometry = body["geometry"]
    target_date = body["date"]

    valid, validation_error = validate_polygon(geojson_geometry)
    if not valid:
        return jsonify({"error": validation_error}), 400

    try:
        ee_geometry = geojson_to_ee_geometry(geojson_geometry)
        composite, scene_count = get_single_day_composite(ee_geometry, target_date)

        if composite is None:
            return jsonify({"error": f"No imagery found for date {target_date}"}), 200

        indexed_image = compute_all_indices(composite)
        grid = generate_grid(ee_geometry)
        result_geojson = reduce_grid_values(indexed_image, grid, ee_geometry)
        
        farm_summary = extract_farm_statistics(indexed_image, None, ee_geometry, scene_count)
        result_geojson["farm_summary"] = farm_summary

        # Generate tile URL for NDVI
        index_vis = {'min': 0.0, 'max': 1.0, 'palette': NDVI_PALETTE}
        ndvi_tile_url = get_smooth_tile_url(indexed_image, ee_geometry, "NDVI", index_vis)

        result_geojson["ndvi_tile_url"] = ndvi_tile_url
        result_geojson["date"] = target_date
        result_geojson["scene_count"] = scene_count
        result_geojson["farm_boundary"] = geojson_geometry

        # Store for hover sampling
        app._last_indexed_image = indexed_image
        app._last_ee_geometry = ee_geometry

        logger.info("Day analysis complete for %s — %d scenes", target_date, scene_count)
        return jsonify(result_geojson), 200

    except Exception as exc:
        logger.exception("Day analysis error: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/sample", methods=["GET"])
def sample():
    """
    GET /api/sample?lat=...&lng=...&band=NDVI

    Samples a single pixel value for hover tooltips.
    """
    if not getattr(app, "_gee_ready", False):
        return jsonify({"error": "GEE not initialised"}), 503

    indexed_image = getattr(app, "_last_indexed_image", None)
    if indexed_image is None:
        return jsonify({"error": "No analysis available. Run an analysis first."}), 404

    try:
        lat = float(request.args.get("lat"))
        lng = float(request.args.get("lng"))
    except (TypeError, ValueError):
        return jsonify({"error": "lat and lng are required numeric parameters."}), 400

    band = request.args.get("band", "NDVI").upper()
    valid_bands = ["NDVI", "EVI", "SAVI", "NDMI", "NDWI", "GNDVI", "CVI"]
    if band not in valid_bands:
        return jsonify({"error": f"Invalid band. Must be one of: {valid_bands}"}), 400

    value = sample_point_value(indexed_image, lat, lng, band, scale=10)
    return jsonify({"value": value, "band": band}), 200


# ─────────────────────────────────────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logger.info("Starting CVI Engine Backend — MindstriX")
    app.run(host="0.0.0.0", port=5000, debug=True)

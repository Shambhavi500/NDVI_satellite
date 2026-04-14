"""
services/grid_service.py — Grid Generation and Value Reduction Layer
=====================================================================
Responsibilities:
    - Divide a farm polygon into a regular grid of cells
    - Auto-scale grid resolution to stay within MAX_GRID_CELLS cap
    - Reduce vegetation index values per cell using ee.Reducer.mean()
    - Apply spatial Gaussian smoothing to remove per-pixel noise (EOS-style)
    - Attach interpretation labels to each cell
    - Convert the result to a GeoJSON FeatureCollection for the frontend

Grid Strategy:
    - Uses ee.Geometry.coveringGrid() with .atScale() for correct metre-based tiling
    - Default scale: 10 m (Sentinel-2 native resolution)
    - Auto-increments scale in GRID_SCALE_STEP_M steps if cell count > MAX_GRID_CELLS

Smoothing Strategy (EOS-equivalent):
    - After reducing raw pixel values per cell, each cell's index values are
      replaced by a Gaussian-weighted average of all cells within a 2× spacing
      search radius.  sigma = 1.2 × average cell spacing.
    - This removes single-cell noise / cloud artifacts and produces the smooth
      continuous gradient that EOS displays.
"""

import logging
import math
import ee

from config import (
    CVI_THRESHOLDS,
    GRID_SCALE_M,
    GRID_SCALE_STEP_M,
    MAX_GRID_CELLS,
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Interpretation Engine
# ─────────────────────────────────────────────────────────────────────────────

def _interpret_cvi(value: float | None) -> str:
    """
    Map a CVI float value to a human-readable health interpretation.

    Thresholds (from config.py CVI_THRESHOLDS):
        cvi > 0.6  → "Healthy vegetation"
        cvi > 0.3  → "Moderate vegetation, possible stress"
        else       → "Poor vegetation, needs attention"
    """
    if value is None:
        return "No data available"
    for threshold in sorted(CVI_THRESHOLDS.keys(), reverse=True):
        if value >= threshold:
            return CVI_THRESHOLDS[threshold]
    return "Poor vegetation, needs attention"


# ─────────────────────────────────────────────────────────────────────────────
# Grid Generation
# ─────────────────────────────────────────────────────────────────────────────

def generate_grid(ee_geometry: ee.Geometry, scale: int = GRID_SCALE_M) -> ee.FeatureCollection:
    """
    Create a regular grid of cells covering the farm polygon.

    Uses ee.Projection.atScale() so that 'scale' is always treated as metres,
    regardless of the underlying projection's native units (fixes the EPSG:4326
    degrees-vs-metres ambiguity in coveringGrid).

    Auto-escalates scale if the resulting cell count would exceed MAX_GRID_CELLS.

    Args:
        ee_geometry: GEE geometry representing the farm polygon boundary.
        scale      : Initial grid resolution in metres (default: GRID_SCALE_M).

    Returns:
        ee.FeatureCollection of grid cell polygons.
    """
    # ── Find the right scale ──────────────────────────────────────────────────
    # .atScale(n) sets scale in METRES, not in the projection's native degrees.
    current_scale = scale
    proj  = ee.Projection('EPSG:4326').atScale(current_scale)
    grid  = ee_geometry.coveringGrid(proj)
    cell_count = grid.size().getInfo()

    logger.info("Initial grid at %dm: %d cells", current_scale, cell_count)

    while cell_count > MAX_GRID_CELLS:
        current_scale += GRID_SCALE_STEP_M
        proj  = ee.Projection('EPSG:4326').atScale(current_scale)
        grid  = ee_geometry.coveringGrid(proj)
        cell_count = grid.size().getInfo()
        logger.info(
            "Grid too large — scaling up to %dm: %d cells",
            current_scale, cell_count,
        )

    logger.info(
        "Final grid: scale=%dm, cells=%d (max allowed: %d)",
        current_scale, cell_count, MAX_GRID_CELLS,
    )
    return grid


# ─────────────────────────────────────────────────────────────────────────────
# Value Reduction
# ─────────────────────────────────────────────────────────────────────────────

def reduce_grid_values(
    indexed_image: ee.Image,
    grid: ee.FeatureCollection,
    ee_geometry: ee.Geometry,
    scale: int = GRID_SCALE_M,
) -> dict:
    """
    Reduce mean index values for each grid cell and return as GeoJSON.

    For each cell in the grid:
        1. Compute mean NDVI, EVI, SAVI, NDMI, NDWI, GNDVI, CVI
        2. Attach CVI interpretation label
        3. Round values to 4 decimal places

    Args:
        indexed_image: Multi-band ee.Image containing all computed indices.
        grid          : ee.FeatureCollection of grid cells from generate_grid().
        ee_geometry   : Original farm polygon (used for spatial bounds).
        scale         : Pixel sampling resolution in metres.

    Returns:
        GeoJSON FeatureCollection dict (Python dict, ready for jsonify()).
    """
    index_bands = ["NDVI", "EVI", "SAVI", "NDMI", "NDWI", "GNDVI", "CVI"]
    image_subset = indexed_image.select(index_bands)

    def _reduce_cell(cell: ee.Feature) -> ee.Feature:
        """Reduce mean index values for a single grid cell."""
        stats = image_subset.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=cell.geometry(),
            scale=scale,
            maxPixels=1e8,
        )
        return cell.set(stats)

    # ── Server-side reduction (lazy) ─────────────────────────────────────────
    reduced = grid.map(_reduce_cell)

    # ── Materialise to GeoJSON ────────────────────────────────────────────────
    logger.info("Reducing index values per grid cell…")
    raw_geojson = reduced.getInfo()   # triggers GEE computation

    # ── Post-process: round values + attach interpretation ────────────────────
    features = []
    sums = {b.lower(): 0 for b in index_bands}
    counts = {b.lower(): 0 for b in index_bands}

    for feature in raw_geojson.get("features", []):
        props = feature.get("properties", {})
        rounded_props = {}
        for band in index_bands:
            val = props.get(band)
            b_key = band.lower()
            rounded_props[b_key] = round(val, 4) if val is not None else None
            if val is not None:
                sums[b_key] += val
                counts[b_key] += 1

        cvi_val = rounded_props.get("cvi")
        rounded_props["interpretation"] = _interpret_cvi(cvi_val)

        features.append({
            "type": "Feature",
            "geometry": feature["geometry"],
            "properties": rounded_props,
        })

    # ── Spatial Gaussian smoothing (EOS-style noise removal) ─────────────────
    # Replace each cell's raw pixel-mean with a Gaussian-weighted average of
    # neighbouring cells.  This suppresses single-cell cloud artifacts and
    # sensor noise, giving the smooth continuous gradient EOS displays.
    smooth_bands = [b.lower() for b in index_bands if b != "CVI"]
    features = _smooth_grid_values(features, smooth_bands, sigma_factor=0.6)

    # Re-attach CVI interpretation after smoothing (CVI is derived, not smoothed)
    for feat in features:
        feat["properties"]["interpretation"] = _interpret_cvi(
            feat["properties"].get("cvi")
        )

    # Summary Log
    log_summary = " | ".join([
        f"{b.upper()}: {(sums[b]/counts[b]):.3f}" if counts[b] > 0 else f"{b.upper()}: N/A"
        for b in [b.lower() for b in index_bands]
    ])
    logger.info("Farm Average Indices: %s", log_summary)
    logger.info("Grid reduction complete: %d features returned (smoothed).", len(features))

    return {
        "type": "FeatureCollection",
        "features": features,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Spatial Gaussian Smoothing
# ─────────────────────────────────────────────────────────────────────────────

def _smooth_grid_values(
    features: list,
    bands: list[str],
    sigma_factor: float = 1.2,
) -> list:
    """
    Apply a spatial Gaussian smoothing pass to per-cell index values.

    For each cell i, replace band_value[i] with:

        smoothed[i] = Σ_j ( w_ij · value_j ) / Σ_j w_ij

        where  w_ij = exp( -d_ij² / (2σ²) )
               σ    = sigma_factor × average nearest-neighbour spacing
               d_ij = Euclidean distance between cell centroids (degrees)

    Only cells within a 3σ search radius contribute to the blend.
    Cells with null values are excluded from both numerator and denominator.

    Args:
        features    : List of GeoJSON Feature dicts with lowercase band properties.
        bands       : Band keys to smooth (e.g. ['ndvi', 'evi', ...]).
        sigma_factor: Controls smoothing width.  1.2 ≈ EOS-level smoothing.
                      Larger → wider blend, softer map.
    """
    if len(features) < 2:
        return features

    # ── Extract cell centroids ────────────────────────────────────────────────
    centroids: list[tuple[float, float]] = []
    for feat in features:
        coords = feat["geometry"]["coordinates"][0]
        cx = sum(c[0] for c in coords) / len(coords)
        cy = sum(c[1] for c in coords) / len(coords)
        centroids.append((cx, cy))

    # ── Estimate average nearest-neighbour spacing (degrees) ─────────────────
    n = len(centroids)
    sample_step = max(1, n // 20)
    total_nn, cnt = 0.0, 0
    for i in range(0, n, sample_step):
        min_d = float('inf')
        for j in range(n):
            if j == i:
                continue
            dx = centroids[i][0] - centroids[j][0]
            dy = centroids[i][1] - centroids[j][1]
            d  = math.sqrt(dx * dx + dy * dy)
            if d < min_d:
                min_d = d
        if min_d < float('inf'):
            total_nn += min_d
            cnt += 1

    if cnt == 0:
        return features

    avg_spacing = total_nn / cnt
    sigma       = avg_spacing * sigma_factor
    inv_2sig2   = 1.0 / (2.0 * sigma * sigma)
    search_r2   = (sigma * 3.0) ** 2   # 3σ cutoff

    logger.info(
        "Spatial smoothing: %d cells, avg_spacing=%.6f°, sigma=%.6f° (factor=%.1f)",
        n, avg_spacing, sigma, sigma_factor,
    )

    # ── Gaussian blend ────────────────────────────────────────────────────────
    smoothed: list[dict] = []
    for i, feat in enumerate(features):
        cx_i, cy_i = centroids[i]
        new_props = dict(feat["properties"])   # shallow copy

        for band in bands:
            if new_props.get(band) is None:
                continue

            w_sum, v_sum = 0.0, 0.0
            for j in range(n):
                val_j = features[j]["properties"].get(band)
                if val_j is None:
                    continue
                dx = cx_i - centroids[j][0]
                dy = cy_i - centroids[j][1]
                d2 = dx * dx + dy * dy
                if d2 > search_r2:
                    continue
                w = math.exp(-d2 * inv_2sig2)
                w_sum += w
                v_sum += w * val_j

            if w_sum > 0:
                new_props[band] = round(v_sum / w_sum, 4)

        smoothed.append({
            "type":       "Feature",
            "geometry":   feat["geometry"],
            "properties": new_props,
        })

    return smoothed

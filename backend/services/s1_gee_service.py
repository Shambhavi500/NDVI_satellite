"""
services/s1_gee_service.py — Sentinel-1 SAR Data Layer
========================================================
Responsibilities:
    - Fetch and pre-process Sentinel-1 GRD imagery for a given polygon
    - Apply speckle filtering (Lee-equivalent focal_mean)
    - Generate smooth tile URLs for radar band visualization
    - Sample single-pixel values for hover tooltips
    - List available Sentinel-1 acquisition dates

This module mirrors gee_service.py but for SAR (radar) data instead of
optical (Sentinel-2) data.
"""

import logging
import datetime
import ee

from config import (
    S1_DATASET,
    S1_BANDS,
    S1_SPECKLE_RADIUS,
    LOOKBACK_DAYS,
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Speckle Filtering
# ─────────────────────────────────────────────────────────────────────────────

def _apply_speckle_filter(image: ee.Image) -> ee.Image:
    """
    Apply Lee-equivalent speckle filter using focal_mean.

    SAR imagery suffers from inherent speckle noise.  A focal_mean with a
    circular kernel of S1_SPECKLE_RADIUS pixels acts as a simple but
    effective de-speckling filter (equivalent to a box-car Lee filter).

    Args:
        image: Raw Sentinel-1 GRD ee.Image in dB.

    Returns:
        ee.Image with reduced speckle noise.
    """
    return image.focal_mean(
        radius=S1_SPECKLE_RADIUS,
        kernelType='circle',
        units='pixels',
    )


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def get_s1_composite(
    ee_geometry: ee.Geometry,
    lookback_days: int = LOOKBACK_DAYS,
) -> tuple[ee.Image | None, ee.ImageCollection | None, int]:
    """
    Fetch a speckle-filtered Sentinel-1 median composite for the given geometry.

    Pipeline:
        1. Compute date window: today → today - lookback_days
        2. Filter S1 collection by geometry, date, instrument mode (IW),
           polarisation (VV+VH), and orbit pass (descending)
        3. Apply speckle filter to every image
        4. Reduce to median composite

    Args:
        ee_geometry  : GEE geometry (farm polygon).
        lookback_days: How many days back from today to search.

    Returns:
        Tuple of (composite_image | None, raw_collection | None, scene_count)
    """
    end_date   = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=lookback_days)

    start_str = start_date.isoformat()
    end_str   = end_date.isoformat()

    logger.info(
        "Fetching S1 composite | %s → %s | lookback=%d days",
        start_str, end_str, lookback_days,
    )

    collection = (
        ee.ImageCollection(S1_DATASET)
        .filterBounds(ee_geometry)
        .filterDate(start_str, end_str)
        .filter(ee.Filter.eq('instrumentMode', 'IW'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
        .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
        .select([S1_BANDS["VV"], S1_BANDS["VH"]])
        .map(_apply_speckle_filter)
    )

    scene_count: int = collection.size().getInfo()
    logger.info("S1 scenes found after filtering: %d", scene_count)

    if scene_count == 0:
        logger.warning(
            "No Sentinel-1 scenes found. "
            "Try widening LOOKBACK_DAYS in config.py."
        )
        return None, None, 0

    composite = collection.median()
    logger.info("S1 median composite built from %d scene(s).", scene_count)
    return composite, collection, scene_count


def get_s1_smooth_tile_url(
    image: ee.Image,
    ee_geometry: ee.Geometry,
    band: str,
    vis_params: dict,
) -> str | None:
    """
    Generate a smooth GEE tile URL for a single Sentinel-1 band.

    Unlike Sentinel-2, radar bands include negative dB values, so we do NOT
    mask values < 0.

    Args:
        image      : Multi-band ee.Image containing computed S1 indices.
        ee_geometry: Farm polygon geometry for clipping.
        band       : Band name to visualize (e.g. 'VV', 'SMI', 'RVI').
        vis_params : Dict with 'min', 'max', 'palette' keys.

    Returns:
        Tile URL string or None on failure.
    """
    try:
        smooth_image = (
            image
            .select(band)
            .clip(ee_geometry)
            .resample('bicubic')
            .reproject(crs='EPSG:4326', scale=10)
            .focal_mean(2, 'circle', 'pixels')
        )

        map_id_dict = smooth_image.getMapId(vis_params)
        url = map_id_dict['tile_fetcher'].url_format
        logger.info("S1 smooth tile URL generated for band=%s", band)
        return url
    except Exception as exc:
        logger.error("Failed to generate S1 smooth tile URL for %s: %s", band, exc)
        return None


def sample_s1_point_value(
    image: ee.Image,
    lat: float,
    lng: float,
    band: str = "VV",
    scale: int = 10,
) -> float | None:
    """
    Sample a single pixel value from a Sentinel-1 image at the given coordinate.

    Args:
        image: Multi-band ee.Image with computed S1 indices.
        lat  : Latitude (WGS-84).
        lng  : Longitude (WGS-84).
        band : Band name to sample (e.g. 'VV', 'VH', 'SMI', 'RVI').
        scale: Spatial resolution in metres.

    Returns:
        Float value or None if unavailable.
    """
    try:
        point = ee.Geometry.Point([lng, lat])
        result = image.select(band).reduceRegion(
            reducer=ee.Reducer.first(),
            geometry=point,
            scale=scale,
            maxPixels=1,
        ).getInfo()

        value = result.get(band)
        if value is not None:
            return round(value, 4)
        return None
    except Exception as exc:
        logger.error("S1 point sampling failed at (%.4f, %.4f): %s", lat, lng, exc)
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Daily Analysis Support
# ─────────────────────────────────────────────────────────────────────────────

def get_s1_available_dates(
    ee_geometry: ee.Geometry,
    lookback_days: int = LOOKBACK_DAYS,
) -> list[str]:
    """
    Return sorted list of unique Sentinel-1 acquisition dates (YYYY-MM-DD)
    for the given geometry in the last N days.
    """
    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=lookback_days)

    collection = (
        ee.ImageCollection(S1_DATASET)
        .filterBounds(ee_geometry)
        .filterDate(start_date.isoformat(), end_date.isoformat())
        .filter(ee.Filter.eq('instrumentMode', 'IW'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
        .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
    )

    def _get_date(img):
        d = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd")
        return ee.Feature(None, {"date": d})

    date_fc = collection.map(_get_date)
    date_list = date_fc.aggregate_array("date").distinct().sort().getInfo()

    logger.info(
        "S1 available dates (%s → %s): %d unique dates found",
        start_date.isoformat(), end_date.isoformat(), len(date_list),
    )
    return date_list


def get_s1_single_day_composite(
    ee_geometry: ee.Geometry,
    target_date: str,
) -> tuple[ee.Image | None, int]:
    """
    Fetch a Sentinel-1 composite for a single specific date.

    Uses a ±1 day window to account for orbital timing.

    Args:
        ee_geometry: Farm polygon geometry.
        target_date: ISO date string, e.g. '2026-04-15'.

    Returns:
        Tuple of (composite_image | None, scene_count)
    """
    target = datetime.date.fromisoformat(target_date)
    start = target.isoformat()
    end = (target + datetime.timedelta(days=1)).isoformat()

    logger.info("Fetching S1 for single day: %s (window %s → %s)", target_date, start, end)

    collection = (
        ee.ImageCollection(S1_DATASET)
        .filterBounds(ee_geometry)
        .filterDate(start, end)
        .filter(ee.Filter.eq('instrumentMode', 'IW'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
        .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
        .select([S1_BANDS["VV"], S1_BANDS["VH"]])
        .map(_apply_speckle_filter)
    )

    scene_count = collection.size().getInfo()
    logger.info("S1 single-day scenes found: %d", scene_count)

    if scene_count == 0:
        return None, 0

    composite = collection.median()
    return composite, scene_count

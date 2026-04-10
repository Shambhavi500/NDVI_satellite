"""
services/gee_service.py — Google Earth Engine Data Layer
=========================================================
Responsibilities:
    - Initialise the Earth Engine Python API
    - Fetch and pre-process Sentinel-2 imagery for a given polygon
    - Generate smooth, bicubic-resampled tile URLs for heatmap layers
    - Sample single-pixel values at arbitrary coordinates (hover support)

This module is the only place in the codebase that talks directly to GEE.
All other modules receive ee.Image or ee.Geometry objects from here.
"""

import logging
import datetime
import ee

from config import (
    BANDS,
    DATASET,
    GEE_PROJECT_ID,
    LOOKBACK_DAYS,
    MAX_CLOUD_COVER_PCT,
    SCL_MASK_VALUES,
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Initialisation
# ─────────────────────────────────────────────────────────────────────────────

def initialize_gee() -> bool:
    """
    Authenticate and initialise the Google Earth Engine Python API.

    Uses the stored OAuth2 credentials from:
        ~/.config/earthengine/credentials
    (created by running `earthengine authenticate` once).

    If GEE_PROJECT_ID is not set in .env the function logs a clear
    actionable message and returns False rather than hanging on a
    browser-based auth flow.

    Returns:
        bool: True on success, False on failure.
    """
    if not GEE_PROJECT_ID:
        logger.error(
            "GEE_PROJECT_ID is not set. "
            "Create a .env file in the backend directory with:\n"
            "    GEE_PROJECT_ID=your-cloud-project-id\n"
            "Find your project ID at https://console.cloud.google.com"
        )
        return False

    import os
    cred_path = os.path.expanduser("~/.config/earthengine/credentials")
    cred_exists = os.path.exists(cred_path)

    try:
        logger.info("Initialising GEE (project: %s)…", GEE_PROJECT_ID)
        if not cred_exists:
            # No stored credentials — run the one-time browser auth flow
            logger.info(
                "No GEE credentials found. Launching browser auth flow…"
            )
            ee.Authenticate()
        else:
            logger.info("Using stored GEE credentials from %s", cred_path)

        ee.Initialize(project=GEE_PROJECT_ID)
        # Quick connectivity test
        _ = ee.Number(1).getInfo()
        logger.info("GEE initialised and connectivity verified.")
        return True
    except Exception as exc:
        logger.error(
            "GEE initialisation failed: %s\n"
            "Check that:\n"
            "  1. GEE_PROJECT_ID in .env matches a project with Earth Engine API enabled\n"
            "  2. Your account has access to that project\n"
            "  3. Run `earthengine authenticate` in your venv if credentials are stale",
            exc,
        )
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Cloud Masking (SCL-based per-pixel)
# ─────────────────────────────────────────────────────────────────────────────

def _mask_clouds_scl(image: ee.Image) -> ee.Image:
    """
    Apply per-pixel cloud/shadow masking using Sentinel-2 SCL band.

    SCL classes removed: 3 (Cloud Shadow), 8 (Medium Cloud),
                         9 (High Cloud),   10 (Cirrus)

    Args:
        image: Raw Sentinel-2 SR ee.Image containing the SCL band.

    Returns:
        ee.Image with cloudy/shadowed pixels masked out.
    """
    scl = image.select(BANDS["SCL"])
    mask = ee.Image.constant(1)
    for bad_class in SCL_MASK_VALUES:
        mask = mask.And(scl.neq(bad_class))
    return image.updateMask(mask)


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def get_sentinel_composite(
    ee_geometry: ee.Geometry,
    lookback_days: int = LOOKBACK_DAYS,
    cloud_pct: int = MAX_CLOUD_COVER_PCT,
) -> tuple[ee.Image | None, ee.ImageCollection | None, int]:
    """
    Fetch a cloud-free Sentinel-2 median composite for the given geometry.

    Pipeline:
        1. Compute date window: today → today - lookback_days
        2. Filter S2 collection by geometry, date, cloud cover
        3. Apply per-pixel SCL cloud/shadow mask to every image
        4. Scale reflectance: DN ÷ 10000 → real reflectance [0.0, 1.0]
        5. Reduce to median composite

    Args:
        ee_geometry  : GEE geometry (farm polygon or bounding box).
        lookback_days: How many days back from today to search.
        cloud_pct    : Max allowed CLOUDY_PIXEL_PERCENTAGE per scene.

    Returns:
        Tuple of (composite_image | None, raw_collection | None, scene_count)
        composite_image is None if no clean scenes are found.
    """
    end_date   = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=lookback_days)

    start_str = start_date.isoformat()
    end_str   = end_date.isoformat()

    logger.info(
        "Fetching S2 composite | %s → %s | cloud<=%d%% | lookback=%d days",
        start_str, end_str, cloud_pct, lookback_days,
    )

    collection = (
        ee.ImageCollection(DATASET)
        .filterBounds(ee_geometry)
        .filterDate(start_str, end_str)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud_pct))
        .map(_mask_clouds_scl)
        .map(lambda img: img.divide(10000))  # scale DN → reflectance
    )

    scene_count: int = collection.size().getInfo()
    logger.info("Scenes found after filtering: %d", scene_count)

    if scene_count == 0:
        logger.warning(
            "No clean Sentinel-2 scenes found. "
            "Try widening LOOKBACK_DAYS or MAX_CLOUD_COVER_PCT in config.py."
        )
        return None, None, 0

    composite = collection.median()
    logger.info("Median composite built from %d scene(s).", scene_count)
    return composite, collection, scene_count


def get_smooth_tile_url(
    image: ee.Image,
    ee_geometry: ee.Geometry,
    band: str,
    vis_params: dict,
) -> str | None:
    """
    Generate a smooth, bicubic-resampled GEE tile URL for a single band.

    Pipeline:
        1. Select the target band
        2. Clip strictly to the farm polygon
        3. Apply bicubic resampling to eliminate pixelation
        4. Mask invalid values (< 0 for vegetation indices)
        5. Generate map tile URL with continuous gradient palette

    Args:
        image      : Multi-band ee.Image containing computed indices.
        ee_geometry: Farm polygon geometry for clipping.
        band       : Band name to visualize (e.g. 'NDVI', 'CVI').
        vis_params : Dict with 'min', 'max', 'palette' keys.

    Returns:
        Tile URL string or None on failure.
    """
    try:
        # Select band → clip to polygon → mask negatives → bicubic resample → reproject
        smooth_image = (
            image
            .select(band)
            .clip(ee_geometry)
            .updateMask(image.select(band).gte(0))
            .resample('bicubic')
            .reproject(crs='EPSG:4326', scale=10)
            .focal_mean(2, 'circle', 'pixels')
        )

        map_id_dict = smooth_image.getMapId(vis_params)
        url = map_id_dict['tile_fetcher'].url_format
        logger.info("Smooth tile URL generated for band=%s", band)
        return url
    except Exception as exc:
        logger.error("Failed to generate smooth tile URL for %s: %s", band, exc)
        return None


def get_image_tile_url(image: ee.Image, vis_params: dict) -> str | None:
    """
    Get a temporary GEE map tile URL for the given image and visualization params.
    Legacy function kept for backward compatibility.
    """
    try:
        map_id_dict = ee.data.getMapId({'image': image, **vis_params})
        return map_id_dict['tile_fetcher'].url_format
    except Exception as exc:
        logger.error("Failed to generate tile URL: %s", exc)
        return None


def sample_point_value(
    image: ee.Image,
    lat: float,
    lng: float,
    band: str = "NDVI",
    scale: int = 10,
) -> float | None:
    """
    Sample a single pixel value at the given coordinate.

    Used for real-time hover tooltips — extracts the value of a specific
    vegetation index at the cursor location.

    Args:
        image: Multi-band ee.Image with computed indices.
        lat  : Latitude (WGS-84).
        lng  : Longitude (WGS-84).
        band : Band name to sample (default: 'NDVI').
        scale: Spatial resolution in metres (default: 10m for Sentinel-2).

    Returns:
        Float value of the band at (lat, lng), or None if masked/unavailable.
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
        logger.error("Point sampling failed at (%.4f, %.4f): %s", lat, lng, exc)
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Daily Analysis Support
# ─────────────────────────────────────────────────────────────────────────────

def get_available_dates(
    ee_geometry: ee.Geometry,
    lookback_days: int = LOOKBACK_DAYS,
    cloud_pct: int = MAX_CLOUD_COVER_PCT,
) -> list[str]:
    """
    Return a sorted list of unique acquisition dates (YYYY-MM-DD)
    for Sentinel-2 scenes covering the given geometry in the last N days.
    """
    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=lookback_days)

    collection = (
        ee.ImageCollection(DATASET)
        .filterBounds(ee_geometry)
        .filterDate(start_date.isoformat(), end_date.isoformat())
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud_pct))
    )

    # Extract dates from image properties
    def _get_date(img):
        d = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd")
        return ee.Feature(None, {"date": d})

    date_fc = collection.map(_get_date)
    date_list = date_fc.aggregate_array("date").distinct().sort().getInfo()

    logger.info(
        "Available dates (%s → %s): %d unique dates found",
        start_date.isoformat(), end_date.isoformat(), len(date_list),
    )
    return date_list


def get_single_day_composite(
    ee_geometry: ee.Geometry,
    target_date: str,
    cloud_pct: int = MAX_CLOUD_COVER_PCT,
) -> tuple[ee.Image | None, int]:
    """
    Fetch a Sentinel-2 composite for a single specific date.

    Uses a ±1 day window to account for orbital timing.

    Args:
        ee_geometry: Farm polygon geometry.
        target_date: ISO date string, e.g. '2026-01-15'.
        cloud_pct  : Max allowed cloud cover percentage.

    Returns:
        Tuple of (composite_image | None, scene_count)
    """
    target = datetime.date.fromisoformat(target_date)
    start = (target - datetime.timedelta(days=0)).isoformat()
    end = (target + datetime.timedelta(days=1)).isoformat()

    logger.info("Fetching S2 for single day: %s (window %s → %s)", target_date, start, end)

    collection = (
        ee.ImageCollection(DATASET)
        .filterBounds(ee_geometry)
        .filterDate(start, end)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud_pct))
        .map(_mask_clouds_scl)
        .map(lambda img: img.divide(10000))
    )

    scene_count = collection.size().getInfo()
    logger.info("Single-day scenes found: %d", scene_count)

    if scene_count == 0:
        return None, 0

    composite = collection.median()
    return composite, scene_count

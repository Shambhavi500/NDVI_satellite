import logging
import ee

from config import (
    CONFIDENCE_SCENE_TARGET,
    CONFIDENCE_STD_MAX,
    CVI_THRESHOLDS,
    NDVI_THRESHOLDS,
    EVI_THRESHOLDS,
    SAVI_THRESHOLDS,
    NDMI_THRESHOLDS,
    NDWI_THRESHOLDS,
    GNDVI_THRESHOLDS,
    MAX_CLOUD_COVER_PCT,
    VV_THRESHOLDS,
    VH_THRESHOLDS,
    VV_VH_RATIO_THRESHOLDS,
    SMI_THRESHOLDS,
    RVI_THRESHOLDS,
)

logger = logging.getLogger(__name__)


def interpret_value(value: float | None, thresholds: dict) -> str:
    """
    Map a numeric index value to a human-readable description.
    """
    if value is None:
        return "N/A — data unavailable"
    for threshold in sorted(thresholds.keys(), reverse=True):
        if value >= threshold:
            return thresholds[threshold]
    return "Unknown"


def compute_confidence(
    scene_count: int,
    avg_cloud_pct: float,
    cvi_std: float,
) -> float:
    """
    Compute a composite confidence score (0–1).
    """
    scene_score = min(scene_count / CONFIDENCE_SCENE_TARGET, 1.0)
    cloud_score = max(0.0, 1.0 - avg_cloud_pct / 100.0)
    std_score = max(0.0, 1.0 - cvi_std / CONFIDENCE_STD_MAX)

    confidence = (
        0.50 * scene_score
        + 0.30 * cloud_score
        + 0.20 * std_score
    )
    return round(min(max(confidence, 0.0), 1.0), 4)


def extract_farm_statistics(
    image: ee.Image,
    collection: ee.ImageCollection | None,
    geometry: ee.Geometry,
    scene_count: int,
) -> dict:
    """
    Extracts farm-level mean statistics and confidence.
    """
    try:
        avg_cloud = (
            collection.aggregate_mean("CLOUDY_PIXEL_PERCENTAGE").getInfo() 
            if collection else MAX_CLOUD_COVER_PCT
        )
    except Exception:
        avg_cloud = MAX_CLOUD_COVER_PCT

    stats_bands = ["CVI", "NDVI", "EVI", "SAVI", "NDMI", "NDWI", "GNDVI"]

    try:
        # Get mean for all bands at once
        mean_result = image.select(stats_bands).reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geometry,
            scale=10,
            maxPixels=1e9
        ).getInfo()

        # Get std for CVI for confidence
        std_result = image.select(["CVI"]).reduceRegion(
            reducer=ee.Reducer.stdDev(),
            geometry=geometry,
            scale=10,
            maxPixels=1e9
        ).getInfo()
        cvi_std = std_result.get("CVI") or 0.0

        # ----- NDVI Area Histogram Calculation -----
        ndvi = image.select("NDVI")
        clamped_ndvi = ndvi.max(0.0).min(0.9999)
        bucket_img = clamped_ndvi.divide(0.05).floor().int()
        
        area_img = ee.Image.pixelArea().addBands(bucket_img)
        area_stats = area_img.reduceRegion(
            reducer=ee.Reducer.sum().group(
                groupField=1,
                groupName="bucket"
            ),
            geometry=geometry,
            scale=10,
            maxPixels=1e9
        ).getInfo()
        
        ndvi_histogram = {str(i): 0.0 for i in range(20)}
        if area_stats and "groups" in area_stats:
            for group in area_stats["groups"]:
                b_idx = str(group.get("bucket", 0))
                area_sqm = group.get("sum", 0.0)
                ndvi_histogram[b_idx] = round(area_sqm / 10000.0, 2)

    except Exception as exc:
        logger.error("Failed to extract farm stats: %s", exc)
        mean_result = {b: None for b in stats_bands}
        cvi_std = 0.0
        ndvi_histogram = {str(i): 0.0 for i in range(20)}

    confidence = compute_confidence(scene_count, avg_cloud or 0, cvi_std)

    thresholds_map = {
        "CVI": CVI_THRESHOLDS,
        "NDVI": NDVI_THRESHOLDS,
        "EVI": EVI_THRESHOLDS,
        "SAVI": SAVI_THRESHOLDS,
        "NDMI": NDMI_THRESHOLDS,
        "NDWI": NDWI_THRESHOLDS,
        "GNDVI": GNDVI_THRESHOLDS,
    }

    farm_summary = {
        "confidence": confidence,
        "scene_count": scene_count,
        "indices": {},
        "ndvi_histogram": ndvi_histogram,
    }

    for band in stats_bands:
        mean_val = mean_result.get(band)
        interp = interpret_value(mean_val, thresholds_map[band])
        farm_summary["indices"][band] = {
            "mean": round(mean_val, 4) if mean_val is not None else None,
            "interpretation": interp
        }

    return farm_summary


def extract_s1_farm_statistics(
    image: ee.Image,
    geometry: ee.Geometry,
    scene_count: int,
) -> dict:
    """
    Extracts farm-level mean statistics for Sentinel-1 radar indices.

    Returns a summary dict with mean VV, VH, VV/VH ratio, SMI, RVI
    plus an SMI-based irrigation advisory.
    """
    stats_bands = ["VV", "VH", "VV_VH_RATIO", "SMI", "RVI"]

    try:
        mean_result = image.select(stats_bands).reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geometry,
            scale=10,
            maxPixels=1e9
        ).getInfo()
    except Exception as exc:
        logger.error("Failed to extract S1 farm stats: %s", exc)
        mean_result = {b: None for b in stats_bands}

    thresholds_map = {
        "VV": VV_THRESHOLDS,
        "VH": VH_THRESHOLDS,
        "VV_VH_RATIO": VV_VH_RATIO_THRESHOLDS,
        "SMI": SMI_THRESHOLDS,
        "RVI": RVI_THRESHOLDS,
    }

    farm_summary = {
        "confidence": min(scene_count / 5, 1.0),
        "scene_count": scene_count,
        "indices": {},
        "source": "sentinel1",
    }

    for band in stats_bands:
        mean_val = mean_result.get(band)
        interp = interpret_value(mean_val, thresholds_map[band])
        farm_summary["indices"][band] = {
            "mean": round(mean_val, 4) if mean_val is not None else None,
            "interpretation": interp
        }

    # Generate SMI-based irrigation advisory
    smi_val = mean_result.get("SMI")
    if smi_val is not None:
        smi_pct = round(smi_val * 100, 1)
        if smi_val < 0.2:
            farm_summary["advisory"] = f"Soil moisture at {smi_pct}% — Dry. Immediate irrigation recommended."
        elif smi_val < 0.5:
            farm_summary["advisory"] = f"Soil moisture at {smi_pct}% — Moderate. Consider watering in 2–3 days."
        elif smi_val < 0.8:
            farm_summary["advisory"] = f"Soil moisture at {smi_pct}% — Good condition. Next watering in 5–7 days."
        else:
            farm_summary["advisory"] = f"Soil moisture at {smi_pct}% — Wet. Monitor for waterlogging risk."
    else:
        farm_summary["advisory"] = "Soil moisture data unavailable."

    return farm_summary

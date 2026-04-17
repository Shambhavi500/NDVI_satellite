"""
services/s1_index_service.py — Sentinel-1 Radar Index Computation Layer
=========================================================================
Responsibilities:
    - Compute radar-derived vegetation and soil indices from Sentinel-1 VV/VH
    - Expose a single public function: compute_s1_indices()

Indices computed:
    VV_VH_RATIO = VV_linear / VH_linear  (polarisation ratio)
    SMI         = (max - ratio) / (max - min)  (Soil Moisture Index)
    RVI         = 4 * VH_linear / (VV_linear + VH_linear)  (Radar Vegetation Index)

Note: VV and VH are in dB in the GRD product.  For ratio-based indices we
      convert to linear scale first:  linear = 10^(dB/10)
"""

import logging
import ee

from config import S1_BANDS, SMI_VV_VH_MIN, SMI_VV_VH_MAX

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# dB → Linear Conversion
# ─────────────────────────────────────────────────────────────────────────────

def _db_to_linear(image: ee.Image, band: str) -> ee.Image:
    """Convert a single band from decibels to linear scale: 10^(dB/10)."""
    return ee.Image(10).pow(image.select(band).divide(10))


# ─────────────────────────────────────────────────────────────────────────────
# Individual Index Computations
# ─────────────────────────────────────────────────────────────────────────────

def _compute_vv_vh_ratio(composite: ee.Image) -> ee.Image:
    """
    VV/VH Ratio (linear scale).

    Discriminates vegetation type and density:
        < 4.0   → Dense vegetation (peak growth)
        4.0-8.0 → Moderate vegetation (growing stage)
        > 8.0   → Sparse vegetation / bare soil
    """
    vv_lin = _db_to_linear(composite, S1_BANDS["VV"])
    vh_lin = _db_to_linear(composite, S1_BANDS["VH"])
    return vv_lin.divide(vh_lin).rename("VV_VH_RATIO")


def _compute_smi(vv_vh_ratio: ee.Image) -> ee.Image:
    """
    Soil Moisture Index = (VV/VH_max - VV/VH) / (VV/VH_max - VV/VH_min)

    Normalized to 0–1 (0% to 100%).
        0.0–0.2 → Dry soil (irrigation needed)
        0.2–0.5 → Moderate moisture
        0.5–0.8 → Good moisture (optimal for crops)
        0.8–1.0 → Wet soil (risk of waterlogging)

    Uses global calibration defaults from config; can be overridden per-farm.
    """
    ratio = vv_vh_ratio.select("VV_VH_RATIO")
    smi = (
        ee.Image.constant(SMI_VV_VH_MAX)
        .subtract(ratio)
        .divide(ee.Image.constant(SMI_VV_VH_MAX - SMI_VV_VH_MIN))
        .clamp(0, 1)
        .rename("SMI")
    )
    return smi


def _compute_rvi(composite: ee.Image) -> ee.Image:
    """
    Radar Vegetation Index = 4 * VH_linear / (VV_linear + VH_linear)

    Radar-based alternative to NDVI that works through clouds / monsoon.
        0.0–0.3 → Sparse vegetation / bare soil
        0.3–0.6 → Moderate vegetation
        0.6–1.0 → Dense vegetation
    """
    vv_lin = _db_to_linear(composite, S1_BANDS["VV"])
    vh_lin = _db_to_linear(composite, S1_BANDS["VH"])
    rvi = (
        vh_lin.multiply(4)
        .divide(vv_lin.add(vh_lin))
        .clamp(0, 1)
        .rename("RVI")
    )
    return rvi


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def compute_s1_indices(composite: ee.Image) -> ee.Image:
    """
    Compute all Sentinel-1 radar indices and return as a multi-band ee.Image.

    Input:
        composite: Sentinel-1 GRD median composite with VV and VH bands (dB).

    Output:
        ee.Image containing: VV, VH (original dB), VV_VH_RATIO, SMI, RVI

    This image is consumed by grid_service for per-cell reduction.
    """
    vv_vh_ratio = _compute_vv_vh_ratio(composite)
    smi         = _compute_smi(vv_vh_ratio)
    rvi         = _compute_rvi(composite)

    indexed = composite.addBands([vv_vh_ratio, smi, rvi])

    logger.info("S1 indices computed: VV, VH, VV_VH_RATIO, SMI, RVI")
    return indexed

/**
 * colorUtils.js
 * Official EOS NDVI colormap — exact stops as published in EOSDA API Connect.
 * Source: colormap_id a9bc6eceeef2a13bb88a7f641dca3aa0, levels -1..1
 *
 * Each stop is [ndvi_threshold, hex_color].
 * Threshold is ABSOLUTE (thresholds_type: "absolute").
 * Colour applies from its threshold up to (but not including) the next threshold.
 */
const EOS_NDVI_STOPS = [
    [-1.00, '#ad0028'],
    [ 0.05, '#c5142a'],
    [ 0.10, '#e02d2c'],
    [ 0.15, '#ef4c3a'],
    [ 0.20, '#fe6c4a'],
    [ 0.25, '#ff8d5a'],
    [ 0.30, '#ffab69'],
    [ 0.35, '#ffc67d'],
    [ 0.40, '#ffe093'],
    [ 0.45, '#ffefab'],
    [ 0.50, '#fdfec2'],
    [ 0.55, '#eaf7ac'],
    [ 0.60, '#d5ef94'],
    [ 0.65, '#b9e383'],
    [ 0.70, '#9bd873'],
    [ 0.75, '#77ca6f'],
    [ 0.80, '#53bd6b'],
    [ 0.85, '#14aa60'],
    [ 0.90, '#009755'],
    [ 0.95, '#007e47'],
    [ 1.00, '#007e47'],
];

/**
 * Convert an NDVI value (any range) to an interpolated hex colour using
 * the official EOS NDVI stop table.
 *
 * Values are linearly interpolated between the two surrounding stops so the
 * rendered gradient is smooth (identical to EOS's "continuous" rendering on
 * top of the discrete palette).
 */
export function ndviToColor(value) {
    if (value === null || value === undefined || isNaN(value)) return '#4b5563';

    const stops = EOS_NDVI_STOPS;

    // Below first stop → clamp to first color
    if (value <= stops[0][0]) return stops[0][1];
    // Above last stop → clamp to last color
    if (value >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];

    // Find surrounding stops
    let lo = 0;
    for (let i = 1; i < stops.length; i++) {
        if (value < stops[i][0]) { lo = i - 1; break; }
        lo = i; // exact match or past this stop; keep updating
    }
    const hi = Math.min(lo + 1, stops.length - 1);

    const loV = stops[lo][0], hiV = stops[hi][0];
    const t   = hiV === loV ? 0 : (value - loV) / (hiV - loV);

    return _lerpHex(stops[lo][1], stops[hi][1], t);
}

/** Linearly interpolate between two hex colours */
function _lerpHex(a, b, t) {
    const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
    const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
    const r  = Math.round(ar + (br - ar) * t);
    const g  = Math.round(ag + (bg - ag) * t);
    const bv = Math.round(ab + (bb - ab) * t);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${bv.toString(16).padStart(2,'0')}`;
}

/** Convert "#RRGGBB" → "rgba(r,g,b,alpha)" for canvas gradient stops */
export function _rgba(colorStr, alpha) {
    if (colorStr.startsWith('#')) {
        const r = parseInt(colorStr.slice(1, 3), 16);
        const g = parseInt(colorStr.slice(3, 5), 16);
        const b = parseInt(colorStr.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
    return colorStr.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
}


// ─────────────────────────────────────────────────────────────────────────────
// Sentinel-1 (Radar) Color Palettes
// ─────────────────────────────────────────────────────────────────────────────

/** Soil Moisture Index: Red (dry) → Yellow → Green → Blue (wet), 0–1 */
const SMI_STOPS = [
    [0.00, '#dc2626'],  // dry — red
    [0.15, '#ef4444'],
    [0.25, '#f59e0b'],  // moderate — yellow
    [0.40, '#facc15'],
    [0.55, '#22c55e'],  // good — green
    [0.70, '#16a34a'],
    [0.85, '#0ea5e9'],  // wet — blue
    [1.00, '#2563eb'],
];

/** Radar Vegetation Index: Brown (bare) → Green (dense), 0–1 */
const RVI_STOPS = [
    [0.00, '#92400e'],
    [0.15, '#b45309'],
    [0.30, '#d97706'],
    [0.50, '#65a30d'],
    [0.70, '#16a34a'],
    [1.00, '#059669'],
];

/** VV/VH Ratio (Linear): Purple (dense) → Green (moderate) → Brown (bare), 2.0–15.0 */
const VV_VH_RATIO_STOPS = [
    [ 2.0, '#7c3aed'],
    [ 4.0, '#8b5cf6'],
    [ 6.0, '#22c55e'],
    [ 8.0, '#84cc16'],
    [ 12.0, '#a16207'],
    [ 15.0, '#92400e'],
];

/** Radar dB: Dark blue (wet/low) → Light blue (dry/high), -25 to 0 */
const RADAR_DB_STOPS = [
    [-25.0, '#1e3a5f'],
    [-20.0, '#1d4ed8'],
    [-15.0, '#2563eb'],
    [-10.0, '#60a5fa'],
    [-5.0,  '#93c5fd'],
    [ 0.0,  '#e0e7ff'],
];


function _interpolateStops(value, stops) {
    if (value === null || value === undefined || isNaN(value)) return '#4b5563';
    if (value <= stops[0][0]) return stops[0][1];
    if (value >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];

    let lo = 0;
    for (let i = 1; i < stops.length; i++) {
        if (value < stops[i][0]) { lo = i - 1; break; }
        lo = i;
    }
    const hi = Math.min(lo + 1, stops.length - 1);
    const loV = stops[lo][0], hiV = stops[hi][0];
    const t = hiV === loV ? 0 : (value - loV) / (hiV - loV);
    return _lerpHex(stops[lo][1], stops[hi][1], t);
}


export function smiToColor(value) {
    return _interpolateStops(value, SMI_STOPS);
}

export function rviToColor(value) {
    return _interpolateStops(value, RVI_STOPS);
}

export function vvVhRatioToColor(value) {
    return _interpolateStops(value, VV_VH_RATIO_STOPS);
}

export function radarDbToColor(value) {
    return _interpolateStops(value, RADAR_DB_STOPS);
}


/**
 * Unified color function dispatcher.
 * Returns the appropriate color for a given value based on satellite + band.
 *
 * @param {number} value  — the raw index value
 * @param {string} band   — lowercase band key (e.g. 'ndvi', 'smi', 'vv')
 * @param {string} satellite — 'sentinel2' or 'sentinel1'
 * @returns {string} hex color
 */
export function getColor(value, band, satellite) {
    if (satellite === 'sentinel1') {
        switch (band) {
            case 'smi':          return smiToColor(value);
            case 'rvi':          return rviToColor(value);
            case 'vv_vh_ratio':  return vvVhRatioToColor(value);
            case 'vv':           return radarDbToColor(value);
            case 'vh':           return radarDbToColor(value);
            default:             return radarDbToColor(value);
        }
    }
    // Default: Sentinel-2 NDVI palette for all optical bands
    return ndviToColor(value);
}


/**
 * Value range config per band (used for heatmap clamping).
 */
export const BAND_RANGES = {
    // Sentinel-2 (all use -1 to 1)
    ndvi: [-1, 1], evi: [-1, 1], savi: [-1, 1],
    ndmi: [-1, 1], gndvi: [-1, 1], cvi: [-1, 1], ndwi: [-1, 1],
    // Sentinel-1
    vv: [-20, 0],
    vh: [-25, -5],
    vv_vh_ratio: [2.0, 15.0],
    smi: [0, 1],
    rvi: [0, 1],
};

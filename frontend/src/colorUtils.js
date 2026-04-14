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

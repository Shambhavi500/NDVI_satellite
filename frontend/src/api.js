/**
 * api.js
 * API interaction handles
 */

export async function analyzeFarm(geoJsonGeometry) {
    const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry: geoJsonGeometry }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${response.status}`);
    }

    return await response.json();
}

export async function samplePixel(lat, lng, band) {
    const response = await fetch(`/api/sample?lat=${lat}&lng=${lng}&band=${band}`);
    if (!response.ok) return null;
    return await response.json();
}

/**
 * Fetch available Sentinel-2 dates for a polygon (last 90 days).
 */
export async function fetchAvailableDates(geoJsonGeometry) {
    const response = await fetch('/api/analyze-dates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry: geoJsonGeometry }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${response.status}`);
    }

    return await response.json();
}

/**
 * Fetch NDVI analysis for a specific date.
 */
export async function fetchDayAnalysis(geoJsonGeometry, date) {
    const response = await fetch('/api/analyze-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry: geoJsonGeometry, date }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${response.status}`);
    }

    return await response.json();
}

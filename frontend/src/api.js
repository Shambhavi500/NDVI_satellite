/**
 * api.js
 * API interaction handles
 */

/**
 * Same-origin by default (Vite proxies `/api` and `/chatbot` in dev).
 * Set `VITE_API_BASE_URL` when the API is on another origin (no trailing slash).
 */
export function apiUrl(path) {
    const base = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '');
    const rel = path.startsWith('/') ? path : `/${path}`;
    if (!base) return rel;
    return `${base}${rel}`;
}

export async function analyzeFarm(geoJsonGeometry) {
    const response = await fetch(apiUrl('/api/analyze'), {
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
    const response = await fetch(apiUrl(`/api/sample?lat=${lat}&lng=${lng}&band=${band}`));
    if (!response.ok) return null;
    return await response.json();
}

/**
 * Fetch available Sentinel-2 dates for a polygon (last 90 days).
 */
export async function fetchAvailableDates(geoJsonGeometry) {
    const response = await fetch(apiUrl('/api/analyze-dates'), {
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
    const response = await fetch(apiUrl('/api/analyze-day'), {
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

/**
 * Sentinel-1 (Radar) API functions
 */
export async function analyzeS1Farm(geoJsonGeometry) {
    const response = await fetch(apiUrl('/api/analyze-s1'), {
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

export async function fetchS1AvailableDates(geoJsonGeometry) {
    const response = await fetch(apiUrl('/api/analyze-s1-dates'), {
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

export async function fetchS1DayAnalysis(geoJsonGeometry, date) {
    const response = await fetch(apiUrl('/api/analyze-s1-day'), {
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

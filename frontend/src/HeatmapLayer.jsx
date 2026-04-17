import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { getColor, BAND_RANGES } from './colorUtils';

/**
 * Geographic image-overlay heatmap.
 *
 * Renders the IDW once into a fixed raster in lat/lng space, converts to a
 * PNG data-URL, and hands it to L.imageOverlay. Leaflet then scales / pans
 * the <img> during zoom exactly like a tile — zero JS redraws, zero lag.
 *
 * Supports both Sentinel-2 (optical) and Sentinel-1 (radar) bands via
 * the `activeSatellite` prop and unified `getColor()` dispatcher.
 */
export default function HeatmapLayer({ data, activeBand, activeSatellite = 'sentinel2', farmBoundary }) {
    const map = useMap();
    const overlayRef = useRef(null);

    useEffect(() => {
        if (!map || !data || !farmBoundary?.coordinates) return;

        const features = data.features || [];
        if (!features.length) return;

        /* ── geographic bounding box ──────────────────────────────── */
        const coords =
            farmBoundary.type === 'MultiPolygon'
                ? farmBoundary.coordinates.flat(2)
                : farmBoundary.coordinates[0];

        let minLat = Infinity, maxLat = -Infinity;
        let minLng = Infinity, maxLng = -Infinity;
        for (const [lng, lat] of coords) {
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
        }

        const latSpan = Math.max(maxLat - minLat, 1e-9);
        const lngSpan = Math.max(maxLng - minLng, 1e-9);

        /* ── cell centres + values ────────────────────────────────── */
        const cellLat = [];
        const cellLng = [];
        const cellVal = [];

        // Get band-specific value range for clamping
        const bandKey = activeBand.toLowerCase();
        const [rangeMin, rangeMax] = BAND_RANGES[bandKey] || [-1, 1];

        for (const f of features) {
            const v = f.properties?.[bandKey];
            if (v === null || v === undefined || isNaN(v)) continue;
            const ring = f.geometry?.coordinates?.[0];
            if (!ring?.length) continue;
            let sLng = 0, sLat = 0;
            for (const [ln, la] of ring) { sLng += ln; sLat += la; }
            const n = ring.length;
            cellLat.push(sLat / n);
            cellLng.push(sLng / n);
            cellVal.push(Math.max(rangeMin, Math.min(rangeMax, v)));
        }
        const N = cellLat.length;
        if (!N) return;

        /* ── raster dimensions (fixed, ~400px longest side) ───────── */
        const MAX_DIM = 400;
        const aspect = lngSpan / latSpan;
        const imgW = aspect >= 1 ? MAX_DIM : Math.max(16, Math.round(MAX_DIM * aspect));
        const imgH = aspect >= 1 ? Math.max(16, Math.round(MAX_DIM / aspect)) : MAX_DIM;

        /* ── map cells into pixel space ───────────────────────────── */
        const cX = new Float32Array(N);
        const cY = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            cX[i] = ((cellLng[i] - minLng) / lngSpan) * (imgW - 1);
            cY[i] = ((maxLat - cellLat[i]) / latSpan) * (imgH - 1);
        }

        /* ── average cell spacing (pixels) ────────────────────────── */
        const step = Math.max(1, Math.ceil(N / 24));
        let totalMin = 0, cnt = 0;
        for (let i = 0; i < N; i += step) {
            let minD2 = Infinity;
            for (let j = 0; j < N; j++) {
                if (j === i) continue;
                const dx = cX[j] - cX[i], dy = cY[j] - cY[i];
                const d2 = dx * dx + dy * dy;
                if (d2 < minD2) minD2 = d2;
            }
            if (minD2 < Infinity) { totalMin += Math.sqrt(minD2); cnt++; }
        }
        const spacing = cnt > 0 ? totalMin / cnt : 20;

        /* ── colour LUT (band-specific) ───────────────────────────── */
        const LUT = 512;
        const lR = new Uint8Array(LUT), lG = new Uint8Array(LUT), lB = new Uint8Array(LUT);
        for (let i = 0; i < LUT; i++) {
            const v = rangeMin + (i / (LUT - 1)) * (rangeMax - rangeMin);
            const hex = getColor(v, bandKey, activeSatellite);
            lR[i] = parseInt(hex.slice(1, 3), 16);
            lG[i] = parseInt(hex.slice(3, 5), 16);
            lB[i] = parseInt(hex.slice(5, 7), 16);
        }
        const toIdx = (v) => Math.round(Math.max(0, Math.min(1, (v - rangeMin) / (rangeMax - rangeMin))) * (LUT - 1));

        /* ── spatial buckets ──────────────────────────────────────── */
        const bSz = Math.max(4, Math.round(spacing));
        const gC = Math.ceil(imgW / bSz) + 2;
        const gR = Math.ceil(imgH / bSz) + 2;
        const buckets = Array.from({ length: gC * gR }, () => []);
        for (let i = 0; i < N; i++) {
            const bx = Math.floor(cX[i] / bSz);
            const by = Math.floor(cY[i] / bSz);
            if (bx >= 0 && bx < gC && by >= 0 && by < gR)
                buckets[by * gC + bx].push(i);
        }

        /* ── IDW fill ─────────────────────────────────────────────── */
        const SR = 4;
        const epsSq = (spacing * 0.5) ** 2;
        const imgData = new ImageData(imgW, imgH);
        const buf = imgData.data;

        for (let sy = 0; sy < imgH; sy++) {
            const by0 = Math.floor(sy / bSz);
            for (let sx = 0; sx < imgW; sx++) {
                const bx0 = Math.floor(sx / bSz);
                let wS = 0, vS = 0, nD2 = Infinity, nI = -1;

                for (let dy = -SR; dy <= SR; dy++) {
                    const by = by0 + dy;
                    if (by < 0 || by >= gR) continue;
                    for (let dx = -SR; dx <= SR; dx++) {
                        const bx = bx0 + dx;
                        if (bx < 0 || bx >= gC) continue;
                        for (const i of buckets[by * gC + bx]) {
                            const ddx = cX[i] - sx, ddy = cY[i] - sy;
                            const d2 = ddx * ddx + ddy * ddy;
                            if (d2 < nD2) { nD2 = d2; nI = i; }
                            const w = 1 / (d2 + epsSq);
                            wS += w;
                            vS += w * cellVal[i];
                        }
                    }
                }
                if (nI < 0) continue;
                const li = toIdx(wS > 0 ? vS / wS : cellVal[nI]);
                const pi = (sy * imgW + sx) * 4;
                buf[pi] = lR[li]; buf[pi+1] = lG[li]; buf[pi+2] = lB[li]; buf[pi+3] = 255;
            }
        }

        /* ── clip to polygon + export PNG data-URL ────────────────── */
        const raw = document.createElement('canvas');
        raw.width = imgW; raw.height = imgH;
        raw.getContext('2d').putImageData(imgData, 0, 0);

        const clipped = document.createElement('canvas');
        clipped.width = imgW; clipped.height = imgH;
        const cctx = clipped.getContext('2d');

        const rings = farmBoundary.type === 'MultiPolygon'
            ? farmBoundary.coordinates.map(p => p[0])
            : [farmBoundary.coordinates[0]];

        cctx.beginPath();
        for (const ring of rings) {
            ring.forEach(([lng, lat], i) => {
                const px = ((lng - minLng) / lngSpan) * (imgW - 1);
                const py = ((maxLat - lat) / latSpan) * (imgH - 1);
                i === 0 ? cctx.moveTo(px, py) : cctx.lineTo(px, py);
            });
            cctx.closePath();
        }
        cctx.clip();
        cctx.drawImage(raw, 0, 0);

        const dataUrl = clipped.toDataURL('image/png');

        /* ── add as L.imageOverlay (Leaflet handles zoom natively) ── */
        const bounds = L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
        const overlay = L.imageOverlay(dataUrl, bounds, {
            opacity: 0.75,
            interactive: false,
            zIndex: 400,
        });
        overlay.addTo(map);
        overlayRef.current = overlay;

        return () => {
            if (overlayRef.current) {
                map.removeLayer(overlayRef.current);
                overlayRef.current = null;
            }
        };
    }, [map, data, activeBand, activeSatellite, farmBoundary]);

    return null;
}

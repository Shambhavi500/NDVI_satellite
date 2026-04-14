import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { ndviToColor } from './colorUtils';

/**
 * EOS-style smooth NDVI heatmap using Regularised Shepard IDW.
 *
 * Rendering pipeline:
 *   1. Convert every grid-cell centre → canvas pixel coords + raw NDVI value.
 *   2. Pre-compute a 512-entry color LUT so NDVI → RGB is an O(1) lookup.
 *   3. For every canvas pixel compute a REGULARISED Shepard IDW NDVI value:
 *
 *          w_i = 1 / (d_i² + ε²)   ← key difference vs plain IDW
 *
 *      The epsilon term (ε ≈ 0.5 × cell-spacing) prevents any single cell
 *      from dominating when a pixel falls exactly on a centre — eliminating
 *      the dark-dot artifacts and giving EOS-style continuous gradients.
 *   4. Map interpolated NDVI → LUT → RGB, write into ImageData.
 *   5. Stamp onto canvas clipped to the farm polygon.
 */
export default function HeatmapLayer({ data, activeBand, farmBoundary }) {
    const map          = useMap();
    const canvasRef    = useRef(null);
    const renderReqRef = useRef(null);

    /* ── Create / destroy overlay canvas ─────────────────────────────── */
    useEffect(() => {
        const canvas = L.DomUtil.create('canvas', 'cv-heatmap');
        Object.assign(canvas.style, {
            position: 'absolute', top: '0', left: '0',
            pointerEvents: 'none', opacity: '0.75',
        });
        map.getPanes().overlayPane.appendChild(canvas);
        canvasRef.current = canvas;
        return () => canvas?.parentNode?.removeChild(canvas);
    }, [map]);

    /* ── Redraw on data / view change ──────────────────────────────────── */
    useEffect(() => {
        if (!map || !canvasRef.current || !data) return;

        const redraw = () => {
            const canvas = canvasRef.current;
            const size   = map.getSize();
            const W = size.x;
            const H = size.y;
            canvas.width  = W;
            canvas.height = H;
            L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));

            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, W, H);

            const features = data.features || [];
            if (!features.length) return;

            /* ── 1. Collect cell centres + raw NDVI values ─────────────── */
            const cellsX = [];   // Float32 canvas X
            const cellsY = [];   // Float32 canvas Y
            const cellsV = [];   // Float32 NDVI  [-1, 1]

            for (const feature of features) {
                const val = feature.properties?.[activeBand];
                if (val === null || val === undefined || isNaN(val)) continue;
                const ring = feature.geometry?.coordinates?.[0];
                if (!ring?.length) continue;

                let sumLng = 0, sumLat = 0;
                for (const [lng, lat] of ring) { sumLng += lng; sumLat += lat; }
                const n   = ring.length;
                const cpt = map.latLngToContainerPoint([sumLat / n, sumLng / n]);

                cellsX.push(cpt.x);
                cellsY.push(cpt.y);
                cellsV.push(Math.max(-1, Math.min(1, val)));
            }

            const N = cellsX.length;
            if (!N) return;

            /* ── 2. Estimate average cell spacing (pixels) ─────────────── */
            const step = Math.max(1, Math.ceil(N / 24));
            let totalMin = 0, cnt = 0;
            for (let i = 0; i < N; i += step) {
                let minD2 = Infinity;
                for (let j = 0; j < N; j++) {
                    if (j === i) continue;
                    const dx = cellsX[j] - cellsX[i];
                    const dy = cellsY[j] - cellsY[i];
                    const d2 = dx * dx + dy * dy;
                    if (d2 < minD2) minD2 = d2;
                }
                if (minD2 < Infinity) { totalMin += Math.sqrt(minD2); cnt++; }
            }
            const spacing = cnt > 0 ? totalMin / cnt : 40;

            /* ── 3. Pre-compute 512-entry NDVI → RGB LUT ───────────────── */
            //  The LUT covers the full ndvi range [-1, 1] using the official
            //  EOS stop table from colorUtils.ndviToColor().  O(1) per pixel.
            const LUT_N = 512;
            const lutR  = new Uint8Array(LUT_N);
            const lutG  = new Uint8Array(LUT_N);
            const lutB  = new Uint8Array(LUT_N);
            for (let i = 0; i < LUT_N; i++) {
                const v   = -1 + (i / (LUT_N - 1)) * 2; // exactly −1 … +1
                const hex = ndviToColor(v);
                lutR[i] = parseInt(hex.slice(1, 3), 16);
                lutG[i] = parseInt(hex.slice(3, 5), 16);
                lutB[i] = parseInt(hex.slice(5, 7), 16);
            }
            //  toLutIdx: maps an absolute NDVI value directly to its LUT position.
            //  NO stretching / normalization — NDVI 0.20 → #fe6c4a (orange-red),
            //  NDVI 0.50 → #fdfec2 (cream), exactly matching EOS.
            const toLutIdx = (v) =>
                Math.round(Math.max(0, Math.min(1, (v + 1) / 2)) * (LUT_N - 1));

            /* ── 4. Spatial bucket grid for fast candidate lookup ──────── */
            //  Bucket width ≈ spacing pixels.  We search the 7×7 bucket
            //  window around each pixel → covers ±3 cell widths, more than
            //  enough to always find neighbours for IDW.
            const bSz  = Math.max(1, Math.round(spacing));
            const gCols = Math.ceil(W / bSz) + 2;
            const gRows = Math.ceil(H / bSz) + 2;
            const buckets = new Array(gCols * gRows).fill(null).map(() => []);

            for (let i = 0; i < N; i++) {
                const bx = Math.floor(cellsX[i] / bSz);
                const by = Math.floor(cellsY[i] / bSz);
                if (bx >= 0 && bx < gCols && by >= 0 && by < gRows)
                    buckets[by * gCols + bx].push(i);
            }

            /* ── 5. Regularised Shepard IDW pixel fill ──────────────────── */
            //
            //  Classic IDW uses  w = 1/d²  which → ∞ at cell centres and
            //  creates visible dark-dot artifacts.  Shepard's fix:
            //
            //      w = 1 / (d² + ε²)     ε = spacing × 0.5
            //
            //  The epsilon term caps the maximum weight so all nearby cells
            //  still contribute, producing perfectly smooth EOS-style gradients.

            const SEARCH_R = 4;                      // ±4 buckets ≈ ±4 cell widths
            const epsSq    = (spacing * 0.5) ** 2;  // Shepard regularisation

            const imgData = ctx.createImageData(W, H);
            const buf     = imgData.data;

            for (let py = 0; py < H; py++) {
                const by0 = Math.floor(py / bSz);

                for (let px = 0; px < W; px++) {
                    const bx0 = Math.floor(px / bSz);

                    let wSum   = 0;
                    let vSum   = 0;
                    let nearD2  = Infinity;
                    let nearIdx = -1;

                    for (let dy = -SEARCH_R; dy <= SEARCH_R; dy++) {
                        const by = by0 + dy;
                        if (by < 0 || by >= gRows) continue;
                        for (let dx = -SEARCH_R; dx <= SEARCH_R; dx++) {
                            const bx = bx0 + dx;
                            if (bx < 0 || bx >= gCols) continue;

                            const bucket = buckets[by * gCols + bx];
                            for (const i of bucket) {
                                const ddx = cellsX[i] - px;
                                const ddy = cellsY[i] - py;
                                const d2  = ddx * ddx + ddy * ddy;

                                if (d2 < nearD2) { nearD2 = d2; nearIdx = i; }

                                // Regularised weight — smooth everywhere, no spikes
                                const w = 1 / (d2 + epsSq);
                                wSum += w;
                                vSum += w * cellsV[i];
                            }
                        }
                    }

                    if (nearIdx < 0) continue; // pixel outside all cell ranges

                    const interpV = wSum > 0 ? vSum / wSum : cellsV[nearIdx];
                    const li = toLutIdx(interpV);
                    const pi = (py * W + px) * 4;
                    buf[pi    ] = lutR[li];
                    buf[pi + 1] = lutG[li];
                    buf[pi + 2] = lutB[li];
                    buf[pi + 3] = 255;
                }
            }

            /* ── 6. Stamp onto canvas, clipped to farm polygon ─────────── */
            const offscreen    = document.createElement('canvas');
            offscreen.width    = W;
            offscreen.height   = H;
            offscreen.getContext('2d').putImageData(imgData, 0, 0);

            const hasClip = farmBoundary?.coordinates;
            if (hasClip) {
                ctx.save();
                ctx.beginPath();
                const rings = farmBoundary.type === 'MultiPolygon'
                    ? farmBoundary.coordinates.map(p => p[0])
                    : [farmBoundary.coordinates[0]];
                for (const ring of rings) {
                    ring.forEach(([lng, lat], i) => {
                        const pt = map.latLngToContainerPoint([lat, lng]);
                        i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y);
                    });
                    ctx.closePath();
                }
                ctx.clip();
            }

            ctx.drawImage(offscreen, 0, 0);
            if (hasClip) ctx.restore();
        };

        const handleUpdate = () => {
            if (renderReqRef.current) cancelAnimationFrame(renderReqRef.current);
            renderReqRef.current = requestAnimationFrame(redraw);
        };

        map.on('moveend zoomend resize', handleUpdate);
        handleUpdate();

        return () => {
            map.off('moveend zoomend resize', handleUpdate);
            if (renderReqRef.current) cancelAnimationFrame(renderReqRef.current);
        };
    }, [map, data, activeBand, farmBoundary]);

    return null;
}

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { ndviToColor, _rgba } from './colorUtils';

/**
 * Renders a smooth, blended canvas heatmap for vegetation index data.
 * 
 * Uses multi-pass rendering with canvas composite blending to produce
 * a seamless, EOS-style continuous heatmap where neighboring cells
 * blend smoothly into each other — no visible grid or blob edges.
 * 
 * Clips output to the farm boundary polygon.
 */
export default function HeatmapLayer({ data, activeBand, farmBoundary }) {
    const map = useMap();
    const canvasRef = useRef(null);
    const renderReqRef = useRef(null);

    useEffect(() => {
        const _canvas = L.DomUtil.create('canvas', 'cv-heatmap');
        const s = _canvas.style;
        s.position = 'absolute';
        s.top = '0';
        s.left = '0';
        s.pointerEvents = 'none';
        s.opacity = '0.92';
        
        map.getPanes().overlayPane.appendChild(_canvas);
        canvasRef.current = _canvas;

        return () => {
            if (_canvas && _canvas.parentNode) {
                _canvas.parentNode.removeChild(_canvas);
            }
        };
    }, [map]);

    useEffect(() => {
        if (!map || !canvasRef.current || !data) return;

        const redraw = () => {
            const canvas = canvasRef.current;
            const size = map.getSize();
            canvas.width = size.x;
            canvas.height = size.y;
            L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
            
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, size.x, size.y);

            // ── Clip to farm boundary polygon ────────────────────────────
            const hasClip = farmBoundary && farmBoundary.coordinates;
            if (hasClip) {
                ctx.save();
                ctx.beginPath();
                
                const rings = farmBoundary.coordinates;
                const outerRings = farmBoundary.type === 'MultiPolygon' 
                    ? rings.map(poly => poly[0]) 
                    : [rings[0]];
                
                for (const ring of outerRings) {
                    for (let i = 0; i < ring.length; i++) {
                        const [lng, lat] = ring[i];
                        const pt = map.latLngToContainerPoint([lat, lng]);
                        if (i === 0) {
                            ctx.moveTo(pt.x, pt.y);
                        } else {
                            ctx.lineTo(pt.x, pt.y);
                        }
                    }
                    ctx.closePath();
                }
                ctx.clip();
            }

            const features = data.features || [];
            if (features.length === 0) {
                if (hasClip) ctx.restore();
                return;
            }

            // ── Pass 1: Large soft base layer (background blend) ─────────
            ctx.globalCompositeOperation = 'source-over';
            for (const feature of features) {
                const val = feature.properties[activeBand];
                if (val === null || val === undefined || isNaN(val)) continue;

                const ring = feature.geometry.coordinates[0];
                let sumLng = 0, sumLat = 0;
                ring.forEach(([lng, lat]) => { sumLng += lng; sumLat += lat; });
                const center = map.latLngToContainerPoint([sumLat / ring.length, sumLng / ring.length]);

                const pts = ring.map(([lng, lat]) => map.latLngToContainerPoint([lat, lng]));
                let maxR = 0;
                pts.forEach(p => { maxR = Math.max(maxR, Math.hypot(p.x - center.x, p.y - center.y)); });
                const radius = Math.max(maxR * 2.2, 12);

                const color = ndviToColor(val);
                const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
                grad.addColorStop(0,    _rgba(color, 0.7));
                grad.addColorStop(0.35, _rgba(color, 0.55));
                grad.addColorStop(0.65, _rgba(color, 0.3));
                grad.addColorStop(1,    _rgba(color, 0));

                ctx.beginPath();
                ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = grad;
                ctx.fill();
            }

            // ── Pass 2: Tighter core blobs blended on top ────────────────
            ctx.globalCompositeOperation = 'source-atop';
            for (const feature of features) {
                const val = feature.properties[activeBand];
                if (val === null || val === undefined || isNaN(val)) continue;

                const ring = feature.geometry.coordinates[0];
                let sumLng = 0, sumLat = 0;
                ring.forEach(([lng, lat]) => { sumLng += lng; sumLat += lat; });
                const center = map.latLngToContainerPoint([sumLat / ring.length, sumLng / ring.length]);

                const pts = ring.map(([lng, lat]) => map.latLngToContainerPoint([lat, lng]));
                let maxR = 0;
                pts.forEach(p => { maxR = Math.max(maxR, Math.hypot(p.x - center.x, p.y - center.y)); });
                const radius = Math.max(maxR * 1.5, 8);

                const color = ndviToColor(val);
                const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
                grad.addColorStop(0,    _rgba(color, 0.85));
                grad.addColorStop(0.4,  _rgba(color, 0.6));
                grad.addColorStop(0.75, _rgba(color, 0.25));
                grad.addColorStop(1,    _rgba(color, 0));

                ctx.beginPath();
                ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = grad;
                ctx.fill();
            }

            // ── Pass 3: Sharp detail pass for color richness ─────────────
            ctx.globalCompositeOperation = 'source-atop';
            for (const feature of features) {
                const val = feature.properties[activeBand];
                if (val === null || val === undefined || isNaN(val)) continue;

                const ring = feature.geometry.coordinates[0];
                let sumLng = 0, sumLat = 0;
                ring.forEach(([lng, lat]) => { sumLng += lng; sumLat += lat; });
                const center = map.latLngToContainerPoint([sumLat / ring.length, sumLng / ring.length]);

                const pts = ring.map(([lng, lat]) => map.latLngToContainerPoint([lat, lng]));
                let maxR = 0;
                pts.forEach(p => { maxR = Math.max(maxR, Math.hypot(p.x - center.x, p.y - center.y)); });
                const radius = Math.max(maxR * 0.9, 5);

                const color = ndviToColor(val);
                const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
                grad.addColorStop(0,   _rgba(color, 0.6));
                grad.addColorStop(0.5, _rgba(color, 0.3));
                grad.addColorStop(1,   _rgba(color, 0));

                ctx.beginPath();
                ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = grad;
                ctx.fill();
            }

            ctx.globalCompositeOperation = 'source-over';

            // Restore context if we clipped
            if (hasClip) {
                ctx.restore();
            }
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

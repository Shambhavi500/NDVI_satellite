import React, { useRef, useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, FeatureGroup, GeoJSON, Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw';
import { Pentagon } from 'lucide-react';
import HeatmapLayer from './HeatmapLayer';
import { getColor } from './colorUtils';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

/** Unified palette color for hover tooltip — works for both S2 and S1 */
function heatmapPaletteColor(rawValue, band, satellite) {
    if (rawValue === null || rawValue === undefined) return '#94a3b8';
    const n = Number(rawValue);
    if (Number.isNaN(n)) return '#94a3b8';
    return getColor(n, band, satellite);
}

/** Get display label + units for a band */
function getBandDisplayInfo(band, satellite) {
    if (satellite === 'sentinel1') {
        switch (band) {
            case 'smi':         return { label: 'SMI', unit: '%', format: (v) => `${(v * 100).toFixed(1)}%` };
            case 'rvi':         return { label: 'RVI', unit: '', format: (v) => v.toFixed(4) };
            case 'vv_vh_ratio': return { label: 'VV/VH', unit: '', format: (v) => v.toFixed(3) };
            case 'vv':          return { label: 'VV', unit: 'dB', format: (v) => `${v.toFixed(2)} dB` };
            case 'vh':          return { label: 'VH', unit: 'dB', format: (v) => `${v.toFixed(2)} dB` };
            default:            return { label: band.toUpperCase(), unit: '', format: (v) => v.toFixed(4) };
        }
    }
    return { label: band.toUpperCase(), unit: '', format: (v) => v.toFixed(4) };
}

/** Get interpretation text for hover tooltip */
function getTooltipInterpretation(value, band, satellite) {
    if (!Number.isFinite(value)) return '—';

    if (satellite === 'sentinel1') {
        switch (band) {
            case 'smi':
                if (value < 0.2) return 'Dry — irrigate';
                if (value < 0.5) return 'Moderate moisture';
                if (value < 0.8) return 'Good moisture';
                return 'Wet — monitor drainage';
            case 'rvi':
                if (value < 0.3) return 'Sparse vegetation';
                if (value < 0.6) return 'Moderate vegetation';
                return 'Dense vegetation';
            case 'vv_vh_ratio':
                if (value < 4) return 'Dense crop canopy';
                if (value < 8) return 'Growing stage';
                return 'Sparse / bare soil';
            case 'vv':
                if (value < -15) return 'Wet surface';
                if (value < -10) return 'Moderate moisture';
                return 'Dry surface';
            case 'vh':
                if (value < -20) return 'Sparse vegetation';
                if (value < -15) return 'Moderate vegetation';
                return 'Dense vegetation';
            default:
                return '—';
        }
    }

    // S2 default
    if (value < 0.3) return 'Sparse vegetation';
    if (value <= 0.6) return 'Moderate vegetation';
    return 'Dense vegetation';
}

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function FlyToHook({ center }) {
    const map = useMap();
    useEffect(() => {
        if (center) {
            map.flyTo(center, 15, { animate: true, duration: 1.5 });
        }
    }, [center, map]);
    return null;
}

/**
 * Dismiss the "map your farm" hint when the user activates the polygon tool.
 * Uses capture on pointerdown without preventDefault so Leaflet Draw still receives the click.
 */
function DrawHintDismissOnPolygonClick({ onPolygonToolActivate }) {
    const map = useMap();
    useEffect(() => {
        const root = map.getContainer();
        const onPointerDownCapture = (e) => {
            const t = e.target;
            if (!(t instanceof Element)) return;
            const a = t.closest('a.leaflet-draw-draw-polygon');
            if (!a || !root.contains(a)) return;
            onPolygonToolActivate();
        };
        document.addEventListener('pointerdown', onPointerDownCapture, true);
        return () => document.removeEventListener('pointerdown', onPointerDownCapture, true);
    }, [map, onPolygonToolActivate]);
    return null;
}

function NativeDrawControl({ onCreated, onDeleted, featureGroupRef }) {
    const map = useMap();
    
    useEffect(() => {
        if (!map || !featureGroupRef.current) return;
        
        const drawControl = new L.Control.Draw({
            position: 'topright',
            draw: {
                rectangle: false,
                circle: false,
                circlemarker: false,
                marker: false,
                polyline: false,
                polygon: {
                    allowIntersection: false,
                    drawError: { color: '#ef4444', message: 'ERROR: Intersections not allowed.' },
                    shapeOptions: { color: '#ffffff', weight: 4, fillOpacity: 0.0 }
                }
            },
            edit: false
        });
        
        map.addControl(drawControl);

        const handleDrawCreated = (e) => onCreated(e);
        const handleDrawDeleted = (e) => onDeleted(e);

        map.on(L.Draw.Event.CREATED, handleDrawCreated);
        map.on(L.Draw.Event.DELETED, handleDrawDeleted);

        return () => {
            map.removeControl(drawControl);
            map.off(L.Draw.Event.CREATED, handleDrawCreated);
            map.off(L.Draw.Event.DELETED, handleDrawDeleted);
        };
    }, [map, onCreated, onDeleted, featureGroupRef]);

    return null;
}

const editVertexIcon = L.divIcon({
    className: 'farm-edit-vertex',
    html: '<div style="width:14px;height:14px;border-radius:50%;background:#22c55e;border:2px solid #ffffff;box-shadow:0 0 0 2px rgba(34,197,94,0.35)"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
});

function _toFourVertexLatLng(boundary) {
    if (!boundary?.coordinates) return [];
    const ring = boundary.type === 'MultiPolygon'
        ? boundary.coordinates?.[0]?.[0] || []
        : boundary.coordinates?.[0] || [];

    const pts = ring.map(([lng, lat]) => [lat, lng]);
    if (!pts.length) return [];

    const first = pts[0];
    const last = pts[pts.length - 1];
    const isClosed = first[0] === last[0] && first[1] === last[1];
    const open = isClosed ? pts.slice(0, -1) : pts;
    return open.slice(0, 4);
}

function _toPolygonGeometry(vertices) {
    const open = vertices.slice(0, 4).map(([lat, lng]) => [lng, lat]);
    if (!open.length) return null;
    const closed = [...open, open[0]];
    return { type: 'Polygon', coordinates: [closed] };
}

/**
 * Fixed 4-vertex editable boundary:
 * - only corner markers are draggable
 * - no add/remove points
 * - geometry is emitted via onEditUpdate while dragging
 */
function FarmBoundaryLayer({ boundary, isActive, isEditing, onClick, onEditUpdate }) {
    const [vertices, setVertices] = useState(() => _toFourVertexLatLng(boundary));

    useEffect(() => {
        setVertices(_toFourVertexLatLng(boundary));
    }, [boundary, isEditing]);

    if (!vertices?.length) return null;

    const polygonPositions = [vertices];

    const updateVertex = (idx, latlng) => {
        setVertices((prev) => {
            const next = [...prev];
            next[idx] = [latlng.lat, latlng.lng];
            const geom = _toPolygonGeometry(next);
            if (geom) onEditUpdate?.(geom);
            return next;
        });
    };

    return (
        <>
            <Polygon
                positions={polygonPositions}
                eventHandlers={{ click: onClick }}
                pathOptions={{
                    color: isActive ? '#ffffff' : '#a1a1aa',
                    weight: isActive ? 5 : 3,
                    fillOpacity: 0.1,
                    fillColor: isActive ? 'transparent' : '#a1a1aa',
                    opacity: 1,
                    dashArray: null,
                }}
            />

            {isEditing && vertices.map((pos, idx) => (
                <Marker
                    key={`v-${idx}`}
                    position={pos}
                    draggable
                    icon={editVertexIcon}
                    eventHandlers={{
                        drag: (e) => updateVertex(idx, e.target.getLatLng()),
                        dragend: (e) => updateVertex(idx, e.target.getLatLng()),
                    }}
                />
            ))}
        </>
    );
}


export default function MapView({ 
    center, 
    activeBand, 
    activeSatellite = 'sentinel2',
    analysisData,
    activeFieldId,
    editingFieldId,
    editBoundarySnapshot = null,
    fields = [], 
    onDrawComplete, 
    onDrawDelete,
    onGeometryEdit,
    showDrawHint = false,
}) {
    const featureGroupRef = useRef();
    const [hoverData, setHoverData] = useState(null);
    const [drawHintDismissed, setDrawHintDismissed] = useState(false);
    const prevShowDrawHintRef = useRef(showDrawHint);

    // Extract farm boundary from analysisData
    const farmBoundary = analysisData?.farm_boundary || null;

    useEffect(() => {
        if (showDrawHint && !prevShowDrawHintRef.current) {
            setDrawHintDismissed(false);
        }
        prevShowDrawHintRef.current = showDrawHint;
    }, [showDrawHint]);

    const dismissDrawHint = useCallback(() => {
        setDrawHintDismissed(true);
    }, []);
    
    // Resolve frontend map tile URL for the current active vegetation index
    const tileUrl = analysisData 
        ? analysisData.index_tiles?.[`${activeBand?.toLowerCase()}_tile_url`] 
            || (activeBand?.toLowerCase() === 'ndvi' && analysisData.ndvi_tile_url)
            || analysisData.tile_url
        : null;

    const handleCreated = (e) => {
        const { layerType, layer } = e;
        if (layerType === 'polygon') {
            const geojsonObj = layer.toGeoJSON();
            onDrawComplete(geojsonObj.geometry);
            
            // Hand over rendering to React state
            const fg = featureGroupRef.current;
            fg.removeLayer(layer);
        }
    };

    const handleDeleted = () => {
        onDrawDelete();
    };

    const cellStyle = () => {
        return { fillColor: 'transparent', fillOpacity: 0, color: 'transparent', weight: 0 };
    };

    const bandKey = activeBand.toLowerCase();
    const bandInfo = getBandDisplayInfo(bandKey, activeSatellite);

    const onEachFeature = (feature, layer) => {
        layer.on({
            mouseover: async (e) => {
                const props = feature.properties;
                const raw = props[bandKey];
                const numeric = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
                setHoverData({
                   bandValue: Number.isFinite(numeric) ? bandInfo.format(numeric) : 'N/A',
                   bandNumeric: numeric,
                   bandLabelColor: heatmapPaletteColor(numeric, bandKey, activeSatellite),
                   x: e.originalEvent.pageX,
                   y: e.originalEvent.pageY
                });
            },
            mouseout: (e) => {
                layer.setStyle(cellStyle());
                setHoverData(null);
            },
            mousemove: (e) => {
                setHoverData((prev) => {
                    if (!prev) return null;
                    return {
                        ...prev,
                        x: e.originalEvent.pageX,
                        y: e.originalEvent.pageY,
                    };
                });
            }
        });
    };

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <MapContainer 
                center={center} 
                zoom={14} 
                style={{ width: '100%', height: '100%', background: 'var(--c-map-bg, #121920)' }}
                zoomControl={false}
            >
                <TileLayer
                    url="http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                    subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
                    maxZoom={20}
                    attribution="Map data &copy; Google"
                />
                
                <FeatureGroup ref={featureGroupRef}>
                    <NativeDrawControl 
                        onCreated={handleCreated} 
                        onDeleted={handleDeleted} 
                        featureGroupRef={featureGroupRef} 
                    />
                </FeatureGroup>

                {/* Render boundaries for all drawn fields */}
                {fields.map(f => (
                    <FarmBoundaryLayer 
                        key={f.id} 
                        boundary={
                            f.id === editingFieldId && editBoundarySnapshot
                                ? editBoundarySnapshot
                                : f.geometry
                        } 
                        isActive={f.id === activeFieldId}
                        isEditing={f.id === editingFieldId}
                        onEditUpdate={(geo) => onGeometryEdit(f.id, geo)}
                        onClick={() => {}}
                    />
                ))}

                {/* Heatmap / grid hidden while editing so vertices stay usable; analysis re-runs after Done */}
                {analysisData && activeFieldId && !editingFieldId && (
                    <>
                        <HeatmapLayer
                            data={analysisData}
                            activeBand={bandKey}
                            activeSatellite={activeSatellite}
                            farmBoundary={fields.find(f => f.id === activeFieldId)?.geometry}
                        />
                        <GeoJSON 
                            key={`${JSON.stringify(analysisData.farm_summary || analysisData.date)}-${activeBand}-${activeSatellite}`}
                            data={analysisData} 
                            style={cellStyle}
                            onEachFeature={onEachFeature}
                        />
                    </>
                )}

                <FlyToHook center={center} />
                <DrawHintDismissOnPolygonClick onPolygonToolActivate={dismissDrawHint} />
            </MapContainer>

            {showDrawHint && !drawHintDismissed && (
                <div className="map-draw-hint" role="note">
                    <button
                        type="button"
                        className="map-draw-hint__dismiss"
                        aria-label="Dismiss hint"
                        onClick={(e) => {
                            e.stopPropagation();
                            dismissDrawHint();
                        }}
                    >
                        ×
                    </button>
                    <span className="map-draw-hint__arrow" aria-hidden>↓</span>
                    <Pentagon className="map-draw-hint__icon" size={13} strokeWidth={2} aria-hidden />
                    <p className="map-draw-hint__text">
                        <span className="map-draw-hint__lead">Map your farm</span>
                        <span className="map-draw-hint__sub">
                            Click <strong>polygon</strong> above, then trace your field. Finish and cancel stay in the toolbar above while you draw.
                        </span>
                    </p>
                </div>
            )}

            {hoverData && (
                <div 
                    className="ndvi-tooltip is-visible"
                    style={{ left: hoverData.x + 15, top: hoverData.y + 15 }}
                >
                    <div style={{ fontWeight: 500, fontSize: "15px", color: "#fff" }}>
                        <span
                            className="ndvi-tooltip__band-tag"
                            style={{
                                fontWeight: 600,
                                color: hoverData.bandLabelColor,
                                transition: 'color 0.14s ease-out',
                            }}
                        >
                            {bandInfo.label}:{' '}
                        </span>
                        <span style={{ color: '#e2e8f0' }}>{hoverData.bandValue}</span>
                    </div>
                    <div
                        className="ndvi-tooltip__hint"
                        style={{
                            fontSize: '13px',
                            fontWeight: 400,
                            marginTop: '4px',
                            color: Number.isFinite(hoverData.bandNumeric)
                                ? hoverData.bandLabelColor
                                : '#a1a1aa',
                            opacity: Number.isFinite(hoverData.bandNumeric) ? 0.88 : 1,
                            transition: 'color 0.14s ease-out, opacity 0.14s ease-out',
                        }}
                    >
                        {getTooltipInterpretation(hoverData.bandNumeric, bandKey, activeSatellite)}
                    </div>
                </div>
            )}
        </div>
    );
}

import React, { useRef, useEffect, useState } from 'react';
import { MapContainer, TileLayer, FeatureGroup, GeoJSON, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw';
import HeatmapLayer from './HeatmapLayer';
import { samplePixel } from './api';

import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

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

/**
 * Renders a thick white border around the farm polygon and enables editing when active.
 */
function FarmBoundaryLayer({ boundary, isActive, isEditing, onClick, onEditUpdate }) {
    const polygonRef = useRef(null);

    useEffect(() => {
        const layer = polygonRef.current;
        if (!layer || !layer.editing) return;

        if (isEditing) {
            layer.editing.enable();
            const onEdit = () => {
                const geojson = layer.toGeoJSON();
                if (onEditUpdate) onEditUpdate(geojson.geometry);
            };
            layer.on('edit', onEdit);
            return () => {
                layer.off('edit', onEdit);
            };
        } else {
            layer.editing.disable();
        }
    }, [isEditing, onEditUpdate]);

    if (!boundary || !boundary.coordinates) return null;
    
    // Convert GeoJSON coordinates [lng, lat] to Leaflet [lat, lng]
    const rings = boundary.type === 'MultiPolygon'
        ? boundary.coordinates.map(poly => poly[0].map(([lng, lat]) => [lat, lng]))
        : [boundary.coordinates[0].map(([lng, lat]) => [lat, lng])];
    
    return (
        <>
            {rings.map((positions, i) => (
                <Polygon
                    ref={polygonRef}
                    key={i}
                    positions={positions}
                    eventHandlers={{ click: onClick }}
                    pathOptions={{
                        color: isActive ? '#ffffff' : '#a1a1aa', // Dimmer if not active
                        weight: isActive ? 5 : 3,
                        fillOpacity: 0.1,
                        fillColor: isActive ? 'transparent' : '#a1a1aa',
                        opacity: 1,
                        dashArray: null,
                    }}
                />
            ))}
        </>
    );
}


export default function MapView({ 
    center, 
    activeBand, 
    analysisData,
    activeFieldId,
    editingFieldId,
    fields = [], 
    onDrawComplete, 
    onDrawDelete,
    onGeometryEdit
}) {
    const featureGroupRef = useRef();
    const [hoverData, setHoverData] = useState(null);

    // Extract farm boundary from analysisData
    const farmBoundary = analysisData?.farm_boundary || null;
    
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

    const onEachFeature = (feature, layer) => {
        layer.on({
            mouseover: async (e) => {
                const props = feature.properties;
                
                // Set hover data directly from feature properties first
                const bandKey = activeBand.toLowerCase();
                setHoverData({
                   ndvi: props.ndvi?.toFixed(4) || 'N/A',
                   cvi: props.cvi?.toFixed(4) || 'N/A',
                   evi: props.evi?.toFixed(4) || 'N/A',
                   bandValue: props[bandKey]?.toFixed(4) || 'N/A',
                   x: e.originalEvent.pageX,
                   y: e.originalEvent.pageY
                });

            },
            mouseout: (e) => {
                layer.setStyle(cellStyle());
                setHoverData(null);
            },
            mousemove: (e) => {
                if (hoverData) {
                    setHoverData(prev => ({
                        ...prev,
                        x: e.originalEvent.pageX,
                        y: e.originalEvent.pageY
                    }));
                }
            }
        });
    };

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <MapContainer 
                center={center} 
                zoom={14} 
                style={{ width: '100%', height: '100%', background: '#0a0a0a' }}
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
                        boundary={f.geometry} 
                        isActive={f.id === activeFieldId}
                        isEditing={f.id === editingFieldId}
                        onEditUpdate={(geo) => onGeometryEdit(f.id, geo)}
                        onClick={() => {}}
                    />
                ))}

                {/* Render heatmap AND grid ONLY for the active field */}
                {analysisData && activeFieldId && (
                    <>
                        <HeatmapLayer
                            data={analysisData}
                            activeBand={activeBand.toLowerCase()}
                            farmBoundary={fields.find(f => f.id === activeFieldId)?.geometry}
                        />
                        <GeoJSON 
                            key={JSON.stringify(analysisData.farm_summary || analysisData.date)}
                            data={analysisData} 
                            style={cellStyle}
                            onEachFeature={onEachFeature}
                        />
                    </>
                )}

                <FlyToHook center={center} />
            </MapContainer>

            {hoverData && (
                <div 
                    className="ndvi-tooltip is-visible"
                    style={{ left: hoverData.x + 15, top: hoverData.y + 15 }}
                >
                    <div style={{ fontWeight: 500, fontSize: "15px", color: "#fff" }}>
                        <span style={{ fontWeight: 600, color: '#22c55e' }}>{activeBand.toUpperCase()}: </span>{hoverData.bandValue}
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 400, color: "#a1a1aa", marginTop: "4px" }}>
                        {hoverData.bandValue < 0.3 ? "Sparse vegetation" : hoverData.bandValue <= 0.6 ? "Moderate vegetation" : "Dense vegetation"}
                    </div>
                </div>
            )}
        </div>
    );
}

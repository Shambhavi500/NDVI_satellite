import React, { useState } from 'react';
import MapView from './MapView';
import Sidebar from './Sidebar';
import LayerToggle from './LayerToggle';
import Legend from './Legend';
import LoadingOverlay from './LoadingOverlay';
import TimelineBar from './TimelineBar';
import { analyzeFarm, fetchAvailableDates, fetchDayAnalysis } from './api';
import * as turf from '@turf/turf';
import './index.css';

export default function App() {
  const [activeBand, setActiveBand] = useState('ndvi');
  const [mapCenter, setMapCenter] = useState([18.1676592, 75.8131346]);
  
  // Multi-field state
  const [fields, setFields] = useState([]);
  const [activeFieldId, setActiveFieldId] = useState(null);
  const [editingFieldId, setEditingFieldId] = useState(null);
  
  // Loading state
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isDayLoading, setIsDayLoading] = useState(false);

  // Derived state for the currently selected field
  const activeField = fields.find(f => f.id === activeFieldId);
  const analysisData = activeField?.analysisData || null;
  const drawnGeometry = activeField?.geometry || null;
  const availableDates = activeField?.availableDates || [];
  const selectedDate = activeField?.selectedDate || null;

  const simulateProgress = () => {
    setCurrentStep(0);
    let step = 0;
    const interval = setInterval(() => {
        step++;
        if (step <= 4) {
            setCurrentStep(step);
        } else {
            clearInterval(interval);
        }
    }, 1500); // simulate steps for UX
    return interval;
  };

  const handleFlyTo = (coords) => {
    setMapCenter(coords);
  };

  const handleDrawComplete = async (geometry) => {
    setIsLoading(true);
    const progressTimer = simulateProgress();

    // 1. Setup new field object and calculate area
    const areaSqMeters = turf.area(geometry);
    const areaHectares = (areaSqMeters / 10000).toFixed(2);
    
    // Auto-generate name based on number of fields
    const newFieldId = Date.now().toString();
    const newFieldName = `Field ${fields.length + 1}`;

    const newField = {
        id: newFieldId,
        name: newFieldName,
        areaHectares: areaHectares,
        geometry: geometry,
        analysisData: null,
        availableDates: [],
        selectedDate: null
    };

    try {
        // 2. Run main analysis (90-day composite — initial view)
        const data = await analyzeFarm(geometry);
        if (data.error) {
            alert(`Error: ${data.error}`);
        } else {
            newField.analysisData = data;
        }

        // 3. Fetch available dates for timeline
        try {
            const dateResult = await fetchAvailableDates(geometry);
            if (dateResult.dates && dateResult.dates.length > 0) {
                newField.availableDates = dateResult.dates;
                newField.selectedDate = dateResult.dates[dateResult.dates.length - 1]; // Select most recent
            }
        } catch (dateErr) {
            console.warn('Could not fetch available dates:', dateErr);
        }

        // Add the new field and set it as active
        setFields(prev => [...prev, newField]);
        setActiveFieldId(newFieldId);
        
    } catch (err) {
        console.error(err);
        alert(err.message || 'Analysis failed.');
    } finally {
        clearInterval(progressTimer);
        setIsLoading(false);
        setCurrentStep(0);
    }
  };

  const handleDrawDelete = () => {
    // We handle delete per-field now if needed, but for native draw delete:
    if (activeFieldId) {
        setFields(prev => prev.filter(f => f.id !== activeFieldId));
        setActiveFieldId(null);
    }
  };

  const handleDateSelect = async (date) => {
    if (!activeField || date === activeField.selectedDate) return;
    
    // Optimistically set the date for this field
    setFields(prev => prev.map(f => f.id === activeFieldId ? { ...f, selectedDate: date } : f));
    setIsDayLoading(true);

    try {
        const dayData = await fetchDayAnalysis(activeField.geometry, date);
        if (dayData.error) {
            console.warn(`No data for ${date}: ${dayData.error}`);
            // Keep existing analysis data visible
        } else {
            setFields(prev => prev.map(f => f.id === activeFieldId ? { ...f, analysisData: dayData } : f));
        }
    } catch (err) {
        console.error('Day analysis failed:', err);
    } finally {
        setIsDayLoading(false);
    }
  };

  const handleRenameField = (id, newName) => {
      setFields(prev => prev.map(f => f.id === id ? { ...f, name: newName } : f));
  };

  const handleGeometryEdit = (id, newGeometry) => {
      setFields(prev => prev.map(f => {
          if (f.id === id) {
              const areaSqMeters = turf.area(newGeometry);
              const areaHectares = (areaSqMeters / 10000).toFixed(2);
              return { ...f, geometry: newGeometry, areaHectares };
          }
          return f;
      }));
  };

  const handleFinishEditing = async () => {
      const id = editingFieldId;
      setEditingFieldId(null);
      if (!id) return;
      
      const updatedField = fields.find(f => f.id === id);
      if (!updatedField) return;

      setIsLoading(true);
      const progressTimer = simulateProgress();
      
      // Clear old dates and analysis initially
      setFields(prev => prev.map(f => f.id === id ? { ...f, analysisData: null, availableDates: [], selectedDate: null } : f));
      
      try {
          const data = await analyzeFarm(updatedField.geometry);
          let newAvailableDates = [];
          let newSelectedDate = null;
          
          if (!data.error) {
              try {
                  const dateResult = await fetchAvailableDates(updatedField.geometry);
                  if (dateResult.dates && dateResult.dates.length > 0) {
                      newAvailableDates = dateResult.dates;
                      newSelectedDate = dateResult.dates[dateResult.dates.length - 1]; 
                  }
              } catch (err) { console.warn(err); }
          }
          
          setFields(prev => prev.map(f => f.id === id ? {
              ...f,
              analysisData: data.error ? null : data,
              availableDates: newAvailableDates,
              selectedDate: newSelectedDate
          } : f));
          
      } catch (e) {
          console.error(e);
      } finally {
          clearInterval(progressTimer);
          setIsLoading(false);
          setCurrentStep(0);
      }
  };

  return (
    <>
      <nav className="navbar">
        <div className="navbar__brand">
          <div className="navbar__text">
            <span className="navbar__title">MindstriX</span>
            <span className="navbar__tagline">Farm Analysis</span>
          </div>
        </div>

        <div className="navbar__controls">
          {/* Field Manager Dropdown & Naming */}
          <div className="navbar__selectors" style={{marginRight: '8px'}}>
            {editingFieldId === activeFieldId && activeField ? (
                <input 
                    className="navbar__select" 
                    autoFocus
                    defaultValue={activeField.name}
                    onBlur={(e) => {
                        if (e.target.value.trim() !== '') {
                            handleRenameField(activeFieldId, e.target.value);
                        }
                        handleFinishEditing();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            if (e.target.value.trim() !== '') {
                                handleRenameField(activeFieldId, e.target.value);
                            }
                            handleFinishEditing();
                        }
                    }}
                    style={{width: '140px'}}
                />
            ) : (
                <div className="navbar__dropdown field-selector-dropdown">
                  <select 
                    className="navbar__select" 
                    value={activeFieldId || "empty"} 
                    onChange={(e) => {
                        if (e.target.value === "add_new") {
                            setActiveFieldId(null);
                        } else {
                            setActiveFieldId(e.target.value);
                        }
                    }}
                  >
                      {fields.length === 0 && <option value="empty" disabled>Draw to add Field</option>}
                  {fields.map(f => (
                          <option key={f.id} value={f.id}>
                              {f.name}
                          </option>
                      ))}
                      {fields.length > 0 && <option value="add_new">+ Add New Field</option>}
                  </select>
                  <div className="navbar__select-arrow">▼</div>
                </div>
            )}
            
            {activeFieldId && editingFieldId !== activeFieldId && (
                <button 
                  className="navbar__action-btn"
                  onClick={() => setEditingFieldId(activeFieldId)}
                  title="Rename Field"
                  style={{ background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer', padding: '0 8px', fontSize: '13px', fontWeight: '500' }}
                >
                  Edit
                </button>
            )}
            <div className="navbar__select-divider"></div>
          </div>

          {/* Satellite / Index Dropdowns */}
          <div className="navbar__selectors">
            <div className="navbar__dropdown">
              <select className="navbar__select" defaultValue="sentinel2">
                <option value="sentinel2">Sentinel-2</option>
              </select>
              <div className="navbar__select-arrow">▼</div>
            </div>
            
            <div className="navbar__select-divider"></div>

            <div className="navbar__dropdown">
              <select 
                className="navbar__select" 
                value={activeBand} 
                onChange={(e) => setActiveBand(e.target.value)}
              >
                <option value="ndvi">NDVI</option>
                <option value="evi">EVI</option>
                <option value="savi">SAVI</option>
                <option value="ndmi">NDMI</option>
                <option value="gndvi">GNDVI</option>
                <option value="cvi">CVI</option>
              </select>
              <div className="navbar__select-arrow">▼</div>
            </div>
          </div>

          <div className={`navbar__status ${isLoading ? 'is-loading' : analysisData ? 'is-success' : 'is-idle'}`}>
            <div className="status-dot"></div>
            <span>{isLoading ? 'Analyzing...' : analysisData ? 'Ready' : 'Draw a polygon to start'}</span>
          </div>
        </div>
      </nav>

      <div className="app-layout">
        <Sidebar 
            onFlyTo={handleFlyTo} 
            analysisData={analysisData}
            activeBand={activeBand}
            activeFieldId={activeFieldId}
            activeField={activeField}
        />
        
        <main className="map-wrapper">
          <MapView 
              center={mapCenter}
              activeBand={activeBand}
              analysisData={analysisData}
              activeFieldId={activeFieldId}
              editingFieldId={editingFieldId}
              fields={fields}
              onDrawComplete={handleDrawComplete}
              onDrawDelete={handleDrawDelete}
              onGeometryEdit={handleGeometryEdit}
          />

          {analysisData && activeFieldId && (
              <Legend activeLayer={activeBand} histogramData={analysisData.farm_summary?.ndvi_histogram} />
          )}



          {/* Timeline bar at the bottom — shows available dates */}
          {availableDates.length > 0 && (
              <TimelineBar
                  dates={availableDates}
                  selectedDate={selectedDate}
                  onDateSelect={handleDateSelect}
                  isLoading={isDayLoading}
              />
          )}

          <LoadingOverlay isVisible={isLoading} currentStepIdx={currentStep} />

          {/* Day loading mini indicator */}
          {isDayLoading && !isLoading && (
              <div className="day-loading-indicator">
                  <div className="day-loading-spinner" />
                  <span>Loading imagery…</span>
              </div>
          )}
        </main>
      </div>
    </>
  );
}

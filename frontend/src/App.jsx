import React, { useState, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from './firebase';
import MapView from './MapView';
import Sidebar from './Sidebar';
import Legend from './Legend';
import LoadingOverlay from './LoadingOverlay';
import TimelineBar from './TimelineBar';
import NavbarDropdown from './NavbarDropdown';
import PremiumAuthFlow from './PremiumAuthFlow';
import { analyzeFarm, fetchAvailableDates, fetchDayAnalysis } from './api';
import * as turf from '@turf/turf';
import './index.css';

export default function App() {
  // ── Auth gate ──────────────────────────────────────────────────
  const [authed, setAuthed]   = useState(false);
  const [user,   setUser]     = useState(null);
  const [dashVisible, setDashVisible] = useState(false);

  const handleAuthSuccess = (userData) => {
    setUser(userData || null);
    setAuthed(true);
    // Small delay so Success screen checkmark can be seen
    setTimeout(() => setDashVisible(true), 300);
  };

  const handleLogout = async () => {
    try { if (auth) await signOut(auth); } catch {}
    setAuthed(false);
    setUser(null);
    setDashVisible(false);
  };

  // ── Dashboard state ────────────────────────────────────────────
  const [activeBand, setActiveBand] = useState('ndvi');
  const [mapCenter, setMapCenter]   = useState([18.1676592, 75.8131346]);
  
  // Multi-field state
  const [fields, setFields]             = useState([]);
  const [activeFieldId, setActiveFieldId] = useState(null);
  const [editingFieldId, setEditingFieldId] = useState(null);
  
  // Loading state
  const [isLoading, setIsLoading]     = useState(false);
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

  // ── Auth gate: show PremiumAuthFlow when not authenticated ──
  if (!authed) {
    return <PremiumAuthFlow onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <>
      <nav className="navbar">
        <div className="navbar__brand">
          <div className="navbar__text">
            <span className="navbar__title">MindstriX</span>
            <span className="navbar__tagline">Farm Analysis</span>
          </div>
        </div>

        <div className="navbar__controls" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
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
                <NavbarDropdown 
                    value={activeFieldId || "empty"}
                    onChange={(val) => {
                        if (val === "add_new") {
                            setActiveFieldId(null);
                        } else {
                            setActiveFieldId(val);
                        }
                    }}
                    options={[
                        ...(fields.length === 0 ? [{ value: "empty", label: "Draw to add Field", disabled: true }] : []),
                        ...fields.map(f => ({ value: f.id, label: f.name })),
                        ...(fields.length > 0 ? [{ value: "add_new", label: "+ Add New Field" }] : [])
                    ]}
                />
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
            <NavbarDropdown 
                value="sentinel2"
                onChange={() => {}}
                options={[{ value: "sentinel2", label: "Sentinel-2" }]}
            />
            
            <div className="navbar__select-divider"></div>

            <NavbarDropdown 
                value={activeBand}
                onChange={(val) => setActiveBand(val)}
                options={[
                    { value: "ndvi", label: "NDVI" },
                    { value: "evi", label: "EVI" },
                    { value: "savi", label: "SAVI" },
                    { value: "ndmi", label: "NDMI" },
                    { value: "gndvi", label: "GNDVI" },
                    { value: "cvi", label: "CVI" }
                ]}
            />
          </div>

          <div className={`navbar__status ${isLoading ? 'is-loading' : analysisData ? 'is-success' : 'is-idle'}`}>
            <div className="status-dot"></div>
            <span>{isLoading ? 'Analyzing...' : analysisData ? 'Ready' : 'Draw a polygon to start'}</span>
          </div>

          <div className="navbar__select-divider"></div>

          {/* User info + Logout */}
          <div style={{ display:'flex', alignItems:'center', gap:8, marginLeft:8 }}>
            {user?.phone_number && (
              <span style={{ fontSize:12, color:'#22c55e', fontWeight:600 }}>
                {user.phone_number}
              </span>
            )}
            <button
              onClick={handleLogout}
              style={{
                background:'rgba(239,68,68,0.12)', color:'#ef4444', padding:'5px 12px',
                borderRadius:8, border:'1px solid rgba(239,68,68,0.25)', cursor:'pointer',
                fontSize:12, fontWeight:600, transition:'all 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(239,68,68,0.22)'}
              onMouseLeave={e => e.currentTarget.style.background='rgba(239,68,68,0.12)'}
            >
              Logout
            </button>
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

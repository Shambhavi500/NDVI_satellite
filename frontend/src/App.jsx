import React, { useState, useRef, useMemo } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from './firebase';
import MapView from './MapView';
import Sidebar from './Sidebar';
import Legend from './Legend';
import LoadingOverlay from './LoadingOverlay';
import TimelineBar from './TimelineBar';
import NavbarDropdown from './NavbarDropdown';
import PremiumAuthFlow from './PremiumAuthFlow';
import { analyzeFarm, fetchAvailableDates, fetchDayAnalysis, analyzeS1Farm, fetchS1AvailableDates, fetchS1DayAnalysis } from './api';
import * as turf from '@turf/turf';
import { ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import FieldNameModal from './FieldNameModal';
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
  const [activeSatellite, setActiveSatellite] = useState('sentinel2');
  const [mapCenter, setMapCenter]   = useState([18.1676592, 75.8131346]);
  
  // Multi-field state
  const [fields, setFields]             = useState([]);
  const [activeFieldId, setActiveFieldId] = useState(null);
  const [editingFieldId, setEditingFieldId] = useState(null);
  /** Snapshot when entering edit mode — Polygon positions stay stable while dragging (no React reset of handles). */
  const [editBoundarySnapshot, setEditBoundarySnapshot] = useState(null);
  /** Latest geometry while dragging vertices; committed on Done only. */
  const editGeometryRef = useRef(null);
  const [editNameDraft, setEditNameDraft] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** Ask for field name after draw (`new`) or from dropdown rename (`rename`). */
  const [nameModal, setNameModal] = useState(null);

  // Loading state
  const [isLoading, setIsLoading]     = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isDayLoading, setIsDayLoading] = useState(false);
  const [isS1Loading, setIsS1Loading] = useState(false);

  // Derived state for the currently selected field
  const activeField = fields.find(f => f.id === activeFieldId);

  // Pick analysis data based on active satellite
  const analysisData = activeSatellite === 'sentinel1'
    ? (activeField?.s1AnalysisData || null)
    : (activeField?.analysisData || null);

  const drawnGeometry = activeField?.geometry || null;

  const availableDates = activeSatellite === 'sentinel1'
    ? (activeField?.s1AvailableDates || [])
    : (activeField?.availableDates || []);

  const selectedDate = activeSatellite === 'sentinel1'
    ? (activeField?.s1SelectedDate || null)
    : (activeField?.selectedDate || null);

  // Band options per satellite
  const S2_BANDS = [
      { value: "ndvi", label: "NDVI" },
      { value: "evi", label: "EVI" },
      { value: "savi", label: "SAVI" },
      { value: "ndmi", label: "NDMI" },
      { value: "gndvi", label: "GNDVI" },
      { value: "cvi", label: "CVI" }
  ];

  const S1_BANDS = [
      { value: "smi", label: "Soil Moisture (SMI)" },
      { value: "rvi", label: "Radar Vegetation (RVI)" },
      { value: "vv_vh_ratio", label: "VV/VH Ratio" },
      { value: "vv", label: "VV Polarization" },
      { value: "vh", label: "VH Polarization" },
  ];

  const bandOptions = activeSatellite === 'sentinel1' ? S1_BANDS : S2_BANDS;

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

  const handleDrawComplete = (geometry) => {
    setNameModal({ type: 'new', geometry });
  };

  // ── Satellite switching + lazy S1 fetch ────────────────────────
  const handleSatelliteChange = async (sat) => {
    setActiveSatellite(sat);

    // Switch active band to first option of the new satellite
    if (sat === 'sentinel1') {
        setActiveBand('smi');

        // Lazy-fetch S1 data for active field if not yet fetched
        if (activeField && !activeField.s1AnalysisData && activeField.geometry) {
            setIsS1Loading(true);
            try {
                const s1Data = await analyzeS1Farm(activeField.geometry);
                let s1Dates = [];
                let s1SelectedDate = null;
                if (!s1Data.error) {
                    try {
                        const dateResult = await fetchS1AvailableDates(activeField.geometry);
                        if (dateResult.dates?.length > 0) {
                            s1Dates = dateResult.dates;
                            s1SelectedDate = dateResult.dates[dateResult.dates.length - 1];
                        }
                    } catch (e) { console.warn('S1 dates fetch error:', e); }
                }

                setFields(prev => prev.map(f => f.id === activeFieldId ? {
                    ...f,
                    s1AnalysisData: s1Data.error ? null : s1Data,
                    s1AvailableDates: s1Dates,
                    s1SelectedDate: s1SelectedDate,
                } : f));
            } catch (err) {
                console.error('S1 analysis failed:', err);
            } finally {
                setIsS1Loading(false);
            }
        }
    } else {
        setActiveBand('ndvi');
    }
  };

  const runNewFieldAnalysis = async (fieldName, geometry) => {
    setIsLoading(true);
    const progressTimer = simulateProgress();

    const areaSqMeters = turf.area(geometry);
    const areaHectares = (areaSqMeters / 10000).toFixed(2);
    const newFieldId = Date.now().toString();

    const newField = {
      id: newFieldId,
      name: fieldName.trim(),
      areaHectares,
      geometry,
      analysisData: null,
      availableDates: [],
      selectedDate: null,
      // S1 fields (lazy-loaded)
      s1AnalysisData: null,
      s1AvailableDates: [],
      s1SelectedDate: null,
    };

    try {
      const data = await analyzeFarm(geometry);
      if (data.error) {
        alert(`Error: ${data.error}`);
      } else {
        newField.analysisData = data;
      }

      try {
        const dateResult = await fetchAvailableDates(geometry);
        if (dateResult.dates && dateResult.dates.length > 0) {
          newField.availableDates = dateResult.dates;
          newField.selectedDate = dateResult.dates[dateResult.dates.length - 1];
        }
      } catch (dateErr) {
        console.warn('Could not fetch available dates:', dateErr);
      }

      setFields((prev) => [...prev, newField]);
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

  const handleConfirmFieldName = (name) => {
    const m = nameModal;
    if (!m) return;
    if (m.type === 'new') {
      const geometry = m.geometry;
      setNameModal(null);
      void runNewFieldAnalysis(name, geometry);
    } else {
      handleRenameField(m.fieldId, name);
      setNameModal(null);
    }
  };

  const fieldDropdownOptions = useMemo(() => {
    if (fields.length === 0) {
      return [{ value: 'empty', label: 'Draw to add field', disabled: true }];
    }
    return [
      ...fields.map((f) => ({ value: f.id, label: f.name })),
      { value: 'add_new', label: '+ Add new field' },
    ];
  }, [fields]);

  const handleDrawDelete = () => {
    // We handle delete per-field now if needed, but for native draw delete:
    if (activeFieldId) {
        setFields(prev => prev.filter(f => f.id !== activeFieldId));
        setActiveFieldId(null);
    }
  };

  const handleDateSelect = async (date) => {
    if (!activeField) return;

    if (activeSatellite === 'sentinel1') {
      if (date === activeField.s1SelectedDate) return;
      setFields(prev => prev.map(f => f.id === activeFieldId ? { ...f, s1SelectedDate: date } : f));
      setIsDayLoading(true);
      try {
        const dayData = await fetchS1DayAnalysis(activeField.geometry, date);
        if (!dayData.error) {
          setFields(prev => prev.map(f => f.id === activeFieldId ? { ...f, s1AnalysisData: dayData } : f));
        }
      } catch (err) { console.error('S1 day analysis failed:', err); }
      finally { setIsDayLoading(false); }
    } else {
      if (date === activeField.selectedDate) return;
      setFields(prev => prev.map(f => f.id === activeFieldId ? { ...f, selectedDate: date } : f));
      setIsDayLoading(true);
      try {
        const dayData = await fetchDayAnalysis(activeField.geometry, date);
        if (!dayData.error) {
          setFields(prev => prev.map(f => f.id === activeFieldId ? { ...f, analysisData: dayData } : f));
        }
      } catch (err) { console.error('Day analysis failed:', err); }
      finally { setIsDayLoading(false); }
    }
  };

  const handleRenameField = (id, newName) => {
      setFields(prev => prev.map(f => f.id === id ? { ...f, name: newName } : f));
  };

  /** While editing: only update ref so Leaflet handles stay mounted; no field state update per drag. */
  const handleGeometryEditLive = (id, newGeometry) => {
    if (id !== editingFieldId) return;
    editGeometryRef.current = newGeometry;
  };

  const handleCancelEditing = () => {
    setEditingFieldId(null);
    setEditBoundarySnapshot(null);
    editGeometryRef.current = null;
  };

  const handleFinishEditing = async () => {
    const id = editingFieldId;
    if (!id) return;

    const geom = editGeometryRef.current;
    setEditingFieldId(null);
    setEditBoundarySnapshot(null);
    editGeometryRef.current = null;

    if (!geom) return;

    const areaSqMeters = turf.area(geom);
    const areaHectares = (areaSqMeters / 10000).toFixed(2);

    setIsLoading(true);
    const progressTimer = simulateProgress();

    setFields((prev) =>
      prev.map((f) =>
        f.id === id
          ? { ...f, geometry: geom, areaHectares, analysisData: null, availableDates: [], selectedDate: null, s1AnalysisData: null, s1AvailableDates: [], s1SelectedDate: null }
          : f
      )
    );

    try {
      const data = await analyzeFarm(geom);
      let newAvailableDates = [];
      let newSelectedDate = null;

      if (!data.error) {
        try {
          const dateResult = await fetchAvailableDates(geom);
          if (dateResult.dates && dateResult.dates.length > 0) {
            newAvailableDates = dateResult.dates;
            newSelectedDate = dateResult.dates[dateResult.dates.length - 1];
          }
        } catch (err) {
          console.warn(err);
        }
      }

      setFields((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                analysisData: data.error ? null : data,
                availableDates: newAvailableDates,
                selectedDate: newSelectedDate,
              }
            : f
        )
      );
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
            <span className="navbar__title navbar__title--monitor">Satellite farm monitoring</span>
          </div>
        </div>

        <div className="navbar__controls navbar__controls--end">
          <div className="navbar__group">
            <div className="navbar__selectors">
            {editingFieldId === activeFieldId && activeField ? (
                <>
                  <input
                    className="navbar__select navbar__select--field-name"
                    autoFocus
                    value={editNameDraft}
                    onChange={(e) => setEditNameDraft(e.target.value)}
                    placeholder="Field name"
                    aria-label="Field name"
                  />
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => {
                      const name = editNameDraft.trim();
                      if (name) handleRenameField(activeFieldId, name);
                      handleFinishEditing();
                    }}
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={handleCancelEditing}
                  >
                    Cancel
                  </button>
                </>
            ) : (
                <div className="navbar__field-wrap">
                  <NavbarDropdown
                    value={activeFieldId || 'empty'}
                    onChange={(val) => {
                      if (val === 'add_new') {
                        setActiveFieldId(null);
                      } else {
                        setActiveFieldId(val);
                      }
                    }}
                    options={fieldDropdownOptions}
                  />
                  {activeFieldId && activeField && (
                    <button
                      type="button"
                      className="navbar__rename-field-btn"
                      title="Rename field"
                      aria-label="Rename field"
                      onClick={() =>
                        setNameModal({
                          type: 'rename',
                          fieldId: activeFieldId,
                          currentName: activeField.name,
                        })
                      }
                    >
                      <Pencil size={15} strokeWidth={2} aria-hidden />
                    </button>
                  )}
                </div>
            )}
            
            {activeFieldId && editingFieldId !== activeFieldId && activeField && (
                <button
                  type="button"
                  className="navbar__link-btn"
                  onClick={() => {
                    const g = activeField.geometry;
                    try {
                      editGeometryRef.current = structuredClone(g);
                    } catch {
                      editGeometryRef.current = JSON.parse(JSON.stringify(g));
                    }
                    try {
                      setEditBoundarySnapshot(structuredClone(g));
                    } catch {
                      setEditBoundarySnapshot(JSON.parse(JSON.stringify(g)));
                    }
                    setEditNameDraft(activeField.name || '');
                    setEditingFieldId(activeFieldId);
                  }}
                  title="Edit field boundary"
                >
                  Edit boundary
                </button>
            )}
            <div className="navbar__select-divider" aria-hidden="true" />
          </div>
          </div>

          <div className="navbar__group">
          <div className="navbar__selectors">
            <NavbarDropdown 
                value={activeSatellite}
                onChange={handleSatelliteChange}
                options={[
                    { value: "sentinel2", label: "Sentinel-2 (Optical)" },
                    { value: "sentinel1", label: "Sentinel-1 (Radar)" },
                ]}
            />
            
            <div className="navbar__select-divider"></div>

            <NavbarDropdown 
                value={activeBand}
                onChange={(val) => setActiveBand(val)}
                options={bandOptions}
            />
          </div>
          </div>

          <div className={`navbar__status ${isLoading || isS1Loading ? 'is-loading' : analysisData ? 'is-success' : 'is-idle'}`}>
            <div className="status-dot"></div>
            <span>{isLoading ? 'Analyzing…' : isS1Loading ? 'Loading radar…' : analysisData ? 'Ready' : 'Awaiting field'}</span>
          </div>

          <div className="navbar__user-bar">
            {user?.phone_number && (
              <span className="navbar__user-phone">{user.phone_number}</span>
            )}
            <button type="button" className="btn btn--danger-outline btn--sm" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </nav>

      <div className={`app-layout${sidebarCollapsed ? ' app-layout--sidebar-collapsed' : ''}`}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onFlyTo={handleFlyTo}
          analysisData={analysisData}
          activeBand={activeBand}
          activeSatellite={activeSatellite}
          activeFieldId={activeFieldId}
          activeField={activeField}
        />
        <button
          type="button"
          className="sidebar-edge-toggle"
          onClick={() => setSidebarCollapsed((c) => !c)}
          aria-expanded={!sidebarCollapsed}
          aria-controls="farm-assistant-sidebar"
          title={sidebarCollapsed ? 'Show assistant panel' : 'Hide assistant panel'}
        >
          {sidebarCollapsed ? (
            <ChevronRight size={15} strokeWidth={2} aria-hidden />
          ) : (
            <ChevronLeft size={15} strokeWidth={2} aria-hidden />
          )}
        </button>

        <main className="map-wrapper">
          <MapView 
              center={mapCenter}
              activeBand={activeBand}
              activeSatellite={activeSatellite}
              analysisData={analysisData}
              activeFieldId={activeFieldId}
              editingFieldId={editingFieldId}
              editBoundarySnapshot={editBoundarySnapshot}
              fields={fields}
              onDrawComplete={handleDrawComplete}
              onDrawDelete={handleDrawDelete}
              onGeometryEdit={handleGeometryEditLive}
              showDrawHint={fields.length === 0 && !editingFieldId}
          />

          {analysisData && activeFieldId && (
              <Legend activeLayer={activeBand} activeSatellite={activeSatellite} histogramData={analysisData.farm_summary?.ndvi_histogram} />
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
          {(isDayLoading || isS1Loading) && !isLoading && (
              <div className="day-loading-indicator">
                  <div className="day-loading-spinner" />
                  <span>{isS1Loading ? 'Loading radar data…' : 'Loading imagery…'}</span>
              </div>
          )}
        </main>
      </div>

      <FieldNameModal
        open={nameModal !== null}
        title={nameModal?.type === 'rename' ? 'Rename field' : 'Name this field'}
        description={
          nameModal?.type === 'new'
            ? 'Satellite analysis runs after you confirm the name.'
            : undefined
        }
        initialName={
          nameModal?.type === 'rename'
            ? nameModal.currentName || ''
            : `Field ${fields.length + 1}`
        }
        confirmLabel={nameModal?.type === 'rename' ? 'Save' : 'Run analysis'}
        onConfirm={handleConfirmFieldName}
        onCancel={() => setNameModal(null)}
      />
    </>
  );
}

import React, { useState } from 'react';
import MapView from './MapView';
import Sidebar from './Sidebar';
import LayerToggle from './LayerToggle';
import Legend from './Legend';
import LoadingOverlay from './LoadingOverlay';
import { analyzeFarm } from './api';
import './index.css';

export default function App() {
  const [activeBand, setActiveBand] = useState('ndvi');
  const [mapCenter, setMapCenter] = useState([13.42294, 75.53250]);
  const [analysisData, setAnalysisData] = useState(null);
  
  // Loading state
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

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
    setAnalysisData(null);
    const progressTimer = simulateProgress();

    try {
        const data = await analyzeFarm(geometry);
        if (data.error) {
            alert(`Error: ${data.error}`);
        } else {
            setAnalysisData(data);
        }
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
    setAnalysisData(null);
  };

  return (
    <>
      <nav className="navbar">
        <div className="navbar__brand">
          <div className="navbar__logo">🛰️</div>
          <div className="navbar__text">
            <span className="navbar__title">MindstriX</span>
            <span className="navbar__tagline">Farm Analysis</span>
          </div>
        </div>
        <div className={`navbar__status ${isLoading ? 'is-loading' : analysisData ? 'is-success' : 'is-idle'}`}>
          <div className="status-dot"></div>
          <span>{isLoading ? 'Analyzing...' : analysisData ? 'Ready' : 'Draw a polygon to start'}</span>
        </div>
      </nav>

      <div className="app-layout">
        <Sidebar 
            onFlyTo={handleFlyTo} 
            analysisData={analysisData}
        />
        
        <main className="map-wrapper">
          <MapView 
              center={mapCenter}
              activeBand={activeBand}
              analysisData={analysisData}
              onDrawComplete={handleDrawComplete}
              onDrawDelete={handleDrawDelete}
          />

          {analysisData && (
              <>
                  <LayerToggle activeLayer={activeBand} onChange={setActiveBand} />
                  <Legend activeLayer={activeBand} histogramData={analysisData.farm_summary?.ndvi_histogram} />
              </>
          )}

          <LoadingOverlay isVisible={isLoading} currentStepIdx={currentStep} />
        </main>
      </div>
    </>
  );
}

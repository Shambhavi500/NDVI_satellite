import React from 'react';

export default function FarmSummary({ analysisData, activeField }) {
    if (!analysisData) return null;

    const farmArgs = analysisData.farm_summary;
    if (!farmArgs) return null;

    return (
        <section className="card card--results" id="card-results" aria-labelledby="results-heading">
            <h2 className="card__title" id="results-heading">
                Farm Summary
            </h2>
            <div className="summary-grid" id="summary-grid" role="region" aria-label="Vegetation summary metrics">
                <div className="summary-cell" style={{gridColumn: "1 / -1", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                    <div>
                        <span className="summary-cell__label">Field Name</span>
                        <span className="summary-cell__value" style={{color: '#fff'}}>{activeField?.name || 'Selected Field'}</span>
                    </div>
                    <div style={{textAlign: "right"}}>
                        <span className="summary-cell__label">Computed Area</span>
                        <span className="summary-cell__value" style={{color: '#22c55e'}}>{activeField?.areaHectares || 0} Ha</span>
                    </div>
                </div>
                <div className="summary-cell" style={{gridColumn: "1 / -1"}}>
                    <span className="summary-cell__label">Composite Vegetation Index (CVI)</span>
                    <span className="summary-cell__value">{farmArgs.indices?.CVI?.mean?.toFixed(4) || 'N/A'}</span>
                    <span className="summary-cell__sub">{farmArgs.indices?.CVI?.interpretation || ''}</span>
                </div>
                <div className="summary-cell" style={{gridColumn: "1 / -1", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                    <div>
                        <span className="summary-cell__label">Engine Confidence</span>
                        <span className="summary-cell__value">{(farmArgs.confidence * 100).toFixed(1)}%</span>
                    </div>
                    <div style={{textAlign: "right"}}>
                        <span className="summary-cell__label">Clean Scenes Used</span>
                        <span className="summary-cell__value">{farmArgs.scene_count || 0}</span>
                    </div>
                </div>

                {[
                  { name: 'NDVI', label: 'Primary Vegetation' },
                  { name: 'EVI', label: 'Canopy Density' },
                  { name: 'SAVI', label: 'Soil Adjusted' },
                  { name: 'NDMI', label: 'Moisture Level' },
                  { name: 'GNDVI', label: 'Chlorophyll' }
                ].map(b => (
                   <div key={b.name} className="summary-cell">
                       <span className="summary-cell__label">{b.name}</span>
                       <span className="summary-cell__value">
                          {farmArgs.indices?.[b.name]?.mean?.toFixed(4) || 'N/A'}
                       </span>
                       <span className="summary-cell__sub">{b.label}</span>
                   </div>
                ))}
            </div>
            <button className="btn btn--secondary btn--sm" id="btn-clear" type="button" onClick={() => window.location.reload()} style={{marginTop: "8px"}}>
              ✕ Clear &amp; Reset
            </button>
        </section>
    );
}

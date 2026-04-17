import React from 'react';

/** Band display labels & units for Sentinel-1 */
const S1_BAND_CONFIG = {
    smi:         { label: 'Soil Moisture Index',  unit: '%',  formatVal: (v) => `${(v * 100).toFixed(1)}%` },
    rvi:         { label: 'Radar Vegetation Index', unit: '',  formatVal: (v) => v.toFixed(4) },
    vv_vh_ratio: { label: 'VV/VH Ratio',          unit: '',  formatVal: (v) => v.toFixed(3) },
    vv:          { label: 'VV Polarization',       unit: 'dB', formatVal: (v) => `${v.toFixed(2)} dB` },
    vh:          { label: 'VH Polarization',       unit: 'dB', formatVal: (v) => `${v.toFixed(2)} dB` },
};

export default function FarmSummary({ analysisData, activeField, activeSatellite = 'sentinel2' }) {
    if (!analysisData) return null;

    const farmArgs = analysisData.farm_summary;
    if (!farmArgs) return null;

    // ── Sentinel-1 Radar Panel ──────────────────────────────────
    if (activeSatellite === 'sentinel1') {
        const smiData = farmArgs.indices?.SMI;
        const smiVal = smiData?.mean;
        const smiPct = smiVal != null ? (smiVal * 100).toFixed(1) : null;

        // SMI bar color
        let smiBarColor = '#6b7280';
        if (smiVal != null) {
            if (smiVal < 0.2) smiBarColor = '#ef4444';
            else if (smiVal < 0.5) smiBarColor = '#f59e0b';
            else if (smiVal < 0.8) smiBarColor = '#22c55e';
            else smiBarColor = '#2563eb';
        }

        const radarMetrics = [
            { key: 'VV', label: 'VV Polarization', unit: 'dB' },
            { key: 'VH', label: 'VH Polarization', unit: 'dB' },
            { key: 'VV_VH_RATIO', label: 'VV/VH Ratio', unit: '' },
            { key: 'RVI', label: 'Radar Vegetation Index', unit: '' },
        ];

        return (
            <section className="card card--results" id="card-results" aria-labelledby="results-heading">
                <h2 className="card__title" id="results-heading">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(37,99,235,0.15)', color: '#60a5fa', fontWeight: 600, letterSpacing: '0.5px' }}>RADAR</span>
                        Farm summary
                    </span>
                </h2>

                <div className="summary-grid" id="summary-grid" role="region" aria-label="Radar summary metrics">
                    <div className="summary-row summary-row--split">
                        <div className="summary-block">
                            <span className="summary-cell__label">Field</span>
                            <span className="summary-cell__value summary-cell__value--compact">
                                {activeField?.name || 'Selected field'}
                            </span>
                        </div>
                        <div className="summary-block summary-block--end">
                            <span className="summary-cell__label">Area</span>
                            <span className="summary-cell__value summary-cell__value--compact summary-cell__value--accent">
                                {activeField?.areaHectares || 0} ha
                            </span>
                        </div>
                    </div>

                    {/* SMI — Highlighted primary metric */}
                    <div className="summary-row" style={{ padding: '12px 0' }}>
                        <span className="summary-cell__label" style={{ fontSize: '13px', fontWeight: 600 }}>Soil Moisture Index (SMI)</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
                            <span className="summary-cell__value" style={{ fontSize: '22px', fontWeight: 700, color: smiBarColor }}>
                                {smiPct != null ? `${smiPct}%` : 'N/A'}
                            </span>
                            {smiVal != null && (
                                <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                    <div style={{
                                        width: `${Math.min(100, smiVal * 100)}%`,
                                        height: '100%',
                                        borderRadius: '4px',
                                        background: smiBarColor,
                                        transition: 'width 0.4s ease',
                                    }} />
                                </div>
                            )}
                        </div>
                        <span className="summary-cell__sub">{smiData?.interpretation || ''}</span>
                    </div>

                    {/* Advisory */}
                    {farmArgs.advisory && (
                        <div className="summary-row" style={{
                            background: 'rgba(34,197,94,0.06)',
                            borderRadius: '6px',
                            padding: '8px 10px',
                            margin: '4px 0',
                            borderLeft: `3px solid ${smiBarColor}`,
                        }}>
                            <span className="summary-cell__sub" style={{ color: '#e2e8f0', fontStyle: 'normal', fontSize: '12.5px' }}>
                                💧 {farmArgs.advisory}
                            </span>
                        </div>
                    )}

                    <div className="summary-row summary-row--split">
                        <div className="summary-block">
                            <span className="summary-cell__label">Confidence</span>
                            <span className="summary-cell__value summary-cell__value--compact">
                                {(farmArgs.confidence * 100).toFixed(1)}%
                            </span>
                        </div>
                        <div className="summary-block summary-block--end">
                            <span className="summary-cell__label">Scenes</span>
                            <span className="summary-cell__value summary-cell__value--compact">
                                {farmArgs.scene_count || 0}
                            </span>
                        </div>
                    </div>

                    <div className="summary-metrics" role="list">
                        {radarMetrics.map((b) => {
                            const mVal = farmArgs.indices?.[b.key]?.mean;
                            let displayVal = 'N/A';
                            if (mVal != null) {
                                if (b.unit === 'dB') displayVal = `${mVal.toFixed(2)} dB`;
                                else displayVal = mVal.toFixed(4);
                            }
                            return (
                                <div key={b.key} className="summary-metric" role="listitem">
                                    <span className="summary-metric__name">{b.key.replace('_', '/')}</span>
                                    <span className="summary-metric__value">{displayVal}</span>
                                    <span className="summary-metric__hint">{b.label}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <button
                    className="btn btn--secondary btn--sm"
                    id="btn-clear"
                    type="button"
                    onClick={() => window.location.reload()}
                >
                    Clear session
                </button>
            </section>
        );
    }

    // ── Sentinel-2 Optical Panel (original) ─────────────────────
    const indices = [
        { name: 'NDVI', label: 'Primary vegetation' },
        { name: 'EVI', label: 'Canopy density' },
        { name: 'SAVI', label: 'Soil-adjusted' },
        { name: 'NDMI', label: 'Moisture' },
        { name: 'GNDVI', label: 'Chlorophyll' },
    ];

    return (
        <section className="card card--results" id="card-results" aria-labelledby="results-heading">
            <h2 className="card__title" id="results-heading">
                Farm summary
            </h2>

            <div className="summary-grid" id="summary-grid" role="region" aria-label="Vegetation summary metrics">
                <div className="summary-row summary-row--split">
                    <div className="summary-block">
                        <span className="summary-cell__label">Field</span>
                        <span className="summary-cell__value summary-cell__value--compact">
                            {activeField?.name || 'Selected field'}
                        </span>
                    </div>
                    <div className="summary-block summary-block--end">
                        <span className="summary-cell__label">Area</span>
                        <span className="summary-cell__value summary-cell__value--compact summary-cell__value--accent">
                            {activeField?.areaHectares || 0} ha
                        </span>
                    </div>
                </div>

                <div className="summary-row">
                    <span className="summary-cell__label">Composite vegetation index (CVI)</span>
                    <span className="summary-cell__value summary-cell__value--compact">
                        {farmArgs.indices?.CVI?.mean?.toFixed(4) || 'N/A'}
                    </span>
                    <span className="summary-cell__sub">{farmArgs.indices?.CVI?.interpretation || ''}</span>
                </div>

                <div className="summary-row summary-row--split">
                    <div className="summary-block">
                        <span className="summary-cell__label">Confidence</span>
                        <span className="summary-cell__value summary-cell__value--compact">
                            {(farmArgs.confidence * 100).toFixed(1)}%
                        </span>
                    </div>
                    <div className="summary-block summary-block--end">
                        <span className="summary-cell__label">Clean scenes</span>
                        <span className="summary-cell__value summary-cell__value--compact">
                            {farmArgs.scene_count || 0}
                        </span>
                    </div>
                </div>

                <div className="summary-metrics" role="list">
                    {indices.map((b) => (
                        <div key={b.name} className="summary-metric" role="listitem">
                            <span className="summary-metric__name">{b.name}</span>
                            <span className="summary-metric__value">
                                {farmArgs.indices?.[b.name]?.mean?.toFixed(4) || 'N/A'}
                            </span>
                            <span className="summary-metric__hint">{b.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <button
                className="btn btn--secondary btn--sm"
                id="btn-clear"
                type="button"
                onClick={() => window.location.reload()}
            >
                Clear session
            </button>
        </section>
    );
}

import React from 'react';

const LEGEND_BINS = [
    { range: '0.95 \u2013 1.00', label: 'Better to use NDRE', color: '#003c00' },
    { range: '0.90 \u2013 0.95', label: 'Dense vegetation', color: '#005716' },
    { range: '0.85 \u2013 0.90', label: 'Dense vegetation', color: '#096b20' },
    { range: '0.80 \u2013 0.85', label: 'Dense vegetation', color: '#137f2a' },
    { range: '0.75 \u2013 0.80', label: 'Dense vegetation', color: '#2a923a' },
    { range: '0.70 \u2013 0.75', label: 'Dense vegetation', color: '#43a64b' },
    { range: '0.65 \u2013 0.70', label: 'Dense vegetation', color: '#67b65d' },
    { range: '0.60 \u2013 0.65', label: 'Dense vegetation', color: '#8dc86f' },
    { range: '0.55 \u2013 0.60', label: 'Moderate vegetation', color: '#b3d982' },
    { range: '0.50 \u2013 0.55', label: 'Moderate vegetation', color: '#d6e996' },
    { range: '0.45 \u2013 0.50', label: 'Moderate vegetation', color: '#eff4a3' },
    { range: '0.40 \u2013 0.45', label: 'Moderate vegetation', color: '#faf7ab' },
    { range: '0.35 \u2013 0.40', label: 'Sparse vegetation', color: '#fbe495' },
    { range: '0.30 \u2013 0.35', label: 'Sparse vegetation', color: '#fcd380' },
    { range: '0.25 \u2013 0.30', label: 'Sparse vegetation', color: '#fcbe6c' },
    { range: '0.20 \u2013 0.25', label: 'Sparse vegetation', color: '#fca95e' },
    { range: '0.15 \u2013 0.20', label: 'Open soil', color: '#f89252' },
    { range: '0.10 \u2013 0.15', label: 'Open soil', color: '#f57049' },
    { range: '0.05 \u2013 0.10', label: 'Open soil', color: '#f14a38' },
    { range: '-1.00 \u2013 0.05', label: 'Open soil', color: '#ea232a' },
];

export default function Legend({ activeLayer, histogramData }) {
  // If activeLayer is not NDVI, we could just show the old legend,
  // but as requested we are updating the colors/legend for the map.
  
  return (
    <div className="eos-legend" id="ndvi-legend">
      <div className="eos-legend__header">
        <span className="eos-legend__title">Index legend</span>
        <div className="eos-legend__actions">
          <span>⬇</span> <span>%</span>
        </div>
      </div>
      <div className="eos-legend__list">
        {LEGEND_BINS.map((bin, index) => {
            return (
                <div key={index} className="eos-legend__row">
                    <div className="eos-color-chip" style={{ backgroundColor: bin.color }}></div>
                    <div className="eos-row-range">{bin.range}</div>
                    <div className="eos-row-label">{bin.label}</div>
                </div>
            );
        })}
      </div>
    </div>
  );
}

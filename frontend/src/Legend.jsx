import React, { useState } from 'react';

const LEGEND_BINS = [
    { range: '0.95 – 1.00', label: 'Better to use NDRE', color: '#003c00' },
    { range: '0.90 – 0.95', label: 'Dense vegetation', color: '#005716' },
    { range: '0.85 – 0.90', label: 'Dense vegetation', color: '#096b20' },
    { range: '0.80 – 0.85', label: 'Dense vegetation', color: '#137f2a' },
    { range: '0.75 – 0.80', label: 'Dense vegetation', color: '#2a923a' },
    { range: '0.70 – 0.75', label: 'Dense vegetation', color: '#43a64b' },
    { range: '0.65 – 0.70', label: 'Dense vegetation', color: '#67b65d' },
    { range: '0.60 – 0.65', label: 'Dense vegetation', color: '#8dc86f' },
    { range: '0.55 – 0.60', label: 'Moderate vegetation', color: '#b3d982' },
    { range: '0.50 – 0.55', label: 'Moderate vegetation', color: '#d6e996' },
    { range: '0.45 – 0.50', label: 'Moderate vegetation', color: '#eff4a3' },
    { range: '0.40 – 0.45', label: 'Moderate vegetation', color: '#faf7ab' },
    { range: '0.35 – 0.40', label: 'Sparse vegetation', color: '#fbe495' },
    { range: '0.30 – 0.35', label: 'Sparse vegetation', color: '#fcd380' },
    { range: '0.25 – 0.30', label: 'Sparse vegetation', color: '#fcbe6c' },
    { range: '0.20 – 0.25', label: 'Sparse vegetation', color: '#fca95e' },
    { range: '0.15 – 0.20', label: 'Open soil', color: '#f89252' },
    { range: '0.10 – 0.15', label: 'Open soil', color: '#f57049' },
    { range: '0.05 – 0.10', label: 'Open soil', color: '#f14a38' },
    { range: '-1.00 – 0.05', label: 'Open soil', color: '#ea232a' },
];

/**
 * Legend — Collapsible sidebar panel showing the index color legend.
 * Rendered inside the sidebar, above the FarmSummary.
 */
export default function Legend({ activeLayer }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="map-legend-overlay">
      <section className="card sidebar-legend" id="card-legend">
        <button
          className="sidebar-legend__toggle"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          type="button"
        >
          <span className="sidebar-legend__title">Index Legend</span>
          <span className={`sidebar-legend__chevron ${isOpen ? 'is-open' : ''}`}>▼</span>
        </button>

        {isOpen && (
        <div className="sidebar-legend__body">
          {LEGEND_BINS.map((bin, index) => (
            <div key={index} className="sidebar-legend__row">
              <div className="sidebar-legend__chip" style={{ backgroundColor: bin.color }} />
              <div className="sidebar-legend__range">{bin.range}</div>
              <div className="sidebar-legend__label">{bin.label}</div>
            </div>
          ))}
        </div>
      )}
      </section>
    </div>
  );
}

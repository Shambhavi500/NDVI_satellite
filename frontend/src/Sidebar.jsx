import React from 'react';
import LocationForm from './LocationForm';
import FarmSummary from './FarmSummary';

export default function Sidebar({ onFlyTo, analysisData, activeBand, activeFieldId, activeField }) {
    return (
        <aside className="sidebar" role="complementary" aria-label="Farm Analysis Panel">
            {activeFieldId === null && <LocationForm onFlyTo={onFlyTo} />}

            <FarmSummary analysisData={analysisData} activeField={activeField} />
        </aside>
    );
}

import React, { useRef, useEffect, useState } from 'react';

/**
 * TimelineBar — horizontal scrollable date selector at the bottom of the map.
 * Shows the last 90 days of available satellite imagery dates.
 * Matches the EOS-style dark timeline bar from the reference screenshot.
 */
export default function TimelineBar({ dates, selectedDate, onDateSelect, isLoading }) {
    const scrollRef = useRef(null);
    const activeRef = useRef(null);

    // Auto-scroll to the selected (active) date
    useEffect(() => {
        if (activeRef.current && scrollRef.current) {
            const container = scrollRef.current;
            const active = activeRef.current;
            const scrollLeft = active.offsetLeft - container.offsetWidth / 2 + active.offsetWidth / 2;
            container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
        }
    }, [selectedDate]);

    // Format date nicely: "10 Apr'26"
    const formatDate = (dateStr) => {
        const d = new Date(dateStr + 'T00:00:00');
        const day = d.getDate().toString().padStart(2, '0');
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = months[d.getMonth()];
        const year = d.getFullYear().toString().slice(-2);
        return `${day} ${month}'${year}`;
    };

    if (!dates || dates.length === 0) return null;

    return (
        <div className="timeline-bar" id="timeline-bar">
            {/* Left arrow */}
            <button
                className="timeline-bar__arrow timeline-bar__arrow--left"
                onClick={() => {
                    if (scrollRef.current) {
                        scrollRef.current.scrollBy({ left: -200, behavior: 'smooth' });
                    }
                }}
                aria-label="Scroll left"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                </svg>
            </button>

            {/* Scrollable dates */}
            <div className="timeline-bar__scroll" ref={scrollRef}>
                <div className="timeline-bar__track">
                    {/* Background line */}
                    <div className="timeline-bar__line" />
                    
                    {dates.map((date, i) => {
                        const isActive = date === selectedDate;
                        return (
                            <button
                                key={date}
                                ref={isActive ? activeRef : null}
                                className={`timeline-bar__date ${isActive ? 'is-active' : ''} ${isLoading ? 'is-loading' : ''}`}
                                onClick={() => !isLoading && onDateSelect(date)}
                                disabled={isLoading}
                                title={date}
                            >
                                {/* Tick mark */}
                                <span className="timeline-bar__tick" />
                                <span className="timeline-bar__label">{formatDate(date)}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Right arrow */}
            <button
                className="timeline-bar__arrow timeline-bar__arrow--right"
                onClick={() => {
                    if (scrollRef.current) {
                        scrollRef.current.scrollBy({ left: 200, behavior: 'smooth' });
                    }
                }}
                aria-label="Scroll right"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </button>

            {/* Next image info (rightmost) */}
            {selectedDate && (
                <div className="timeline-bar__info">
                    <span className="timeline-bar__info-label">
                        {isLoading ? 'Loading...' : `Image: ${formatDate(selectedDate)}`}
                    </span>
                </div>
            )}
        </div>
    );
}

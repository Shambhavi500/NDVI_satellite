import React, { useState, useRef, useEffect, useCallback } from 'react';
import KrishiMitraPanel from './KrishiMitraPanel';

export default function Sidebar({ analysisData, activeField }) {
    const [width, setWidth] = useState(400); 
    const isResizing = useRef(false);

    const handleMouseMove = useCallback((e) => {
        if (!isResizing.current) return;
        let newWidth = e.clientX;
        if (newWidth < 300) newWidth = 300; 
        if (newWidth > 800) newWidth = 800; 
        setWidth(newWidth);
    }, []);

    const handleMouseUp = useCallback(() => {
        if (isResizing.current) {
            isResizing.current = false;
            document.body.style.cursor = 'default';
        }
    }, []);

    useEffect(() => {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);

    return (
        <aside 
           className="sidebar" 
           role="complementary" 
           aria-label="Farm Assistant Panel"
           style={{ width: `${width}px`, flexShrink: 0, position: 'relative' }}
        >
            <KrishiMitraPanel analysisData={analysisData} activeField={activeField} />
            <div 
               onMouseDown={(e) => {
                   e.preventDefault(); // Prevent text selection
                   isResizing.current = true;
                   document.body.style.cursor = 'col-resize';
               }}
               title="Drag to resize panel"
               style={{
                   position: 'absolute',
                   right: 0,
                   top: 0,
                   bottom: 0,
                   width: '4px',
                   cursor: 'col-resize',
                   backgroundColor: 'transparent',
                   zIndex: 9999,
                   transition: 'background-color 0.2s',
               }}
               onMouseEnter={(e) => { if (!isResizing.current) e.target.style.backgroundColor = 'var(--c-brand)'; }}
               onMouseLeave={(e) => { if (!isResizing.current) e.target.style.backgroundColor = 'transparent'; }}
            />
        </aside>
    );
}

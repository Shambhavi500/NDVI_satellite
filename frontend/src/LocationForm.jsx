import React, { useState, useRef, useEffect } from 'react';

/**
 * LocationForm — Fly-to by coordinates OR by searching an address.
 * Uses OpenStreetMap Nominatim (free, no API key) for geocoding.
 */
export default function LocationForm({ onFlyTo }) {
  const [lat, setLat] = useState('18.1676592');
  const [lng, setLng] = useState('75.8131346');

  // Address search state
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCoordSubmit = (e) => {
    e.preventDefault();
    onFlyTo([parseFloat(lat), parseFloat(lng)]);
  };

  // Debounced address search via Nominatim
  const handleQueryChange = (value) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 3) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&limit=5&addressdetails=1`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        setSuggestions(data);
        setShowDropdown(data.length > 0);
      } catch (err) {
        console.error('Geocoding failed:', err);
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 400);
  };

  const handleSelectSuggestion = (item) => {
    const newLat = parseFloat(item.lat);
    const newLng = parseFloat(item.lon);
    setLat(newLat.toFixed(6));
    setLng(newLng.toFixed(6));
    setQuery(item.display_name);
    setShowDropdown(false);
    setSuggestions([]);
    onFlyTo([newLat, newLng]);
  };

  return (
    <section className="card" id="card-location" aria-labelledby="location-heading">
      <h2 className="card__title" id="location-heading">
        Fly to Location
      </h2>

      {/* ── Address Search ────────────────────────────────────────── */}
      <div className="address-search" ref={wrapperRef}>
        <div className="address-search__input-wrap">
          <svg className="address-search__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="address-search__input"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
            placeholder="Search address or place…"
            id="address-search-input"
            autoComplete="off"
          />
          {isSearching && <div className="address-search__spinner" />}
        </div>

        {showDropdown && (
          <ul className="address-search__dropdown" id="address-dropdown">
            {suggestions.map((item) => (
              <li
                key={item.place_id}
                className="address-search__item"
                onClick={() => handleSelectSuggestion(item)}
              >
                <svg className="address-search__pin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className="address-search__text">{item.display_name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Divider ───────────────────────────────────────────────── */}
      <div className="location-divider">
        <span className="location-divider__line" />
        <span className="location-divider__text">or enter coordinates</span>
        <span className="location-divider__line" />
      </div>

      {/* ── Coordinate Inputs ─────────────────────────────────────── */}
      <form onSubmit={handleCoordSubmit} className="location-form" id="location-form">
        <div className="form-group">
          <input 
            type="number" 
            step="any" 
            value={lat} 
            onChange={e => setLat(e.target.value)} 
            placeholder="Latitude" 
            required 
          />
          <input 
            type="number" 
            step="any" 
            value={lng} 
            onChange={e => setLng(e.target.value)} 
            placeholder="Longitude" 
            required 
          />
        </div>
        <button type="submit" className="btn btn--secondary btn--sm" style={{width: "100%", marginTop: "0.5rem"}}>Fly to Coordinates</button>
      </form>
    </section>
  );
}

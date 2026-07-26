'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { COUNTRIES, findCountry } from '@/lib/countries';

export default function CountrySelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (code: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = findCountry(value);

  const filtered = useMemo(() => {
    if (!query.trim()) return COUNTRIES;
    const q = query.trim().toLowerCase();
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div className="form-group country-select-wrap" ref={wrapRef}>
      <label className="form-label">{label}</label>
      <div
        className="country-search-input"
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
      >
        {selected ? `${selected.flag}  ${selected.name}` : 'Select a country'}
      </div>
      {open && (
        <div className="country-dropdown">
          <input
            className="form-input"
            style={{ border: 'none', borderBottom: '1px solid var(--border)', borderRadius: 0 }}
            placeholder="Search countries…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {filtered.map((c) => (
            <div
              key={c.code}
              className="country-option"
              onClick={() => {
                onChange(c.code);
                setOpen(false);
                setQuery('');
              }}
            >
              <span>{c.flag}</span>
              <span>{c.name}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="country-option" style={{ color: 'var(--text-grey)' }}>
              No matches.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

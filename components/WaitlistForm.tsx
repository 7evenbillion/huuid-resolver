'use client';

import { useState, type FormEvent } from 'react';

const COUNTRIES = [
  'Ghana',
  'Nigeria',
  'Kenya',
  'Rwanda',
  'South Africa',
  'United Kingdom',
  'United States',
  'Other',
];

export default function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setErrorMessage('');

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, country }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorMessage(body.error ?? 'Something went wrong. Please try again.');
        setStatus('error');
        return;
      }
      setStatus('success');
    } catch {
      setErrorMessage('Network error. Please try again.');
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div className="waitlist-success">✓ You are registered. We will contact you when HUUID enrollment opens in your area.</div>
    );
  }

  return (
    <form className="waitlist-form" onSubmit={handleSubmit}>
      <input
        className="waitlist-input"
        type="email"
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        disabled={status === 'submitting'}
      />
      <select
        className="waitlist-select"
        value={country}
        onChange={(e) => setCountry(e.target.value)}
        disabled={status === 'submitting'}
      >
        <option value="">Select your country</option>
        {COUNTRIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {status === 'error' && <p className="waitlist-error">{errorMessage}</p>}
      <button type="submit" className="btn btn-teal btn-block" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Registering…' : 'Register My Interest'}
      </button>
    </form>
  );
}

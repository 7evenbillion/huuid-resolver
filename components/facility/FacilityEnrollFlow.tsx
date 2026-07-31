'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import CountrySelect from '@/components/enroll/CountrySelect';
import { findCountry } from '@/lib/countries';

interface FormState {
  fullName: string;
  dateOfBirth: string;
  sexAtBirth: '' | 'male' | 'female' | 'intersex';
  countryCode: string;
  phone: string;
  email: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  consentTerms: boolean;
  consentDataProcessing: boolean;
  noPhone: boolean;
}

export default function FacilityEnrollFlow() {
  const router = useRouter();
  const [stage, setStage] = useState<'ask' | 'form'>('ask');
  const [form, setForm] = useState<FormState>({
    fullName: '',
    dateOfBirth: '',
    sexAtBirth: '',
    countryCode: 'GH',
    phone: '',
    email: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    consentTerms: false,
    consentDataProcessing: false,
    noPhone: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const country = findCountry(form.countryCode);
  const phoneDigits = form.phone.replace(/[^\d]/g, '');
  const fullPhone = country ? `${country.dialCode}${phoneDigits}` : form.phone;
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isValid =
    form.fullName.trim().length >= 2 &&
    form.dateOfBirth.length === 10 &&
    form.sexAtBirth !== '' &&
    (form.noPhone || phoneDigits.length >= 7) &&
    form.consentTerms &&
    form.consentDataProcessing;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;

    if (form.noPhone) {
      setError(
        'Enrollment without a phone number is not yet supported in this build — a phone number is required to verify the patient. Ask the patient if a family member’s phone can be used instead.'
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/facility/enroll/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          dateOfBirth: form.dateOfBirth,
          sexAtBirth: form.sexAtBirth,
          countryCode: form.countryCode,
          phone: fullPhone,
          email: form.email.trim() || null,
          emergencyContactName: form.emergencyContactName.trim() || null,
          emergencyContactPhone: form.emergencyContactPhone.trim() || null,
          consentTerms: form.consentTerms,
          consentDataProcessing: form.consentDataProcessing,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }
      router.push('/enroll/verify');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  if (stage === 'ask') {
    return (
      <div className="enroll-page">
        <div className="enroll-shell" style={{ textAlign: 'center' }}>
          <h1 className="enroll-heading">Does this patient have a HUUID card?</h1>
          <div className="download-buttons">
            <button className="btn btn-teal btn-block" onClick={() => router.push('/facility/verify')}>
              YES — Scan Their Card
            </button>
            <button className="btn btn-white-outline btn-block" onClick={() => setStage('form')}>
              NO — Create New HUUID
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="enroll-page">
      <div className="enroll-shell">
        <button onClick={() => setStage('ask')} className="medical-skip-link" style={{ marginBottom: 8 }}>
          ← Back
        </button>
        <h1 className="enroll-heading">Enroll New Patient</h1>
        <p className="enroll-sub">Fill in the patient&apos;s details. They will verify their own phone number.</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Full Legal Name</label>
            <input className="form-input" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} required />
          </div>

          <div className="form-group">
            <label className="form-label">Date of Birth</label>
            <input
              type="date"
              className="form-input"
              min="1900-01-01"
              max={today}
              value={form.dateOfBirth}
              onChange={(e) => update('dateOfBirth', e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Sex at Birth</label>
            <select
              className="form-select"
              value={form.sexAtBirth}
              onChange={(e) => update('sexAtBirth', e.target.value as FormState['sexAtBirth'])}
              required
            >
              <option value="" disabled>Select…</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="intersex">Intersex</option>
            </select>
          </div>

          <CountrySelect label="Country" value={form.countryCode} onChange={(code) => update('countryCode', code)} />

          <div className="consent-group" style={{ marginBottom: 4 }}>
            <div className="consent-row">
              <input
                type="checkbox"
                id="no-phone"
                checked={form.noPhone}
                onChange={(e) => update('noPhone', e.target.checked)}
              />
              <label htmlFor="no-phone">Patient has no phone</label>
            </div>
          </div>

          {!form.noPhone && (
            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <div className="form-row">
                <input className="form-input" value={country?.dialCode ?? ''} disabled />
                <input
                  className="form-input"
                  type="tel"
                  placeholder="24 123 4567"
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                />
              </div>
              <p className="form-helper">A verification code will be sent to this number.</p>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">
              Email <span className="form-optional-tag">Optional</span>
            </label>
            <input type="email" className="form-input" value={form.email} onChange={(e) => update('email', e.target.value)} />
          </div>

          <div className="consent-group">
            <div className="consent-row">
              <input
                type="checkbox"
                id="fc-consent-terms"
                checked={form.consentTerms}
                onChange={(e) => update('consentTerms', e.target.checked)}
              />
              <label htmlFor="fc-consent-terms">
                I confirm the patient (or their authorised representative) has agreed to create a
                HUUID Healthcare Identity.
              </label>
            </div>
            <div className="consent-row">
              <input
                type="checkbox"
                id="fc-consent-processing"
                checked={form.consentDataProcessing}
                onChange={(e) => update('consentDataProcessing', e.target.checked)}
              />
              <label htmlFor="fc-consent-processing">
                I confirm the patient consents to their personal information being processed to
                create and maintain their Healthcare Identity.
              </label>
            </div>
          </div>

          {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}

          <button type="submit" className="btn btn-teal btn-block" disabled={!isValid || submitting}>
            {submitting ? 'Sending code…' : 'Continue →'}
          </button>
        </form>
      </div>
    </div>
  );
}

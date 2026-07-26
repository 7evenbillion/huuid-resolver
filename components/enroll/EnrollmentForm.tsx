'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import EnrollLayout from '@/components/enroll/EnrollLayout';
import CountrySelect from '@/components/enroll/CountrySelect';
import { findCountry } from '@/lib/countries';
import { getRegulatoryNotice } from '@/lib/regulatory-notices';

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
}

export default function EnrollmentForm({ detectedCountry }: { detectedCountry: string | null }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    fullName: '',
    dateOfBirth: '',
    sexAtBirth: '',
    countryCode: detectedCountry ?? 'GH',
    phone: '',
    email: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    consentTerms: false,
    consentDataProcessing: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const country = findCountry(form.countryCode);
  const notice = useMemo(() => getRegulatoryNotice(form.countryCode), [form.countryCode]);

  const phoneDigits = form.phone.replace(/[^\d]/g, '');
  const fullPhone = country ? `${country.dialCode}${phoneDigits}` : form.phone;

  const today = new Date().toISOString().slice(0, 10);

  const isValid =
    form.fullName.trim().length >= 2 &&
    form.dateOfBirth.length === 10 &&
    form.dateOfBirth <= today &&
    form.sexAtBirth !== '' &&
    form.countryCode.length === 2 &&
    phoneDigits.length >= 7 &&
    form.consentTerms &&
    form.consentDataProcessing;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/enroll/start', {
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

  return (
    <EnrollLayout
      step={1}
      heading="Create Your Healthcare Identity"
      sub="One trusted identity for life. Recognised at any participating healthcare facility, anywhere in the world."
    >
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Full Legal Name</label>
          <input
            className="form-input"
            placeholder="As it appears on your official documents"
            value={form.fullName}
            onChange={(e) => update('fullName', e.target.value)}
            required
          />
          <p className="form-helper">Used to identify you at healthcare facilities.</p>
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
            <option value="" disabled>
              Select…
            </option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="intersex">Intersex</option>
          </select>
          <p className="form-helper">Required for medical purposes. This is not your gender identity.</p>
        </div>

        <CountrySelect
          label="Country of Residence"
          value={form.countryCode}
          onChange={(code) => update('countryCode', code)}
        />

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
              required
            />
          </div>
          <p className="form-helper">
            Your phone number is your primary identity anchor. You will receive a verification code here.
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">
            Email Address <span className="form-optional-tag">Optional</span>
          </label>
          <input
            type="email"
            className="form-input"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
          />
          <p className="form-helper">Optional. Used for digital card backup only.</p>
        </div>

        <div className="form-group">
          <label className="form-label">
            Emergency Contact Name <span className="form-optional-tag">Optional</span>
          </label>
          <input
            className="form-input"
            value={form.emergencyContactName}
            onChange={(e) => update('emergencyContactName', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            Emergency Contact Phone <span className="form-optional-tag">Optional</span>
          </label>
          <input
            type="tel"
            className="form-input"
            value={form.emergencyContactPhone}
            onChange={(e) => update('emergencyContactPhone', e.target.value)}
          />
          <p className="form-helper">Notified if emergency access to your records is triggered.</p>
        </div>

        <div className="consent-group">
          <div className="consent-row">
            <input
              type="checkbox"
              id="consent-terms"
              checked={form.consentTerms}
              onChange={(e) => update('consentTerms', e.target.checked)}
            />
            <label htmlFor="consent-terms">
              I understand that my HUUID Healthcare Identity is self-enrolled. It becomes
              facility-verified when a connected healthcare provider confirms my identity.
            </label>
          </div>
          <div className="consent-row">
            <input
              type="checkbox"
              id="consent-processing"
              checked={form.consentDataProcessing}
              onChange={(e) => update('consentDataProcessing', e.target.checked)}
            />
            <label htmlFor="consent-processing">
              I agree to the HUUID Terms of Use and Privacy Policy. I consent to my personal
              information being processed to create and maintain my Healthcare Identity.
            </label>
          </div>
        </div>

        <p className="regulatory-notice">{notice}</p>

        {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}

        <button type="submit" className="btn btn-teal btn-block" disabled={!isValid || submitting}>
          {submitting ? 'Sending code…' : 'Continue →'}
        </button>
      </form>
      <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13.5 }}>
        <a href="/enroll/recover" style={{ color: 'var(--teal)', fontWeight: 600 }}>
          Already enrolled? Recover your identity
        </a>
      </p>
    </EnrollLayout>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import CountrySelect from '@/components/enroll/CountrySelect';
import { findCountry } from '@/lib/countries';
import { FACILITY_TYPE_LABELS, EMR_SYSTEM_LABELS } from '@/lib/facility-types';

interface FormState {
  facilityName: string;
  facilityType: string;
  countryCode: string;
  region: string;
  physicalAddress: string;
  governmentRegistrationNumber: string;
  emrSystem: string;
  estimatedDailyPatients: string;
  authorisedSignatoryName: string;
  authorisedSignatoryRole: string;
  authorisedSignatoryPhone: string;
  authorisedSignatoryEmail: string;
  itContactName: string;
  itContactPhone: string;
  declarationAccepted: boolean;
}

const FACILITY_TYPES = Object.entries(FACILITY_TYPE_LABELS);
const EMR_SYSTEMS = Object.entries(EMR_SYSTEM_LABELS);

export default function FacilityRegistrationForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    facilityName: '',
    facilityType: '',
    countryCode: 'GH',
    region: '',
    physicalAddress: '',
    governmentRegistrationNumber: '',
    emrSystem: '',
    estimatedDailyPatients: '',
    authorisedSignatoryName: '',
    authorisedSignatoryRole: '',
    authorisedSignatoryPhone: '',
    authorisedSignatoryEmail: '',
    itContactName: '',
    itContactPhone: '',
    declarationAccepted: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const country = findCountry(form.countryCode);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function fullPhone(local: string): string {
    const digits = local.replace(/[^\d]/g, '');
    return country ? `${country.dialCode}${digits}` : local;
  }

  const isValid =
    form.facilityName.trim().length >= 2 &&
    form.facilityType !== '' &&
    form.countryCode.length === 2 &&
    form.region.trim().length > 0 &&
    form.physicalAddress.trim().length > 0 &&
    form.governmentRegistrationNumber.trim().length > 0 &&
    form.emrSystem !== '' &&
    form.estimatedDailyPatients.trim().length > 0 &&
    form.authorisedSignatoryName.trim().length > 0 &&
    form.authorisedSignatoryRole.trim().length > 0 &&
    fullPhone(form.authorisedSignatoryPhone).length >= 8 &&
    form.itContactName.trim().length > 0 &&
    fullPhone(form.itContactPhone).length >= 8 &&
    form.declarationAccepted;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/facilities/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityName: form.facilityName.trim(),
          facilityType: form.facilityType,
          countryCode: form.countryCode,
          region: form.region.trim(),
          physicalAddress: form.physicalAddress.trim(),
          governmentRegistrationNumber: form.governmentRegistrationNumber.trim(),
          emrSystem: form.emrSystem,
          estimatedDailyPatients: Number(form.estimatedDailyPatients),
          authorisedSignatoryName: form.authorisedSignatoryName.trim(),
          authorisedSignatoryRole: form.authorisedSignatoryRole.trim(),
          authorisedSignatoryPhone: fullPhone(form.authorisedSignatoryPhone),
          authorisedSignatoryEmail: form.authorisedSignatoryEmail.trim() || null,
          itContactName: form.itContactName.trim(),
          itContactPhone: fullPhone(form.itContactPhone),
          declarationAccepted: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }
      sessionStorage.setItem('huuid_facility_application_id', data.applicationId);
      sessionStorage.setItem('huuid_facility_application_phone', fullPhone(form.authorisedSignatoryPhone));
      router.push('/facilities/register/submitted');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="enroll-page">
      <div className="enroll-shell" style={{ maxWidth: 620 }}>
        <div className="enroll-logo">
          <Image src="/images/logo-h.png" alt="HUUID" width={44} height={44} />
        </div>
        <div className="enroll-steps" aria-label="Step 1 of 2">
          <span className="enroll-step-dot active" />
          <span className="enroll-step-dot" />
        </div>
        <h1 className="enroll-heading">Connect Your Facility to HUUID</h1>
        <p className="enroll-sub">
          Join the trusted healthcare identity network. Your application will be reviewed within
          2 business days.
        </p>

        <form onSubmit={handleSubmit}>
          <h2 className="form-section-heading">Facility Information</h2>

          <div className="form-group">
            <label className="form-label">Facility Legal Name</label>
            <input
              className="form-input"
              placeholder="As registered with government"
              value={form.facilityName}
              onChange={(e) => update('facilityName', e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Facility Type</label>
            <select
              className="form-select"
              value={form.facilityType}
              onChange={(e) => update('facilityType', e.target.value)}
              required
            >
              <option value="" disabled>
                Select…
              </option>
              {FACILITY_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <CountrySelect label="Country" value={form.countryCode} onChange={(code) => update('countryCode', code)} />

          <div className="form-group">
            <label className="form-label">Region / State / Province</label>
            <input
              className="form-input"
              value={form.region}
              onChange={(e) => update('region', e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Physical Address</label>
            <textarea
              className="form-input"
              rows={3}
              value={form.physicalAddress}
              onChange={(e) => update('physicalAddress', e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Government Health Registration Number</label>
            <input
              className="form-input"
              value={form.governmentRegistrationNumber}
              onChange={(e) => update('governmentRegistrationNumber', e.target.value)}
              required
            />
            <p className="form-helper">
              Ghana Health Service registration number, NHIA accreditation number, or equivalent
              national health facility registration
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Current Patient Records System</label>
            <select
              className="form-select"
              value={form.emrSystem}
              onChange={(e) => update('emrSystem', e.target.value)}
              required
            >
              <option value="" disabled>
                Select…
              </option>
              {EMR_SYSTEMS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Estimated Daily Patients</label>
            <input
              type="number"
              min={0}
              className="form-input"
              value={form.estimatedDailyPatients}
              onChange={(e) => update('estimatedDailyPatients', e.target.value)}
              required
            />
            <p className="form-helper">Approximate number of patients seen per day</p>
          </div>

          <h2 className="form-section-heading">Authorised Contact</h2>
          <p className="form-section-sub">
            The person legally authorised to connect this facility to the HUUID network
          </p>

          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input
              className="form-input"
              value={form.authorisedSignatoryName}
              onChange={(e) => update('authorisedSignatoryName', e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Role / Title</label>
            <input
              className="form-input"
              placeholder="e.g. CEO, CMO, Medical Director, IT Director, Administrator"
              value={form.authorisedSignatoryRole}
              onChange={(e) => update('authorisedSignatoryRole', e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Phone Number</label>
            <div className="form-row">
              <input className="form-input" value={country?.dialCode ?? ''} disabled />
              <input
                className="form-input"
                type="tel"
                placeholder="24 123 4567"
                value={form.authorisedSignatoryPhone}
                onChange={(e) => update('authorisedSignatoryPhone', e.target.value)}
                required
              />
            </div>
            <p className="form-helper">This number will receive your facility credentials via SMS</p>
          </div>

          <div className="form-group">
            <label className="form-label">
              Email Address <span className="form-optional-tag">Optional</span>
            </label>
            <input
              type="email"
              className="form-input"
              value={form.authorisedSignatoryEmail}
              onChange={(e) => update('authorisedSignatoryEmail', e.target.value)}
            />
          </div>

          <h2 className="form-section-heading">IT Contact</h2>
          <p className="form-section-sub">The person who will install the HUUID connector</p>

          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input
              className="form-input"
              value={form.itContactName}
              onChange={(e) => update('itContactName', e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Phone Number</label>
            <div className="form-row">
              <input className="form-input" value={country?.dialCode ?? ''} disabled />
              <input
                className="form-input"
                type="tel"
                placeholder="24 123 4567"
                value={form.itContactPhone}
                onChange={(e) => update('itContactPhone', e.target.value)}
                required
              />
            </div>
            <p className="form-helper">This number will receive installation instructions</p>
          </div>

          <div className="consent-group">
            <div className="consent-row">
              <input
                type="checkbox"
                id="declaration-accepted"
                checked={form.declarationAccepted}
                onChange={(e) => update('declarationAccepted', e.target.checked)}
              />
              <label htmlFor="declaration-accepted">
                I confirm that I am authorised to connect {form.facilityName || '[Facility Name]'} to
                the HUUID network. I confirm that the information provided is accurate and
                complete. I understand that providing false information may result in immediate
                certificate revocation.
              </label>
            </div>
          </div>

          {error && (
            <p className="form-error-text" style={{ marginBottom: 16 }}>
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-teal btn-block" disabled={!isValid || submitting}>
            {submitting ? 'Submitting…' : 'Submit Application →'}
          </button>
        </form>
      </div>
    </div>
  );
}

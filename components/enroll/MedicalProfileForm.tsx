'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'unknown' | '';
type Severity = '' | 'mild' | 'moderate' | 'severe' | 'life-threatening';
type ContraSeverity = 'never' | 'avoid' | 'consult';

interface AllergyRow {
  substance: string;
  reaction: string;
  severity: Severity;
}

interface MedicationRow {
  name: string;
  dose: string;
  frequency: string;
}

interface ContraindicationRow {
  substance: string;
  reason: string;
  severity: ContraSeverity;
}

const CHRONIC_CONDITIONS = [
  'Diabetes (Type 1)',
  'Diabetes (Type 2)',
  'Hypertension',
  'Asthma',
  'Epilepsy',
  'HIV/AIDS',
  'Sickle Cell Disease',
  'Chronic Kidney Disease',
  'Heart Disease',
  'Tuberculosis',
  'Cancer',
  'Mental Health Condition',
];

const IMPLANTED_DEVICES = [
  'Pacemaker',
  'Defibrillator (ICD)',
  'Insulin Pump',
  'Cochlear Implant',
  'Artificial Joint',
  'Stent',
];

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function MedicalProfileForm() {
  const router = useRouter();
  const [huuid, setHuuid] = useState<string | null>(null);
  const [isFemale, setIsFemale] = useState(false);

  const [bloodType, setBloodType] = useState<BloodType>('');
  const [allergies, setAllergies] = useState<AllergyRow[]>([]);
  const [medications, setMedications] = useState<MedicationRow[]>([]);
  const [chronicConditions, setChronicConditions] = useState<string[]>([]);
  const [chronicOther, setChronicOther] = useState('');
  const [pregnancyStatus, setPregnancyStatus] = useState<'' | 'pregnant' | 'not_pregnant' | 'unknown'>('');
  const [organDonor, setOrganDonor] = useState<'' | 'yes' | 'no' | 'unknown'>('');
  const [implantedDevices, setImplantedDevices] = useState<string[]>([]);
  const [deviceOther, setDeviceOther] = useState('');
  const [physicianName, setPhysicianName] = useState('');
  const [physicianPhone, setPhysicianPhone] = useState('');
  const [facilityName, setFacilityName] = useState('');
  const [facilityCountry, setFacilityCountry] = useState('');
  const [contraindications, setContraindications] = useState<ContraindicationRow[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem('huuid_just_created');
    if (!stored) {
      router.replace('/enroll');
      return;
    }
    setHuuid(stored);
    setIsFemale(sessionStorage.getItem('huuid_just_created_sex') === 'female');
  }, [router]);

  function addAllergy() {
    if (allergies.length >= 5) return;
    setAllergies((a) => [...a, { substance: '', reaction: '', severity: '' }]);
  }
  function addMedication() {
    if (medications.length >= 5) return;
    setMedications((m) => [...m, { name: '', dose: '', frequency: '' }]);
  }
  function addContraindication() {
    if (contraindications.length >= 10) return;
    setContraindications((c) => [...c, { substance: '', reason: '', severity: 'never' }]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !huuid) return;
    setSubmitting(true);
    setError(null);

    const finalChronic = [...chronicConditions, ...(chronicOther.trim() ? [chronicOther.trim()] : [])];
    const finalDevices = [...implantedDevices, ...(deviceOther.trim() ? [deviceOther.trim()] : [])];

    try {
      const res = await fetch('/api/enroll/medical', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bloodType: bloodType || null,
          allergies: allergies.filter((a) => a.substance.trim()).map((a) => ({
            substance: a.substance.trim(),
            reaction: a.reaction.trim() || null,
            severity: a.severity || null,
          })),
          medications: medications.filter((m) => m.name.trim()).map((m) => ({
            name: m.name.trim(),
            dose: m.dose.trim() || null,
            frequency: m.frequency.trim() || null,
          })),
          chronicConditions: finalChronic,
          pregnancyStatus: isFemale && pregnancyStatus ? pregnancyStatus : null,
          organDonor: organDonor || null,
          implantedDevices: finalDevices,
          primaryPhysicianName: physicianName.trim() || null,
          primaryPhysicianPhone: physicianPhone.trim() || null,
          primaryFacilityName: facilityName.trim() || null,
          primaryFacilityCountry: facilityCountry.trim() || null,
          contraindications: contraindications.filter((c) => c.substance.trim()).map((c) => ({
            substance: c.substance.trim(),
            reason: c.reason.trim() || null,
            severity: c.severity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not save your medical profile.');
        setSubmitting(false);
        return;
      }
      if (data.qrToken) sessionStorage.setItem('huuid_qr_token', data.qrToken);
      sessionStorage.setItem('huuid_medical_profile', JSON.stringify({
        bloodType: bloodType || null,
        allergies,
        medications,
        chronicConditions: finalChronic,
        pregnancyStatus: isFemale ? pregnancyStatus || null : null,
        organDonor: organDonor || null,
        implantedDevices: finalDevices,
        contraindications,
        medicalProfileCompleted: !!data.medicalProfileCompleted,
      }));
      router.push('/enroll/card');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  if (!huuid) return null;

  return (
    <div className="enroll-page">
      <div className="enroll-shell">
        <div className="enroll-logo">
          <Image src="/images/logo-h.png" alt="HUUID" width={44} height={44} />
        </div>
        <h1 className="enroll-heading">Add Your Emergency Medical Information</h1>
        <p className="enroll-sub">
          This information can save your life in an emergency, even offline. Everything here is optional.
        </p>
        <div className="info-box">
          This information is patient-provided and not clinically verified. It will be visible to
          healthcare providers at the point of care, including offline via your card&apos;s QR code.
          You can update it any time.
        </div>

        <form onSubmit={handleSubmit}>
          <div className="medical-section">
            <div className="form-group">
              <label className="form-label">Blood Type</label>
              <select className="form-select" value={bloodType} onChange={(e) => setBloodType(e.target.value as BloodType)}>
                <option value="">Prefer not to say</option>
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'].map((bt) => (
                  <option key={bt} value={bt}>{bt === 'unknown' ? 'Unknown' : bt}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="medical-section">
            <h3 className="medical-section-title">Allergies</h3>
            <p className="medical-section-note">Up to 5. Include what happens and how severe it is.</p>
            {allergies.map((a, i) => (
              <div className="multi-entry-card" key={i}>
                <button type="button" className="multi-entry-remove" onClick={() => setAllergies((list) => list.filter((_, idx) => idx !== i))}>
                  Remove
                </button>
                <div className="form-group">
                  <label className="form-label">Substance</label>
                  <input className="form-input" value={a.substance} onChange={(e) => setAllergies((list) => list.map((r, idx) => (idx === i ? { ...r, substance: e.target.value } : r)))} placeholder="e.g. Penicillin" />
                </div>
                <div className="form-group">
                  <label className="form-label">Reaction <span className="form-optional-tag">Optional</span></label>
                  <input className="form-input" value={a.reaction} onChange={(e) => setAllergies((list) => list.map((r, idx) => (idx === i ? { ...r, reaction: e.target.value } : r)))} placeholder="e.g. Rash, swelling" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Severity <span className="form-optional-tag">Optional</span></label>
                  <select className="form-select" value={a.severity} onChange={(e) => setAllergies((list) => list.map((r, idx) => (idx === i ? { ...r, severity: e.target.value as Severity } : r)))}>
                    <option value="">Not specified</option>
                    <option value="mild">Mild</option>
                    <option value="moderate">Moderate</option>
                    <option value="severe">Severe</option>
                    <option value="life-threatening">Life-threatening</option>
                  </select>
                </div>
              </div>
            ))}
            <button type="button" className="add-entry-btn" onClick={addAllergy} disabled={allergies.length >= 5}>
              + Add Allergy {allergies.length >= 5 ? '(maximum reached)' : ''}
            </button>
          </div>

          <div className="medical-section">
            <h3 className="medical-section-title">Current Medications</h3>
            <p className="medical-section-note">Up to 5.</p>
            {medications.map((m, i) => (
              <div className="multi-entry-card" key={i}>
                <button type="button" className="multi-entry-remove" onClick={() => setMedications((list) => list.filter((_, idx) => idx !== i))}>
                  Remove
                </button>
                <div className="form-group">
                  <label className="form-label">Medication Name</label>
                  <input className="form-input" value={m.name} onChange={(e) => setMedications((list) => list.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)))} placeholder="e.g. Metformin" />
                </div>
                <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div className="form-group">
                    <label className="form-label">Dose <span className="form-optional-tag">Optional</span></label>
                    <input className="form-input" value={m.dose} onChange={(e) => setMedications((list) => list.map((r, idx) => (idx === i ? { ...r, dose: e.target.value } : r)))} placeholder="e.g. 500mg" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Frequency <span className="form-optional-tag">Optional</span></label>
                    <input className="form-input" value={m.frequency} onChange={(e) => setMedications((list) => list.map((r, idx) => (idx === i ? { ...r, frequency: e.target.value } : r)))} placeholder="e.g. Twice daily" />
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="add-entry-btn" onClick={addMedication} disabled={medications.length >= 5}>
              + Add Medication {medications.length >= 5 ? '(maximum reached)' : ''}
            </button>
          </div>

          <div className="medical-section">
            <h3 className="medical-section-title">Chronic Conditions</h3>
            <div className="checkbox-grid">
              {CHRONIC_CONDITIONS.map((c) => (
                <label className={`checkbox-chip${chronicConditions.includes(c) ? ' checked' : ''}`} key={c}>
                  <input type="checkbox" checked={chronicConditions.includes(c)} onChange={() => setChronicConditions((list) => toggle(list, c))} />
                  {c}
                </label>
              ))}
            </div>
            <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
              <label className="form-label">Other <span className="form-optional-tag">Optional</span></label>
              <input className="form-input" value={chronicOther} onChange={(e) => setChronicOther(e.target.value)} placeholder="Any condition not listed above" />
            </div>
          </div>

          {isFemale && (
            <div className="medical-section">
              <h3 className="medical-section-title">Pregnancy Status</h3>
              <div className="radio-row-group">
                {(['pregnant', 'not_pregnant', 'unknown'] as const).map((v) => (
                  <label className={`radio-chip${pregnancyStatus === v ? ' checked' : ''}`} key={v}>
                    <input type="radio" name="pregnancy" checked={pregnancyStatus === v} onChange={() => setPregnancyStatus(v)} />
                    {v === 'pregnant' ? 'Pregnant' : v === 'not_pregnant' ? 'Not Pregnant' : 'Unknown'}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="medical-section">
            <h3 className="medical-section-title">Organ Donor</h3>
            <div className="radio-row-group">
              {(['yes', 'no', 'unknown'] as const).map((v) => (
                <label className={`radio-chip${organDonor === v ? ' checked' : ''}`} key={v}>
                  <input type="radio" name="organDonor" checked={organDonor === v} onChange={() => setOrganDonor(v)} />
                  {v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Unknown'}
                </label>
              ))}
            </div>
          </div>

          <div className="medical-section">
            <h3 className="medical-section-title">Implanted Devices</h3>
            <div className="checkbox-grid">
              {IMPLANTED_DEVICES.map((d) => (
                <label className={`checkbox-chip${implantedDevices.includes(d) ? ' checked' : ''}`} key={d}>
                  <input type="checkbox" checked={implantedDevices.includes(d)} onChange={() => setImplantedDevices((list) => toggle(list, d))} />
                  {d}
                </label>
              ))}
            </div>
            <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
              <label className="form-label">Other <span className="form-optional-tag">Optional</span></label>
              <input className="form-input" value={deviceOther} onChange={(e) => setDeviceOther(e.target.value)} placeholder="Any device not listed above" />
            </div>
          </div>

          <div className="medical-section">
            <h3 className="medical-section-title">Primary Care</h3>
            <div className="form-group">
              <label className="form-label">Primary Physician Name <span className="form-optional-tag">Optional</span></label>
              <input className="form-input" value={physicianName} onChange={(e) => setPhysicianName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Primary Physician Phone <span className="form-optional-tag">Optional</span></label>
              <input className="form-input" type="tel" value={physicianPhone} onChange={(e) => setPhysicianPhone(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Primary Facility Name <span className="form-optional-tag">Optional</span></label>
              <input className="form-input" value={facilityName} onChange={(e) => setFacilityName(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Primary Facility Country <span className="form-optional-tag">Optional</span></label>
              <input className="form-input" value={facilityCountry} onChange={(e) => setFacilityCountry(e.target.value)} />
            </div>
          </div>

          <div className="medical-section">
            <h3 className="medical-section-title">Contraindicated Medications and Substances</h3>
            <p className="medical-section-note">
              Up to 10. Things you must never be given, should avoid, or should only be given with caution.
            </p>
            {contraindications.map((c, i) => (
              <div className="multi-entry-card" key={i}>
                <button type="button" className="multi-entry-remove" onClick={() => setContraindications((list) => list.filter((_, idx) => idx !== i))}>
                  Remove
                </button>
                <div className="form-group">
                  <label className="form-label">Substance</label>
                  <input className="form-input" value={c.substance} onChange={(e) => setContraindications((list) => list.map((r, idx) => (idx === i ? { ...r, substance: e.target.value } : r)))} placeholder="e.g. Aspirin" />
                </div>
                <div className="form-group">
                  <label className="form-label">Reason <span className="form-optional-tag">Optional</span></label>
                  <input className="form-input" value={c.reason} onChange={(e) => setContraindications((list) => list.map((r, idx) => (idx === i ? { ...r, reason: e.target.value } : r)))} placeholder="e.g. G6PD deficiency" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Severity</label>
                  <select className="form-select" value={c.severity} onChange={(e) => setContraindications((list) => list.map((r, idx) => (idx === i ? { ...r, severity: e.target.value as ContraSeverity } : r)))}>
                    <option value="never">Never give</option>
                    <option value="avoid">Avoid</option>
                    <option value="consult">Consult first</option>
                  </select>
                </div>
              </div>
            ))}
            <button type="button" className="add-entry-btn" onClick={addContraindication} disabled={contraindications.length >= 10}>
              + Add Contraindication {contraindications.length >= 10 ? '(maximum reached)' : ''}
            </button>
          </div>

          {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}

          <button type="submit" className="btn btn-teal btn-block" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save and Continue →'}
          </button>
        </form>
        <button type="button" className="medical-skip-link" onClick={() => router.push('/enroll/card')}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

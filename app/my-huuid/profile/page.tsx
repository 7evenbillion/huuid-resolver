'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ProfileData {
  fullName: string;
  dateOfBirth: string;
  sexAtBirth: 'male' | 'female' | 'intersex';
  countryCode: string;
  phone: string;
  phoneVerified: boolean;
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

const TODAY = new Date().toISOString().slice(0, 10);

export default function MyHuuidProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/my-huuid/profile');
      if (res.status === 401) {
        router.replace('/my-huuid/login');
        return;
      }
      if (!res.ok) {
        setError('Could not load your profile.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setProfile(data);
      setLoading(false);
    })();
  }, [router]);

  function update<K extends keyof ProfileData>(key: K, value: ProfileData[K]) {
    setProfile((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/my-huuid/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: profile.fullName,
          dateOfBirth: profile.dateOfBirth,
          sexAtBirth: profile.sexAtBirth,
          emergencyContactName: profile.emergencyContactName || null,
          emergencyContactPhone: profile.emergencyContactPhone || null,
          email: profile.email || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not save your profile.');
        setSaving(false);
        return;
      }
      setSaved(true);
      setSaving(false);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-shell" style={{ maxWidth: 560 }}>
          <p className="form-helper">Loading your profile…</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="admin-page">
        <div className="admin-shell" style={{ maxWidth: 560 }}>
          <Link href="/my-huuid" style={{ color: 'var(--teal)', fontWeight: 600, fontSize: 13.5 }}>
            ← Back
          </Link>
          <p className="form-error-text" style={{ marginTop: 16 }}>{error ?? 'Could not load your profile.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-shell" style={{ maxWidth: 560 }}>
        <Link href="/my-huuid" style={{ color: 'var(--teal)', fontWeight: 600, fontSize: 13.5 }}>
          ← Back
        </Link>
        <h1 className="admin-title" style={{ margin: '16px 0 4px' }}>My Profile</h1>
        <p className="admin-subtitle" style={{ margin: '0 0 24px' }}>
          Update your personal and emergency contact details.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Full Legal Name</label>
            <input
              className="form-input"
              value={profile.fullName}
              onChange={(e) => update('fullName', e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Date of Birth</label>
            <input
              type="date"
              className="form-input"
              min="1900-01-01"
              max={TODAY}
              value={profile.dateOfBirth}
              onChange={(e) => update('dateOfBirth', e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Sex at Birth</label>
            <select
              className="form-select"
              value={profile.sexAtBirth}
              onChange={(e) => update('sexAtBirth', e.target.value as ProfileData['sexAtBirth'])}
              required
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="intersex">Intersex</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Country</label>
            <input className="form-input" value={profile.countryCode} disabled />
          </div>

          <div className="form-group">
            <label className="form-label">Phone Number</label>
            <input className="form-input" value={profile.phone} disabled />
            <p className="form-helper">
              {profile.phoneVerified ? '✓ Verified' : 'Not verified'} — to change your phone number, contact support.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Email <span className="form-optional-tag">Optional</span></label>
            <input
              className="form-input"
              type="email"
              value={profile.email ?? ''}
              onChange={(e) => update('email', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Emergency Contact Name <span className="form-optional-tag">Optional</span></label>
            <input
              className="form-input"
              value={profile.emergencyContactName ?? ''}
              onChange={(e) => update('emergencyContactName', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Emergency Contact Phone <span className="form-optional-tag">Optional</span></label>
            <input
              className="form-input"
              value={profile.emergencyContactPhone ?? ''}
              onChange={(e) => update('emergencyContactPhone', e.target.value)}
              placeholder="+233241234567"
            />
          </div>

          {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}
          {saved && <p className="form-helper" style={{ color: '#1a8f4c', marginBottom: 16 }}>✓ Profile updated.</p>}

          <button type="submit" className="btn btn-teal btn-block" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  );
}

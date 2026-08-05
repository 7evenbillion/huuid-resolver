'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import CountrySelect from '@/components/enroll/CountrySelect';
import { findCountry } from '@/lib/countries';
import { decryptAndSignChallenge } from '@/lib/client/keypair';
import SmsPendingBanner from '@/components/my-huuid/SmsPendingBanner';

type Tab = 'pin' | 'phone';

export default function MyHuuidLoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('pin');

  // PIN tab state
  const [huuid, setHuuid] = useState('');
  const [pin, setPin] = useState('');
  const [pinFailures, setPinFailures] = useState(0);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  // Phone tab state
  const [countryCode, setCountryCode] = useState('GH');
  const [phone, setPhone] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const country = findCountry(countryCode);
  const phoneDigits = phone.replace(/[^\d]/g, '');
  const fullPhone = country ? `${country.dialCode}${phoneDigits}` : phone;

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pinFailures >= 3) return;
    if (!/^did:huuid:/.test(huuid.trim()) || !/^\d{6}$/.test(pin)) return;
    setPinBusy(true);
    setPinError(null);

    try {
      const challengeRes = await fetch('/api/my-huuid/login/pin/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ huuid: huuid.trim() }),
      });
      const challengeData = await challengeRes.json();
      if (!challengeRes.ok) {
        setPinError(challengeData.error ?? 'Could not sign in.');
        setPinBusy(false);
        return;
      }

      const signatureB64 = await decryptAndSignChallenge({
        encryptedPrivateKeyB64: challengeData.encryptedPrivateKeyB64,
        pbkdf2SaltB64: challengeData.pbkdf2SaltB64,
        pbkdf2IvB64: challengeData.pbkdf2IvB64,
        pin,
        nonceB64: challengeData.nonce,
      });

      if (!signatureB64) {
        const failures = pinFailures + 1;
        setPinFailures(failures);
        setPin('');
        setPinError(
          failures >= 3
            ? 'Too many attempts. Use phone number to sign in.'
            : 'Incorrect PIN. Try again or use phone number.'
        );
        setPinBusy(false);
        return;
      }

      const verifyRes = await fetch('/api/my-huuid/login/pin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureB64 }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        const failures = pinFailures + 1;
        setPinFailures(failures);
        setPin('');
        setPinError(
          failures >= 3
            ? 'Too many attempts. Use phone number to sign in.'
            : (verifyData.error ?? 'Incorrect PIN. Try again or use phone number.')
        );
        setPinBusy(false);
        return;
      }

      router.push('/my-huuid');
    } catch {
      setPinError('Could not reach the server. Check your connection and try again.');
      setPinBusy(false);
    }
  }

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phoneDigits.length < 7 || phoneBusy) return;
    setPhoneBusy(true);
    setPhoneError(null);
    try {
      const res = await fetch('/api/my-huuid/login/otp/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPhoneError(data.error ?? 'Could not send a sign-in code.');
        setPhoneBusy(false);
        return;
      }
      sessionStorage.setItem('huuid_my_huuid_login_phone_last4', fullPhone.slice(-4));
      router.push('/my-huuid/login/verify');
    } catch {
      setPhoneError('Could not reach the server.');
      setPhoneBusy(false);
    }
  }

  return (
    <div className="enroll-page">
      <div className="enroll-shell">
        <div className="enroll-logo">
          <Image src="/images/logo-h.png" alt="HUUID" width={44} height={44} />
        </div>
        <h1 className="enroll-heading">My Healthcare Identity</h1>

        <div className="admin-action-row" style={{ marginBottom: 20 }}>
          <button className={`btn ${tab === 'pin' ? 'btn-teal' : 'btn-white-outline'}`} onClick={() => setTab('pin')}>
            🔑 Use PIN
          </button>
          <button className={`btn ${tab === 'phone' ? 'btn-teal' : 'btn-white-outline'}`} onClick={() => setTab('phone')}>
            📱 Use Phone Number
          </button>
        </div>

        {tab === 'pin' && (
          <form onSubmit={handlePinSubmit}>
            <div className="form-group">
              <label className="form-label">Enter your HUUID</label>
              <input
                className="form-input"
                placeholder="did:huuid:gh:..."
                value={huuid}
                onChange={(e) => setHuuid(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Enter your PIN</label>
              <input
                className="form-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                disabled={pinFailures >= 3}
              />
            </div>
            {pinError && <p className="form-error-text" style={{ marginBottom: 16 }}>{pinError}</p>}
            <button
              type="submit"
              className="btn btn-teal btn-block"
              disabled={pinBusy || pinFailures >= 3 || !/^did:huuid:/.test(huuid.trim()) || pin.length !== 6}
            >
              {pinBusy ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>
        )}

        {tab === 'phone' && (
          <form onSubmit={handlePhoneSubmit}>
            <p className="enroll-sub" style={{ marginTop: 0 }}>Enter your phone number</p>
            <CountrySelect label="Country" value={countryCode} onChange={setCountryCode} />
            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <div className="form-row">
                <input className="form-input" value={country?.dialCode ?? ''} disabled />
                <input
                  className="form-input"
                  type="tel"
                  placeholder="24 123 4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <SmsPendingBanner />
            {phoneError && <p className="form-error-text" style={{ marginBottom: 16 }}>{phoneError}</p>}
            <button type="submit" className="btn btn-teal btn-block" disabled={phoneBusy || phoneDigits.length < 7}>
              {phoneBusy ? 'Sending…' : 'Send Sign In Code →'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

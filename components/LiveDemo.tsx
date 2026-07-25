'use client';

import { useState } from 'react';

/**
 * IMPORTANT: this is a hardcoded demonstration, not a live API call.
 * The patient did:huuid:gh:AMA7X29ACCRA001 is fictional. The medical
 * history locations shown span multiple countries purely to illustrate
 * global reach -- no real API call is made and no real patient data is
 * used anywhere in this component. The animation replays fresh on every
 * click (all state resets to idle first).
 */

const STEPS = [
  'Digital Signature Verified',
  'Trusted Resolver Located',
  'Consent Policy Evaluated',
  'Audit Record Written',
  'Patient Identity Confirmed',
];

const STEP_DELAY_MS = 300;
const DEMO_DID = 'did:huuid:gh:AMA7X29ACCRA001';

const LOCATIONS = [
  { flag: '🇬🇭', name: 'Korle Bu Teaching Hospital', place: 'Accra, Ghana', kind: 'Primary Records' },
  { flag: '🇬🇭', name: 'Nyaho Medical Centre', place: 'Accra, Ghana', kind: 'Specialist Records' },
  { flag: '🇬🇭', name: 'MDS Lancet Laboratories', place: 'Accra, Ghana', kind: 'Laboratory Records' },
  { flag: '🇬🇧', name: 'St. Thomas Hospital', place: 'London, United Kingdom', kind: 'Emergency Records' },
  { flag: '🇿🇦', name: 'Cape Town Medical Centre', place: 'Cape Town, South Africa', kind: 'Consultation Records' },
];

const DEMO_JSON = {
  '@context': 'https://w3id.org/did-resolution/v1',
  didDocument: {
    id: DEMO_DID,
    'huuid:status': 'active',
    service: LOCATIONS.map((l, i) => ({
      id: `${DEMO_DID}#record-${i + 1}`,
      type: 'HUUIDHealthRecord',
      facility: l.name,
      location: l.place,
      recordType: l.kind,
    })),
  },
  didResolutionMetadata: {
    resolvedAt: '2026-07-25T00:00:00Z',
    durationMs: 247,
  },
  didDocumentMetadata: {
    'huuid:purposeCode': 'Treatment',
    'huuid:consentRequired': true,
  },
  note: 'This is a hardcoded demonstration response. No real API call was made.',
};

export default function LiveDemo() {
  const [did, setDid] = useState(DEMO_DID);
  const [running, setRunning] = useState(false);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [done, setDone] = useState(false);
  const [showJson, setShowJson] = useState(false);

  async function handleResolve() {
    if (running) return;
    setRunning(true);
    setDone(false);
    setShowJson(false);
    setVisibleSteps(0);

    for (let i = 1; i <= STEPS.length; i++) {
      await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
      setVisibleSteps(i);
    }

    setDone(true);
    setRunning(false);
  }

  return (
    <div className="demo-grid">
      <div className="terminal-panel">
        <div className="terminal-label">HUUID RESOLVER</div>
        <div className="terminal-input-row">
          <input
            className="terminal-input"
            value={did}
            onChange={(e) => setDid(e.target.value)}
            disabled={running}
            spellCheck={false}
          />
        </div>
        <button className="btn btn-teal btn-block" onClick={handleResolve} disabled={running}>
          {running ? 'Resolving…' : 'Resolve Identity'}
        </button>

        <div className="terminal-output" style={{ marginTop: 16 }}>
          {visibleSteps === 0 && !done && (
            <p style={{ color: '#8b93a7' }}>
              Awaiting request<span className="terminal-cursor" />
            </p>
          )}
          {visibleSteps > 0 && <p>Resolving Identity...</p>}
          {STEPS.slice(0, visibleSteps).map((s) => (
            <p key={s}>
              <span className="terminal-check">✓</span>
              <span>{s}</span>
            </p>
          ))}
          {done && <p className="terminal-duration">Completed in 247 ms</p>}
        </div>
      </div>

      <div className="result-card">
        <div className="result-header">✓ PATIENT RECOGNISED</div>
        <div className="result-body">
          {!done ? (
            <p className="card-body">Run a resolution to see the result.</p>
          ) : (
            <>
              <div className="result-row">
                <span>Identity Status:</span>
                <strong>Verified ✓</strong>
              </div>
              <div className="result-row">
                <span>Healthcare Identity:</span>
                <strong>Active ✓</strong>
              </div>

              <hr className="result-divider" />

              <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                Medical History Located At:
              </p>
              {LOCATIONS.map((loc) => (
                <div className="result-location" key={loc.name}>
                  <span>{loc.flag}</span>
                  <div className="result-location-text">
                    <strong>{loc.name}</strong>
                    <span>
                      {loc.place} — {loc.kind}
                    </span>
                  </div>
                </div>
              ))}

              <hr className="result-divider" />

              <div className="result-row">
                <span>Emergency Information:</span>
                <strong>Available</strong>
              </div>
              <div className="result-row">
                <span>Patient Consent:</span>
                <strong>Required before records can be accessed</strong>
              </div>

              <hr className="result-divider" />

              <p className="result-note">
                Medical records are not stored by HUUID. Every healthcare institution continues to
                own and manage the records it creates.
              </p>

              <button className="result-json-toggle" onClick={() => setShowJson((v) => !v)}>
                {showJson ? 'Hide Technical Response ›' : 'View Technical Response ›'}
              </button>

              {showJson && <pre className="result-json">{JSON.stringify(DEMO_JSON, null, 2)}</pre>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

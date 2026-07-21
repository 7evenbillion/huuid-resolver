'use client';

import { useState } from 'react';

const STEPS = [
  'Signature verified',
  'Resolver located',
  'Consent policy evaluated',
  'Audit entry written',
  'DID document returned',
];

const DEMO_DID = 'did:huuid:gh:TEST7X29ALPHAxyz001';
const STEP_DELAY_MS = 200;

type ResolveResult = {
  ok: boolean;
  durationMs: number | null;
  body: unknown;
};

export default function ResolverTerminal() {
  const [did, setDid] = useState(DEMO_DID);
  const [running, setRunning] = useState(false);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [result, setResult] = useState<ResolveResult | null>(null);

  async function handleResolve() {
    if (running || !did.trim()) return;
    setRunning(true);
    setResult(null);
    setVisibleSteps(0);

    const fetchPromise = fetch('/api/demo/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: did.trim() }),
    })
      .then(async (res) => {
        const body = await res.json();
        const durationMs =
          typeof body?.didResolutionMetadata?.durationMs === 'number'
            ? body.didResolutionMetadata.durationMs
            : null;
        return { ok: res.ok, durationMs, body } as ResolveResult;
      })
      .catch(
        (err) =>
          ({
            ok: false,
            durationMs: null,
            body: { error: err instanceof Error ? err.message : 'Network error' },
          }) as ResolveResult
      );

    for (let i = 1; i <= STEPS.length; i++) {
      await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
      setVisibleSteps(i);
    }

    const outcome = await fetchPromise;
    setResult(outcome);
    setRunning(false);
  }

  return (
    <div className="resolver-shell">
      <div className="resolver-input-row">
        <input
          className="resolver-input"
          value={did}
          onChange={(e) => setDid(e.target.value)}
          placeholder="did:huuid:gh:..."
          spellCheck={false}
          disabled={running}
        />
        <button className="btn btn-primary" onClick={handleResolve} disabled={running}>
          {running ? 'Resolving…' : 'Resolve'}
        </button>
      </div>

      <div className="terminal">
        {visibleSteps === 0 && !result && (
          <p className="terminal-line terminal-idle">Awaiting request…</p>
        )}
        {visibleSteps > 0 && (
          <p className="terminal-line">Resolving DID…</p>
        )}
        {STEPS.slice(0, visibleSteps).map((step) => (
          <p className="terminal-line" key={step}>
            <span className="terminal-check">✓</span>
            <span>{step}</span>
          </p>
        ))}
        {result && (
          <p
            className={
              result.ok ? 'terminal-line terminal-duration' : 'terminal-line terminal-error'
            }
          >
            {result.ok
              ? `Completed in ${result.durationMs ?? '—'}ms`
              : 'Request did not complete — see response below.'}
          </p>
        )}
      </div>

      {result && (
        <div className="resolver-json">
          <pre>{JSON.stringify(result.body, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

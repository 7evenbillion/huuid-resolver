'use client';

import { useState } from 'react';

export default function SmsTestDebugPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/debug/sms-test', { method: 'POST' });
      const data = await res.json();
      setResult(JSON.stringify({ status: res.status, ...data }, null, 2));
    } catch (e) {
      setResult(`fetch failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    setBusy(false);
  }

  return (
    <div style={{ padding: 40, fontFamily: 'monospace', maxWidth: 700 }}>
      <h1>Standalone SMS Test (temporary debug page)</h1>
      <p>Sends one test SMS to +233243222058 via the production deployment, using the exact same lib/sms.ts as every other feature.</p>
      <button onClick={send} disabled={busy} style={{ padding: '10px 20px', fontSize: 16 }}>
        {busy ? 'Sending…' : 'Send Test SMS'}
      </button>
      {result && <pre style={{ marginTop: 20, background: '#f0f0f0', padding: 16, whiteSpace: 'pre-wrap' }}>{result}</pre>}
    </div>
  );
}

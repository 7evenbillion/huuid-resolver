'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await fetch('/api/my-huuid/logout', { method: 'POST' });
    } finally {
      router.push('/my-huuid/login');
      router.refresh();
    }
  }

  return (
    <button className="myhuuid-signout-btn" onClick={handleSignOut} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign Out'}
    </button>
  );
}

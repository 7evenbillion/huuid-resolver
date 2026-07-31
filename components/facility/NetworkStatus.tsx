'use client';

import { useEffect, useState } from 'react';

export default function NetworkStatus() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((res) => {
        if (!cancelled) setOnline(res.ok);
      })
      .catch(() => {
        if (!cancelled) setOnline(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <span className="facility-status">
      <span className={`facility-status-dot${online ? ' online' : ''}`} />
      {online === null ? 'Checking…' : online ? 'ONLINE' : 'OFFLINE'}
    </span>
  );
}

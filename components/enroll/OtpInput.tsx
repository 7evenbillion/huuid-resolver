'use client';

import { useEffect, useRef, useState } from 'react';

export default function OtpInput({
  length = 6,
  disabled,
  onComplete,
  resetKey,
}: {
  length?: number;
  disabled?: boolean;
  onComplete: (code: string) => void;
  resetKey?: number;
}) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(''));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setDigits(Array(length).fill(''));
    refs.current[0]?.focus();
  }, [resetKey, length]);

  function setDigit(index: number, value: string) {
    const next = [...digits];
    next[index] = value;
    setDigits(next);
    if (next.every((d) => d !== '')) {
      onComplete(next.join(''));
    }
  }

  function handleChange(index: number, raw: string) {
    const value = raw.replace(/\D/g, '').slice(-1);
    setDigit(index, value);
    if (value && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(length).fill('');
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    const lastIndex = Math.min(pasted.length, length) - 1;
    refs.current[lastIndex]?.focus();
    if (pasted.length === length) onComplete(pasted);
  }

  return (
    <div className="otp-row">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="otp-box"
          inputMode="numeric"
          maxLength={1}
          value={d}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
        />
      ))}
    </div>
  );
}

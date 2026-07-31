'use client';

/**
 * Static placeholder for Layer 5's dashboard shell — the build brief
 * places this button's visual position/label in Layer 5's screen but its
 * actual modal + SMS-alert behavior in Layer 9. Rendered inert here
 * (no-op) rather than wired to a half-built flow; Layer 9 replaces the
 * onClick with the real modal.
 */
export default function EmergencySupportButton({ facilityName: _facilityName }: { facilityName: string }) {
  return (
    <button
      className="facility-emergency-btn"
      onClick={() => alert('Emergency Support is being wired up in the next layer of this build.')}
    >
      🚨 Emergency Support
    </button>
  );
}

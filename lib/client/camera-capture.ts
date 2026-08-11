'use client';

/** Shared by components/enroll/VerifyIdentity.tsx (Layer 3) and components/facility/Tier2Upgrade.tsx (Layer 5) -- both need the same still-frame-from-video capture and a short burst of liveness frames for Smile ID's 6-8 image requirement. */

export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Could not access canvas.'));
  ctx.drawImage(video, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not capture frame.'))), 'image/jpeg', 0.9);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const LIVENESS_FRAME_COUNT = 6;
export const LIVENESS_FRAME_INTERVAL_MS = 200;

export async function captureLivenessBurst(video: HTMLVideoElement): Promise<Blob[]> {
  const frames: Blob[] = [];
  for (let i = 0; i < LIVENESS_FRAME_COUNT; i++) {
    frames.push(await captureFrame(video));
    await sleep(LIVENESS_FRAME_INTERVAL_MS);
  }
  return frames;
}

export const MIN_RESOLUTION_RESPONSE_TIME_MS = 150;

/**
 * Delays until at least MIN_RESOLUTION_RESPONSE_TIME_MS has elapsed since
 * startTime. Applied uniformly to all DID-resolution outcomes (success,
 * notFound, deactivated) so that 404/410/200 timings converge and cannot be
 * used to enumerate whether a HUUID exists or was revoked.
 */
export async function enforceResponseTimeFloor(startTime: number): Promise<void> {
  const remaining = MIN_RESOLUTION_RESPONSE_TIME_MS - (Date.now() - startTime);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

/**
 * friendlyError — translate raw fetch/API failures into human language.
 *
 * Raw errors like "job: HTTP 500" or "Failed to fetch" are developer logs,
 * not user-facing copy. Every catch that surfaces text to the user should
 * run through here. Unknown messages pass through unchanged.
 */
export function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const msg = raw.trim();

  // Network failures — fetch throws TypeError("Failed to fetch") offline
  // or when the server is unreachable.
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) {
    return "Couldn't reach the server — check your connection and try again.";
  }

  // Strip "job: " / "events: " / "families: " prefixes the pages add, then
  // map the HTTP code.
  const code = msg.match(/HTTP\s+(\d{3})/)?.[1];
  if (code) {
    if (code === '401') return 'Your session expired — sign in again and retry.';
    if (code === '403') return "You don't have access to this — sign in with the right account.";
    if (code === '404') return "Couldn't find it — it may have been moved or deleted.";
    if (code === '409') return 'That action conflicts with the current state — reload and try again.';
    if (code === '429') return 'Too many requests — wait a moment and try again.';
    if (code === '413') return 'That file is too large — try a smaller one.';
    if (/^5/.test(code)) return 'The server hit a snag — give it a moment and retry.';
    return `Something went wrong (${code}) — try again.`;
  }

  // Timeout / abort signals.
  if (/timeout|aborted|aborterror/i.test(msg)) {
    return 'The request timed out — try again.';
  }

  return msg;
}

/**
 * True when the raw error looks like an expired/revoked session (HTTP 401
 * or the session gate's own messages). The UI uses this to offer a
 * "Sign in again" action instead of a dead-end error string.
 */
export function isSessionExpired(e: unknown): boolean {
  const raw = e instanceof Error ? e.message : String(e);
  if (/HTTP\s+401\b/.test(raw)) return true;
  return /not authenticated|session has been revoked|session is not device-bound/i.test(raw);
}

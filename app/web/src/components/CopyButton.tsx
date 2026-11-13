'use client';

import { useState } from 'react';

/**
 * Copy-to-clipboard button (Epic 2). Used on the confirmation
 * page for the join link; kept generic so the join page and the
 * dashboard can grow the same control later. Falls back to
 * selecting nothing and saying so is overkill: on a clipboard
 * failure the button just does not flip to "Copied", and the
 * link text itself stays visible and selectable next to it.
 */
export function CopyButton({ text, label = 'Copy link' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary"
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

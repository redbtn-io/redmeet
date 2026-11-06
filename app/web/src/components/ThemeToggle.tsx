'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

/**
 * The app's theme control. redLabel owns the theming machinery (the boot
 * script, the scheme styles), the APP owns this button (redlabel.md: "No
 * theme toggle UI. The app owns its theme control").
 *
 * It speaks exactly the boot script's protocol, so the two never disagree:
 * the choice is stored in localStorage under `redstyle-theme`, applied as
 * the `dark` or `light` class on `<html>` with a matching `colorScheme`,
 * and the unscoped `meta[name="theme-color"]` the boot script maintains is
 * repointed at the new scheme's surface colour, read back from the CSS
 * variables themselves so the brand decides the colour, not this file.
 */

type Scheme = 'dark' | 'light';

const STORAGE_KEY = 'redstyle-theme';

function currentScheme(): Scheme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function applyScheme(next: Scheme): void {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(next);
  root.style.colorScheme = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A browser that refuses storage still gets the theme for this page.
  }
  // The boot script's own theme-color meta is the one without a media
  // attribute; the brandViewport pair is media-scoped and stays correct
  // untouched.
  const surface = getComputedStyle(root).getPropertyValue('--bg-primary').trim();
  if (surface) {
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      if (!meta.hasAttribute('media')) meta.setAttribute('content', surface);
    }
  }
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [scheme, setScheme] = useState<Scheme>('dark');

  useEffect(() => {
    setScheme(currentScheme());
  }, []);

  const next: Scheme = scheme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => {
        applyScheme(next);
        setScheme(next);
      }}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={`flex items-center justify-center rounded-lg p-2 text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary active:scale-95 ${className}`}
    >
      {scheme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

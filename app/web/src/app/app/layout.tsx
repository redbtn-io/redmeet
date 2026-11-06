'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { IconCalendar, IconSettings, IconSignOut } from './ui';

const NAV = [
  { href: '/app', label: 'Dashboard', exact: true, Icon: IconCalendar },
  { href: '/app/settings', label: 'Settings', exact: true, Icon: IconSettings },
];

function isActive(item: (typeof NAV)[number], pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname.startsWith(item.href);
}

/**
 * App shell: desktop sidebar + mobile bars, simplified from redSites'
 * shell. The sign-out is a POST form, never a link (Next prefetches GET
 * links, and a GET signout would log the user out of every redApp by
 * merely rendering; see app/signout/route.ts).
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/v0/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (live && data?.email) setEmail(String(data.email));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="min-h-screen min-h-dvh bg-bg text-text-primary">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(600px_300px_at_15%_-5%,rgba(239,68,68,0.08),transparent),radial-gradient(500px_260px_at_90%_0%,rgba(239,68,68,0.05),transparent)]"
      />

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-bg-secondary/80 backdrop-blur md:flex">
        <Link href="/" className="flex items-center gap-3 px-4 pb-5 pt-6 transition hover:opacity-80">
          <img
            src="/icons/redbtn-logo.png"
            alt=""
            className="h-9 w-9 shrink-0 rounded-xl"
          />
          <div className="min-w-0">
            <p className="truncate text-[10px] uppercase tracking-[0.2em] text-text-secondary">meet.redbtn.io</p>
            <h1 className="truncate text-lg font-semibold leading-tight">redMeet</h1>
          </div>
        </Link>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active = isActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition active:scale-[0.98] ${
                  active
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:bg-bg hover:text-text-primary'
                }`}
              >
                <item.Icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center justify-between px-3 pb-1">
            <span className="text-xs text-text-secondary">Theme</span>
            <ThemeToggle />
          </div>
          {email && (
            <p className="truncate px-3 pb-2 text-xs text-text-secondary" title={email}>
              {email}
            </p>
          )}
          <form action="/signout" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text-secondary transition hover:bg-bg hover:text-text-primary"
            >
              <IconSignOut className="h-5 w-5 shrink-0" />
              <span>Sign out</span>
            </button>
          </form>
        </div>
      </aside>

      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-bg-secondary/85 px-4 py-3 backdrop-blur md:hidden">
        <Link href="/" className="flex items-center gap-2.5 transition hover:opacity-80">
          <img src="/icons/redbtn-logo.png" alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-semibold">redMeet</span>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <form action="/signout" method="post">
          <button
            type="submit"
            aria-label="Sign out"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-text-secondary"
          >
            <IconSignOut className="h-4 w-4" /> Sign out
          </button>
          </form>
        </div>
      </header>

      <main id="main-content" className="relative z-10 min-h-screen min-h-dvh pb-28 md:pb-0 md:pl-60">
        <div className="animate-fade-up mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg-secondary/90 backdrop-blur md:hidden">
        <div className="grid grid-cols-2 px-1 pb-[env(safe-area-inset-bottom)]">
          {NAV.map((item) => {
            const active = isActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-[10px] font-medium transition active:scale-95 ${
                  active ? 'text-accent' : 'text-text-secondary'
                }`}
              >
                <span className={`rounded-lg p-1 transition ${active ? 'bg-accent/15' : ''}`}>
                  <item.Icon className="h-5 w-5" />
                </span>
                <span className="leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { signInUrl } from '@redbtn/redlabel/auth';
import { REGISTRY, deploymentBrand } from '@redbtn/redlabel/brands';

import { getConfig } from '@/lib/config';
import { getAuth } from '@/lib/session';

/**
 * The landing page is evaluated on every request: an authenticated visitor
 * never sees marketing copy, they go straight to the dashboard.
 */
export const dynamic = 'force-dynamic';

const STEPS = [
  { name: 'Claim your link', desc: 'Sign in with your redbtn account and your booking page is live at meet.redbtn.io/you' },
  { name: 'Connect your calendar', desc: 'Your Google calendar, through redbtn connections, decides what is actually free' },
  { name: 'Share it anywhere', desc: 'Guests open the link, pick a meeting type and a time, and book, no account, no email tag' },
  { name: 'It lands on your calendar', desc: 'The confirmed booking is written onto your calendar with the guest invited' },
];

const ECOSYSTEM = [
  { label: 'redbtn.io', href: 'https://redbtn.io' },
  { label: 'redSites, prompt to website', href: 'https://sites.redbtn.io' },
  { label: 'Your account', href: 'https://accounts.redbtn.io' },
];

/**
 * JWT-gate only (no device-session liveness lookup): cheap enough to run on
 * every landing hit, and consistent with the proxy, which degrades to the
 * JWT gate when accounts cannot answer. `/app`'s own gate remains the
 * authoritative check.
 */
async function hasSession(): Promise<boolean> {
  const config = getConfig();
  if (!config.jwtSecret || !config.authMongoUri) return false;
  const cookie = (await headers()).get('cookie');
  if (!cookie) return false;
  try {
    const payload = getAuth().getUserFromHeaders({ cookie, authorization: null });
    return !!payload?.userId && !!payload?.email;
  } catch {
    return false;
  }
}

export default async function Landing() {
  if (await hasSession()) redirect('/app');

  const signIn = signInUrl(deploymentBrand(REGISTRY), '/app');

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
        <Link href="/" className="flex items-center gap-4 transition hover:opacity-80">
          <img src="/icons/redbtn-logo.png" alt="" className="h-16 w-16 rounded-2xl" />
          <div>
            <p className="text-sm uppercase tracking-widest text-text-secondary">
              meet.redbtn.io
            </p>
            <h1 className="mt-1 text-5xl font-semibold">redMeet</h1>
          </div>
        </Link>
        <p className="mt-6 max-w-xl text-lg text-text-secondary">
          Simple meeting scheduling on your real calendar. One link,
          guests book without an account.
        </p>

        <div className="mt-8">
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={signIn}
              className="inline-block rounded-xl bg-accent px-6 py-3 font-medium text-white transition hover:brightness-110 active:scale-[0.98]"
            >
              Get your booking link
            </a>
            <a
              href="/george"
              className="inline-block rounded-xl border border-border px-6 py-3 font-medium text-text-primary transition hover:bg-bg-secondary active:scale-[0.98]"
            >
              See a live booking page
            </a>
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            Sign in with your redbtn account to claim your link
          </p>
        </div>

        <ol className="mt-12 space-y-3">
          {STEPS.map((step, i) => (
            <li
              key={step.name}
              className="flex items-baseline gap-4 rounded-xl border border-border bg-bg-secondary p-4"
            >
              <span className="font-mono text-sm text-text-secondary">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div>
                <div className="font-medium">{step.name}</div>
                <div className="text-sm text-text-secondary">{step.desc}</div>
              </div>
            </li>
          ))}
        </ol>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-6">
          <Link href="/" className="flex items-center gap-2 transition hover:opacity-80">
            <img src="/icons/redbtn-logo.png" alt="" className="h-6 w-6 rounded-md" />
            <span className="text-sm font-medium">redMeet</span>
          </Link>
          <nav className="flex flex-wrap gap-x-5 gap-y-1">
            {ECOSYSTEM.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <p className="ml-auto text-xs text-text-secondary">
            Part of the redbtn family, automate everything.
          </p>
        </div>
      </footer>
    </div>
  );
}

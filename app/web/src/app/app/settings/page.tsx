'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader } from '../ui';

interface Host {
  slug: string;
  displayName: string;
  bio: string;
  color: string;
  timeZone: string;
  calendarIds: string[];
  googleConnectionId: string | null;
  bookingUrl: string;
}

interface MeetingType {
  id: string;
  slug: string;
  name: string;
  description: string;
  lengthMinutes: number;
  active: boolean;
}

interface GoogleAccount {
  connectionId: string;
  email: string;
  isDefault: boolean;
  status: string;
}

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60';
const labelCls = 'mb-1 block text-xs font-medium uppercase tracking-wider text-text-secondary';

/**
 * Settings: the original's Settings page said "Coming soon...", this
 * one is the real thing. Profile (slug, name, bio, brand colour),
 * calendar wiring (which calendars block your slots, which Google
 * connection the calendar calls act through), and meeting types.
 */
export default function Settings() {
  const [host, setHost] = useState<Host | null>(null);
  const [types, setTypes] = useState<MeetingType[]>([]);
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const [calendarsText, setCalendarsText] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ slug: '', name: '', description: '', lengthMinutes: 30 });

  async function load() {
    const [me, t, a] = await Promise.all([
      fetch('/api/v0/me').then((r) => r.json()),
      fetch('/api/v0/meeting-types').then((r) => r.json()),
      fetch('/api/v0/google-accounts').then((r) => r.json()).catch(() => ({ accounts: [] })),
    ]);
    setHost(me.host);
    setCalendarsText((me.host.calendarIds ?? ['primary']).join(', '));
    setTypes(t.meetingTypes ?? []);
    setAccounts(a.accounts ?? []);
  }

  useEffect(() => {
    load().catch(() => setError('Could not load your settings.'));
  }, []);

  async function saveProfile(patch: Record<string, unknown>, note: string) {
    setError(null);
    const res = await fetch('/api/v0/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? 'Could not save. Try again.');
      return;
    }
    setHost(data.host);
    setSaved(note);
    setTimeout(() => setSaved(null), 2500);
  }

  async function addType(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/v0/meeting-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? 'Could not add that meeting type.');
      return;
    }
    setDraft({ slug: '', name: '', description: '', lengthMinutes: 30 });
    await load();
  }

  async function patchType(id: string, patch: Record<string, unknown>) {
    await fetch(`/api/v0/meeting-types/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await load();
  }

  async function deleteType(id: string) {
    await fetch(`/api/v0/meeting-types/${id}`, { method: 'DELETE' });
    await load();
  }

  if (!host) {
    return (
      <>
        <PageHeader title="Settings" />
        <p className="text-sm text-text-secondary">{error ?? 'Loading...'}</p>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" sub="Your public page, your calendar, your meeting types." />
      {error && (
        <p className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">{error}</p>
      )}
      {saved && (
        <p className="mb-4 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm">{saved}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 font-semibold">Booking page</h3>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveProfile(
                {
                  slug: host.slug,
                  displayName: host.displayName,
                  bio: host.bio,
                  color: host.color,
                },
                'Booking page saved.',
              );
            }}
          >
            <div>
              <label className={labelCls} htmlFor="slug">Your link slug</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-secondary">meet.redbtn.io/</span>
                <input
                  id="slug"
                  className={inputCls}
                  value={host.slug}
                  onChange={(e) => setHost({ ...host, slug: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="displayName">Display name</label>
              <input
                id="displayName"
                className={inputCls}
                value={host.displayName}
                onChange={(e) => setHost({ ...host, displayName: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="bio">Bio, shown on your booking page</label>
              <textarea
                id="bio"
                className={inputCls}
                rows={3}
                value={host.bio}
                onChange={(e) => setHost({ ...host, bio: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="color">Brand colour</label>
              <div className="flex items-center gap-3">
                <input
                  id="color"
                  type="color"
                  className="h-10 w-14 cursor-pointer rounded border border-border bg-bg"
                  value={host.color}
                  onChange={(e) => setHost({ ...host, color: e.target.value })}
                />
                <span className="font-mono text-sm text-text-secondary">{host.color}</span>
              </div>
            </div>
            <button type="submit" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white">
              Save page
            </button>
          </form>
        </Card>

        <Card>
          <h3 className="mb-4 font-semibold">Calendar</h3>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveProfile(
                {
                  calendarIds: calendarsText.split(',').map((s) => s.trim()).filter(Boolean),
                  googleConnectionId: host.googleConnectionId,
                },
                'Calendar settings saved.',
              );
            }}
          >
            <div>
              <label className={labelCls} htmlFor="conn">Google account</label>
              <select
                id="conn"
                className={inputCls}
                value={host.googleConnectionId ?? ''}
                onChange={(e) =>
                  setHost({ ...host, googleConnectionId: e.target.value || null })
                }
              >
                <option value="">Default linked account</option>
                {accounts.map((a) => (
                  <option key={a.connectionId} value={a.connectionId}>
                    {a.email}
                    {a.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-text-secondary">
                Availability is read from this account, and bookings are written to it.
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="cals">Calendars that block slots</label>
              <input
                id="cals"
                className={inputCls}
                value={calendarsText}
                onChange={(e) => setCalendarsText(e.target.value)}
                placeholder="primary"
              />
              <p className="mt-1 text-xs text-text-secondary">
                Comma separated calendar ids. Busy time on any of them closes those slots.
              </p>
            </div>
            <p className="text-xs text-text-secondary">
              Time zone: {host.timeZone}. Booking windows: weekdays 10:00AM to 8:00PM,
              weekends 10:00AM to 2:00PM, 30 minute slots.
            </p>
            <button type="submit" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white">
              Save calendar
            </button>
          </form>
        </Card>
      </div>

      <Card className="mt-6">
        <h3 className="mb-4 font-semibold">Meeting types</h3>
        <div className="space-y-3">
          {types.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {t.name}
                  <span className="ml-2 font-mono text-xs text-text-secondary">
                    /{host.slug}/{t.slug}
                  </span>
                </p>
                <p className="truncate text-xs text-text-secondary">
                  {t.lengthMinutes} min{t.description ? `, ${t.description}` : ''}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={t.active}
                  onChange={(e) => void patchType(t.id, { active: e.target.checked })}
                />
                Bookable
              </label>
              <button
                onClick={() => void deleteType(t.id)}
                className="text-xs text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
              >
                Delete
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={addType} className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input
            className={inputCls}
            placeholder="Name, e.g. Deep dive"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            required
          />
          <input
            className={inputCls}
            placeholder="Link, e.g. deep-dive"
            value={draft.slug}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            required
          />
          <input
            className={inputCls}
            placeholder="Description"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <input
            className={inputCls}
            type="number"
            min={5}
            max={480}
            step={5}
            value={draft.lengthMinutes}
            onChange={(e) => setDraft({ ...draft, lengthMinutes: Number(e.target.value) })}
            required
          />
          <button type="submit" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white">
            Add type
          </button>
        </form>
      </Card>
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';

import { formatTimeOfDay, validateAvailabilityWindows, type AvailabilityWindows } from '@redmeet/core';

import { Card, PageHeader } from '../ui';

interface SelectionEntry {
  connectionId: string;
  calendarId: string;
  email: string;
  summary: string;
}

interface Host {
  slug: string;
  displayName: string;
  bio: string;
  color: string;
  timeZone: string;
  availabilityWindows: AvailabilityWindows;
  calendarIds: string[];
  calendarSelection: SelectionEntry[];
  calendarWriteTarget: { connectionId: string; calendarId: string } | null;
  googleConnectionId: string | null;
  googleConnectionEmail: string | null;
  googleConnectionIds: string[];
  calendarConnected: boolean;
  calendarConnectedAt: string | null;
  bookingUrl: string;
}

interface MeetingType {
  id: string;
  slug: string;
  name: string;
  description: string;
  lengthMinutes: number;
  entryMode: 'open' | 'waiting_room';
  active: boolean;
}

interface GoogleAccount {
  connectionId: string;
  email: string;
  isDefault: boolean;
  status: string;
}

interface CalendarItem {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

interface AccountGroup {
  connectionId: string;
  email: string;
  isDefault: boolean;
  status: string;
  calendars: CalendarItem[];
  error?: string;
}

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60';
const labelCls = 'mb-1 block text-xs font-medium uppercase tracking-wider text-text-secondary';

function pairKey(connectionId: string, calendarId: string): string {
  return `${connectionId}|${calendarId}`;
}

/**
 * Settings: profile (slug, name, bio, brand colour), calendar
 * connection, and meeting types.
 *
 * The calendar connection is per host and self serve: the host links
 * Google in redbtn Connections, mints their own personal access token
 * in redbtn Settings, and pastes it here. redMeet proves the token is
 * theirs, and stores it sealed. From then on their availability and
 * booking writes run under their own credential, across every google
 * account they have linked: the calendar picker spans ALL of their
 * connections, grouped by account, because that is where a real
 * schedule actually lives.
 */
export default function Settings() {
  const [host, setHost] = useState<Host | null>(null);
  const [types, setTypes] = useState<MeetingType[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ slug: '', name: '', description: '', lengthMinutes: 30, entryMode: 'open' as 'open' | 'waiting_room' });

  async function load() {
    const [me, t] = await Promise.all([
      fetch('/api/v0/me').then((r) => r.json()),
      fetch('/api/v0/meeting-types').then((r) => r.json()),
    ]);
    setHost(me.host);
    setTypes(t.meetingTypes ?? []);
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
    setDraft({ slug: '', name: '', description: '', lengthMinutes: 30, entryMode: 'open' });
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
            <button type="submit" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]">
              Save page
            </button>
          </form>
        </Card>

        <CalendarCard host={host} setHost={setHost} onSaved={setSaved} />

        <HoursCard host={host} setHost={setHost} onSaved={setSaved} />
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
                  {t.entryMode === 'waiting_room' ? ', waiting room' : ''}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                Entry
                <select
                  aria-label={`Entry mode for ${t.name}`}
                  className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs text-text-primary"
                  value={t.entryMode ?? 'open'}
                  onChange={(e) => void patchType(t.id, { entryMode: e.target.value })}
                >
                  <option value="open">Open entry</option>
                  <option value="waiting_room">Waiting room</option>
                </select>
              </label>
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

        <form onSubmit={addType} className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
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
          <select
            aria-label="Entry mode for the new meeting type"
            className={inputCls}
            value={draft.entryMode}
            onChange={(e) => setDraft({ ...draft, entryMode: e.target.value as 'open' | 'waiting_room' })}
          >
            <option value="open">Open entry</option>
            <option value="waiting_room">Waiting room</option>
          </select>
          <button type="submit" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]">
            Add type
          </button>
        </form>
      </Card>
    </>
  );
}

function CalendarCard({
  host,
  setHost,
  onSaved,
}: {
  host: Host;
  setHost: (h: Host) => void;
  onSaved: (note: string) => void;
}) {
  const [groups, setGroups] = useState<AccountGroup[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [writeKey, setWriteKey] = useState('');
  const [token, setToken] = useState('');
  const [accounts, setAccounts] = useState<GoogleAccount[] | null>(null);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);

  // Load every connection and its calendars, plus the stored
  // selection, whenever the connection state changes. The server
  // forward-migrates legacy records as part of this read, so what is
  // ticked here is what availability uses.
  useEffect(() => {
    if (!host.calendarConnected) {
      setGroups(null);
      setSelected([]);
      setWriteKey('');
      return;
    }
    let live = true;
    fetch('/api/v0/calendar/calendars')
      .then((r) => r.json())
      .then((data) => {
        if (!live) return;
        setGroups(data.accounts ?? []);
        setGroupsError(data.error ?? null);
        const sel: SelectionEntry[] = data.selection ?? host.calendarSelection ?? [];
        setSelected(sel.map((e) => pairKey(e.connectionId, e.calendarId)));
        const wt = data.writeTarget ?? host.calendarWriteTarget;
        setWriteKey(wt ? pairKey(wt.connectionId, wt.calendarId) : '');
      })
      .catch(() => {
        if (live) setGroupsError('Could not load your calendars. Try again.');
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.calendarConnected]);

  async function validateToken() {
    setFlowError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/v0/calendar/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlowError(data.error ?? 'That token was not accepted.');
        return;
      }
      if (!data.accounts?.length) {
        setFlowError(data.error ?? 'No google accounts are linked to your redbtn account yet.');
        return;
      }
      setAccounts(data.accounts);
      const def = data.accounts.find((a: GoogleAccount) => a.isDefault) ?? data.accounts[0];
      setPicked(def.connectionId);
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setFlowError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/v0/calendar/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), connectionId: picked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlowError(data.error ?? 'Could not connect. Try again.');
        return;
      }
      setHost(data.host);
      setToken('');
      setAccounts(null);
      onSaved('Calendar connected.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setFlowError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/v0/calendar/connect', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setHost(data.host);
        onSaved('Calendar disconnected.');
      }
    } finally {
      setBusy(false);
    }
  }

  function togglePair(key: string, on: boolean) {
    const next = on ? [...selected, key] : selected.filter((k) => k !== key);
    setSelected(next);
    if (!on && writeKey === key) {
      setWriteKey(next[0] ?? '');
    }
    if (on && !next.includes(writeKey)) {
      setWriteKey(writeKey || key);
    }
  }

  function pickedEntries(): SelectionEntry[] {
    const entries: SelectionEntry[] = [];
    for (const group of groups ?? []) {
      for (const cal of group.calendars) {
        if (selected.includes(pairKey(group.connectionId, cal.id))) {
          entries.push({
            connectionId: group.connectionId,
            calendarId: cal.id,
            email: group.email,
            summary: cal.summary,
          });
        }
      }
    }
    return entries;
  }

  async function saveCalendars(e: React.FormEvent) {
    e.preventDefault();
    setFlowError(null);
    const entries = pickedEntries();
    if (!entries.length) {
      setFlowError('Tick at least one calendar to block slots, or disconnect your calendar.');
      return;
    }
    const wtEntry =
      entries.find((en) => pairKey(en.connectionId, en.calendarId) === writeKey) ?? entries[0]!;
    const res = await fetch('/api/v0/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendarSelection: {
          calendars: entries,
          writeTarget: { connectionId: wtEntry.connectionId, calendarId: wtEntry.calendarId },
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setHost(data.host);
      onSaved('Calendar settings saved.');
    } else {
      setFlowError(data.error ?? 'Could not save calendar settings.');
    }
  }

  const entriesNow = pickedEntries();

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-semibold">Calendar</h3>
        {host.calendarConnected ? (
          <span className="rounded-full border border-border px-2.5 py-1 text-xs text-text-secondary">
            Connected
          </span>
        ) : (
          <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium">
            Calendar not connected
          </span>
        )}
      </div>

      {flowError && (
        <p className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">{flowError}</p>
      )}

      {host.calendarConnected ? (
        <form className="space-y-4" onSubmit={saveCalendars}>
          <p className="text-sm text-text-secondary">
            Connected as{' '}
            <span className="text-text-primary">{host.googleConnectionEmail ?? 'your google account'}</span>
            {groups && groups.length > 1 ? (
              <>, with {groups.length} google accounts linked under your redbtn credential</>
            ) : null}
            . Availability is read from every calendar you tick below, across all of your
            linked accounts, and bookings are written to the one calendar you pick as the
            write target.
          </p>
          <div>
            <span className={labelCls}>Calendars that block slots</span>
            {groups === null ? (
              <p className="text-sm text-text-secondary">Loading your calendars...</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-text-secondary">
                {groupsError ?? 'No google accounts came back under your credential.'}
              </p>
            ) : (
              <div className="space-y-4">
                {groups.map((group) => (
                  <div key={group.connectionId}>
                    <p className="mb-1.5 text-sm font-medium">
                      {group.email}
                      {group.isDefault ? (
                        <span className="ml-2 text-xs font-normal text-text-secondary">(default)</span>
                      ) : null}
                    </p>
                    {group.error ? (
                      <p className="text-xs text-text-secondary">{group.error}</p>
                    ) : group.calendars.length === 0 ? (
                      <p className="text-xs text-text-secondary">No calendars on this account.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {group.calendars.map((c) => {
                          const key = pairKey(group.connectionId, c.id);
                          return (
                            <label key={key} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={selected.includes(key)}
                                onChange={(e) => togglePair(key, e.target.checked)}
                              />
                              <span className="truncate">
                                {c.summary}
                                {c.primary ? ' (primary)' : ''}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
                <p className="text-xs text-text-secondary">
                  Busy time on any ticked calendar closes those slots, whichever account
                  the calendar lives on.
                </p>
              </div>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="writeTarget">Bookings are written to</label>
            <select
              id="writeTarget"
              className={inputCls}
              value={writeKey}
              onChange={(e) => setWriteKey(e.target.value)}
            >
              {entriesNow.length === 0 ? (
                <option value="">Tick a calendar first</option>
              ) : (
                entriesNow.map((en) => (
                  <option key={pairKey(en.connectionId, en.calendarId)} value={pairKey(en.connectionId, en.calendarId)}>
                    {en.summary} ({en.email})
                  </option>
                ))
              )}
            </select>
          </div>
          <p className="text-xs text-text-secondary">
            Time zone: {host.timeZone}. Booking windows: weekdays{' '}
            {formatTimeOfDay(host.availabilityWindows.weekday.start)} to{' '}
            {formatTimeOfDay(host.availabilityWindows.weekday.end)}, weekends{' '}
            {formatTimeOfDay(host.availabilityWindows.weekend.start)} to{' '}
            {formatTimeOfDay(host.availabilityWindows.weekend.end)}, 30 minute slots.
            Change them in the Hours card.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]">
              Save calendar
            </button>
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={busy}
              className="rounded-xl border border-border px-5 py-2.5 text-sm text-text-secondary transition hover:text-text-primary disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Until you connect, guests see times from your redMeet bookings only, and new
            bookings are recorded here without a calendar invite. Connect your own google
            calendar so availability and invites run on it:
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-text-secondary">
            <li>
              Link your google account in{' '}
              <a
                href="https://app.redbtn.io/connections"
                target="_blank"
                rel="noreferrer"
                className="text-text-primary underline underline-offset-4"
              >
                redbtn Connections
              </a>
              , if you have not already.
            </li>
            <li>
              Create a personal access token in{' '}
              <a
                href="https://app.redbtn.io/settings"
                target="_blank"
                rel="noreferrer"
                className="text-text-primary underline underline-offset-4"
              >
                redbtn Settings
              </a>{' '}
              (the Tokens panel; full access, or at least the Connections scope).
            </li>
            <li>Paste the token here. redMeet checks it is yours, then lists your google accounts.</li>
          </ol>
          <div>
            <label className={labelCls} htmlFor="pat">Your redbtn personal access token</label>
            <input
              id="pat"
              type="password"
              autoComplete="off"
              className={inputCls}
              placeholder="rpat_..."
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setAccounts(null);
              }}
            />
            <p className="mt-1 text-xs text-text-secondary">
              Stored encrypted on the server, used only to read your availability and write
              your booking events. Revoke it any time in redbtn Settings.
            </p>
          </div>
          {!accounts ? (
            <button
              type="button"
              onClick={() => void validateToken()}
              disabled={busy || token.trim().length < 10}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? 'Checking...' : 'Check token'}
            </button>
          ) : (
            <>
              <div>
                <label className={labelCls} htmlFor="accountPick">Google account to book against</label>
                <select
                  id="accountPick"
                  className={inputCls}
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                >
                  {accounts.map((a) => (
                    <option key={a.connectionId} value={a.connectionId}>
                      {a.email}
                      {a.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-text-secondary">
                  This becomes your default account. After connecting you can tick
                  calendars on every linked account, not just this one.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void connect()}
                disabled={busy || !picked}
                className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? 'Connecting...' : 'Connect this account'}
              </button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Booking hours: the host's own weekday and weekend windows. Guests
 * only ever see slots inside these, in the host's time zone. The
 * defaults are the original app's hours; saving replaces them whole.
 */
function HoursCard({
  host,
  setHost,
  onSaved,
}: {
  host: Host;
  setHost: (h: Host) => void;
  onSaved: (note: string) => void;
}) {
  const [draft, setDraft] = useState<AvailabilityWindows>(host.availabilityWindows);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(host.availabilityWindows);
  }, [host.availabilityWindows]);

  function setDay(day: 'weekday' | 'weekend', edge: 'start' | 'end', value: string) {
    setDraft((d) => ({ ...d, [day]: { ...d[day], [edge]: value } }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const invalid = validateAvailabilityWindows(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v0/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availabilityWindows: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Could not save your hours. Try again.');
        return;
      }
      setHost(data.host);
      onSaved('Booking hours saved.');
    } finally {
      setBusy(false);
    }
  }

  const rows = [
    { day: 'weekday' as const, title: 'Weekdays', sub: 'Monday to Friday' },
    { day: 'weekend' as const, title: 'Weekends', sub: 'Saturday and Sunday' },
  ];

  return (
    <Card>
      <h3 className="mb-4 font-semibold">Booking hours</h3>
      {error && (
        <p className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">{error}</p>
      )}
      <form className="space-y-5" onSubmit={save}>
        <p className="text-sm text-text-secondary">
          Guests can only book inside these hours, in your time zone ({host.timeZone}).
          Times fall on the hour or half hour, and slots are 30 minutes.
        </p>
        {rows.map((row) => (
          <div key={row.day}>
            <p className="text-sm font-medium">{row.title}</p>
            <p className="mb-2 text-xs text-text-secondary">{row.sub}</p>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className={labelCls} htmlFor={`${row.day}Start`}>From</label>
                <input
                  id={`${row.day}Start`}
                  type="time"
                  step={1800}
                  className={inputCls}
                  value={draft[row.day].start}
                  onChange={(e) => setDay(row.day, 'start', e.target.value)}
                  required
                />
              </div>
              <div className="flex-1">
                <label className={labelCls} htmlFor={`${row.day}End`}>To</label>
                <input
                  id={`${row.day}End`}
                  type="time"
                  step={1800}
                  className={inputCls}
                  value={draft[row.day].end}
                  onChange={(e) => setDay(row.day, 'end', e.target.value)}
                  required
                />
              </div>
            </div>
          </div>
        ))}
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? 'Saving...' : 'Save hours'}
        </button>
      </form>
    </Card>
  );
}

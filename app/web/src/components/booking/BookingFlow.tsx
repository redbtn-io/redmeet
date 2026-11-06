'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * The booking flow, ported from the original 2025 redMeet
 * (pages/calendar: Picker, DatePicker, TimePicker, Form, ResultMessage,
 * LoadingPage). Same shape and behaviour, three differences: state
 * instead of URL params, the app's public API instead of the retired
 * api.redbtn.io, and a result message that tells the truth about the
 * calendar write (the original only had success and error).
 */

export interface FlowMeeting {
  link: string;
  name: string;
  description: string;
  length: number;
}

interface DayCell {
  date: string;
  day: number;
  inMonth: boolean;
  disabled: boolean;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildMonth(year: number, month: number): DayCell[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
  const first = new Date(year, month, 1);
  const startOffset = first.getDay(); // Sunday start, as the original header (S M T W T F S)
  const cells: DayCell[] = [];
  const cursor = new Date(year, month, 1 - startOffset);
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + i);
    cells.push({
      date: toDateStr(d),
      day: d.getDate(),
      inMonth: d.getMonth() === month,
      disabled: d < today || d > horizon,
    });
    if (i >= 34 && cells[cells.length - 1]!.date === toDateStr(new Date(year, month + 1, 0))) break;
  }
  // Trim a fully out-of-month trailing week.
  while (cells.length > 35 && cells.slice(35).every((c) => !c.inMonth)) cells.splice(35);
  return cells;
}

export default function BookingFlow({
  slug,
  meeting,
  hostName,
}: {
  slug: string;
  meeting: FlowMeeting;
  hostName: string;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [date, setDate] = useState<string | null>(null);
  const [times, setTimes] = useState<string[]>([]);
  const [time, setTime] = useState<string | null>(null);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const cells = useMemo(() => buildMonth(year, month), [year, month]);

  useEffect(() => {
    if (!date) return;
    let live = true;
    setLoadingTimes(true);
    setTime(null);
    fetch(`/api/public/${slug}/${meeting.link}/availability?date=${date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('availability'))))
      .then((data) => {
        if (!live) return;
        setTimes(data.times ?? []);
        setDegraded(!!data.degraded);
        setCalendarConnected(data.calendarConnected !== false);
      })
      .catch(() => {
        if (live) {
          setTimes([]);
          setDegraded(true);
        }
      })
      .finally(() => live && setLoadingTimes(false));
    return () => {
      live = false;
    };
  }, [date, slug, meeting.link]);

  function switchMonth(direction: number) {
    const next = new Date(year, month + direction, 1);
    const current = new Date();
    if (
      next.getFullYear() < current.getFullYear() ||
      (next.getFullYear() === current.getFullYear() && next.getMonth() < current.getMonth())
    ) {
      return;
    }
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  }

  const prettyDate = date
    ? new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <div className="mx-auto mt-6 flex w-full max-w-5xl flex-col space-y-4 rounded-2xl border border-border bg-bg-secondary md:mt-10">
      <div className="border-b border-border">
        <a
          href={`/${slug}`}
          className="block w-full cursor-pointer px-5 py-4 text-sm font-medium hover:opacity-80"
          style={{ color: 'var(--primary-color)' }}
        >
          ← Back to Meetings
        </a>
      </div>

      <div className="space-y-4 px-2 pb-6 md:flex md:space-x-4 md:space-y-0 md:px-6">
        <div className="mx-auto mt-2 md:w-1/2">
          <div className="rounded-xl border border-border bg-bg p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-text-primary">{meeting.name}</h3>
              <p className="text-xs uppercase text-text-secondary">Eastern Time</p>
            </div>
            <p className="mt-2 text-sm text-text-secondary">
              {meeting.description || `Meet with ${hostName}.`}
            </p>
            <p className="mt-1 text-sm text-text-secondary">{meeting.length} minutes</p>
          </div>
          <br />
          <DatePicker
            year={year}
            month={month}
            cells={cells}
            selected={date}
            onSelect={setDate}
            onMonth={switchMonth}
            loading={loadingTimes}
          />
        </div>

        <div className={`flex pb-6 md:max-h-[648px] ${date ? 'w-full md:w-1/2 md:pl-6' : 'hidden md:block md:w-0'}`}>
          {date && (
            <TimePicker
              slug={slug}
              meeting={meeting}
              date={date}
              prettyDate={prettyDate}
              times={times}
              time={time}
              setTime={setTime}
              loadingTimes={loadingTimes}
              degraded={degraded}
              calendarConnected={calendarConnected}
              setSubmitting={setSubmitting}
              setResult={setResult}
            />
          )}
        </div>
      </div>

      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-white/60" />
            <div className="mt-4 text-lg text-text-primary">Scheduling...</div>
          </div>
        </div>
      )}
      {result && <ResultMessage message={result} onClose={() => setResult(null)} />}
    </div>
  );
}

function DatePicker({
  year,
  month,
  cells,
  selected,
  onSelect,
  onMonth,
  loading,
}: {
  year: number;
  month: number;
  cells: DayCell[];
  selected: string | null;
  onSelect: (date: string) => void;
  onMonth: (direction: number) => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-5 p-2 md:p-0">
      <h2 className="select-none text-xl font-bold text-text-primary">Select a Date &amp; Time</h2>
      <div className="flex items-center justify-between">
        <button onClick={() => onMonth(-1)} className="month-button" aria-label="Previous month">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-3 w-3">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="select-none text-2xl font-medium text-text-primary">
          {new Date(year, month).toLocaleString('default', { month: 'long' })}{' '}
          {year !== new Date().getFullYear() ? year : ''}
        </h3>
        <button onClick={() => onMonth(1)} className="month-button" aria-label="Next month">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-3 w-3">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div className="grid grid-cols-7 gap-2 text-center text-sm font-bold text-text-secondary">
        <div>S</div>
        <div>M</div>
        <div>T</div>
        <div>W</div>
        <div>T</div>
        <div>F</div>
        <div>S</div>
      </div>
      <div className="mb-6 grid grid-cols-7 justify-items-center gap-2 md:mb-0">
        {cells.map((cell) => (
          <button
            key={cell.date}
            className={`aspect-square h-12 p-0 text-center ${
              cell.disabled
                ? 'unavailable-date'
                : selected === cell.date
                  ? 'selected-date'
                  : 'available-date'
            } ${cell.inMonth ? '' : 'off-month-date'}`}
            onClick={() => onSelect(cell.date)}
            disabled={cell.disabled || loading}
          >
            {cell.day}
          </button>
        ))}
      </div>
    </div>
  );
}

function TimePicker({
  slug,
  meeting,
  date,
  prettyDate,
  times,
  time,
  setTime,
  loadingTimes,
  degraded,
  calendarConnected,
  setSubmitting,
  setResult,
}: {
  slug: string;
  meeting: FlowMeeting;
  date: string;
  prettyDate: string;
  times: string[];
  time: string | null;
  setTime: (t: string | null) => void;
  loadingTimes: boolean;
  degraded: boolean;
  calendarConnected: boolean;
  setSubmitting: (b: boolean) => void;
  setResult: (m: string) => void;
}) {
  return (
    <div className="w-full space-y-4 overflow-y-auto p-1" id="time-picker">
      {loadingTimes ? (
        <>
          <p className="text-center text-text-secondary">Loading available times...</p>
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-border border-t-text-primary" />
        </>
      ) : (
        <>
          <h3 className="text-lg font-medium text-text-primary">{prettyDate}</h3>
          {degraded && !calendarConnected && (
            <p className="text-xs text-amber-500">
              The host has not connected a calendar yet, so these times come from redMeet bookings only.
            </p>
          )}
          {degraded && calendarConnected && (
            <p className="text-xs text-amber-500">
              Calendar check is unavailable right now, so these times come from redMeet bookings only.
            </p>
          )}
          {times.length === 0 ? (
            <p className="text-sm text-text-secondary">No times available this day. Try another date.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {times.map((t) => (
                <button
                  key={t}
                  className={`w-full cursor-pointer select-none rounded-lg p-2 transition ${
                    time === t
                      ? 'text-white'
                      : 'border border-border bg-bg text-text-primary hover:border-[var(--primary-color)]'
                  }`}
                  style={time === t ? { backgroundColor: 'var(--primary-color)' } : undefined}
                  onClick={() => setTime(time === t ? null : t)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          <GuestForm
            slug={slug}
            meeting={meeting}
            date={date}
            time={time}
            setSubmitting={setSubmitting}
            setResult={setResult}
          />
        </>
      )}
    </div>
  );
}

function GuestForm({
  slug,
  meeting,
  date,
  time,
  setSubmitting,
  setResult,
}: {
  slug: string;
  meeting: FlowMeeting;
  date: string;
  time: string | null;
  setSubmitting: (b: boolean) => void;
  setResult: (m: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [comments, setComments] = useState<string | false>(false);
  const [error, setError] = useState<string | null>(null);

  function changeNumber(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length > 3) {
      setPhoneNumber(
        `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}${digits.length > 6 ? `-${digits.slice(6, 10)}` : ''}`,
      );
    } else {
      setPhoneNumber(digits);
    }
  }

  async function clickSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.length < 2) {
      setError('Please enter your name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (phoneNumber && phoneNumber.replace(/\D/g, '').length < 10) {
      setError('Please enter a valid phone number, or clear it.');
      return;
    }
    if (!time || !date) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/${slug}/${meeting.link}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          time,
          name,
          email,
          phone: phoneNumber,
          comments: comments === false ? '' : comments,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const pretty = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
      });
      if (res.ok && data.booking?.status === 'confirmed') {
        setResult(`Scheduled for ${time} on ${pretty}`);
        setName('');
        setEmail('');
        setPhoneNumber('');
      } else if (res.ok && data.booking) {
        setResult(
          `Your request is in for ${time} on ${pretty}. The calendar invite hit a snag on our side, so watch your email for confirmation.`,
        );
      } else if (res.status === 409) {
        setResult(`That time was just taken. Pick another time and try again.`);
      } else {
        setError(data.error ?? 'Something went wrong. Try again.');
      }
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const ready = !!time && !!date && !!email && !!name;
  return (
    <form className="space-y-2" onSubmit={clickSubmit}>
      <input
        type="text"
        placeholder="Name"
        className="input-field"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        type="email"
        placeholder="Email"
        className="input-field"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <div className="flex space-x-2">
        <input
          type="tel"
          placeholder="Phone Number"
          className="input-field"
          style={{ flex: 2 }}
          value={phoneNumber}
          onChange={(e) => changeNumber(e.target.value)}
        />
        <button
          className="cursor-pointer rounded-lg border border-border p-2 text-text-primary"
          style={{ flex: 1 }}
          onClick={(e) => {
            e.preventDefault();
            setComments(comments !== false ? false : '');
          }}
        >
          Comments <span style={{ color: 'var(--primary-color)' }}>{comments !== false ? '▲' : '▼'}</span>
        </button>
      </div>
      {comments !== false && (
        <textarea
          placeholder="Comments"
          className="input-field resize-none"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          rows={1}
        />
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        className={`w-full cursor-pointer rounded-lg p-3 font-medium text-white transition hover:brightness-110 ${ready ? '' : 'opacity-50'}`}
        style={{ backgroundColor: 'var(--primary-color)' }}
        disabled={!ready}
        type="submit"
      >
        {time
          ? `Schedule for ${time} on ${new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
          : 'Select a Time'}
      </button>
      <p className="text-sm text-text-secondary">Time zone: Eastern Time, US &amp; Canada</p>
    </form>
  );
}

function ResultMessage({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-secondary p-8 text-center">
        <div className="text-lg text-text-primary">{message}</div>
        <button
          onClick={onClose}
          className="mt-6 cursor-pointer rounded-xl px-5 py-2.5 font-medium text-white transition hover:brightness-110"
          style={{ backgroundColor: 'var(--primary-color)' }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

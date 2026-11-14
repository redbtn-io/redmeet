/**
 * Operations unit tests (Epic 5): the settings resolution,
 * the full room decision, the join failure vocabulary, the
 * meeting log shape, and the token readiness health check.
 *
 * These are pure or near pure: no database, no server. The
 * integration halves (a limit 3 booking filling at 3, custom
 * window numbers on real bookings, the token redaction
 * assertion on a real mint) live in settings.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  JOIN_FAILURE_TYPES,
  isJoinFailureType,
  logJoinFailure,
  logMeetingEvent,
} from '@/lib/join-events';
import { MEETING_SETTING_DEFAULTS, resolveMeetingSettings } from '@/lib/meeting-settings';
import { isRoomFullFor } from '@/lib/rooms';

describe('meeting settings resolution (Epic 5)', () => {
  it('unset everything falls back to the defaults', () => {
    for (const source of [undefined, null, {}, { participantLimit: undefined }]) {
      expect(resolveMeetingSettings(source)).toEqual(MEETING_SETTING_DEFAULTS);
    }
    expect(MEETING_SETTING_DEFAULTS).toEqual({
      participantLimit: 10,
      openLeadMinutes: 5,
      closeLagMinutes: 15,
      extensionMinutes: 30,
      extensionsAllowed: 1,
    });
  });

  it('set values win, field by field, unset fields still default', () => {
    const resolved = resolveMeetingSettings({ participantLimit: 3, closeLagMinutes: 45 });
    expect(resolved.participantLimit).toBe(3);
    expect(resolved.closeLagMinutes).toBe(45);
    expect(resolved.openLeadMinutes).toBe(5);
    expect(resolved.extensionMinutes).toBe(30);
    expect(resolved.extensionsAllowed).toBe(1);
  });

  it('zero is a real answer for the lead, the lag, and the extension count', () => {
    const resolved = resolveMeetingSettings({
      openLeadMinutes: 0,
      closeLagMinutes: 0,
      extensionsAllowed: 0,
    });
    expect(resolved.openLeadMinutes).toBe(0);
    expect(resolved.closeLagMinutes).toBe(0);
    expect(resolved.extensionsAllowed).toBe(0);
  });

  it('a zero or negative participant limit falls back instead of locking the room', () => {
    expect(resolveMeetingSettings({ participantLimit: 0 }).participantLimit).toBe(10);
    expect(resolveMeetingSettings({ participantLimit: -2 }).participantLimit).toBe(10);
  });
});

describe('the full room decision (story 5.1.3)', () => {
  it('is not full below the limit', () => {
    expect(isRoomFullFor(['host-h', 'guest-b'], 'guest-b2', 10)).toBe(false);
    expect(isRoomFullFor([], 'guest-b', 3)).toBe(false);
  });

  it('is full at the limit for a new identity', () => {
    expect(isRoomFullFor(['host-h', 'a', 'b'], 'guest-b', 3)).toBe(true);
  });

  it('is never full for an identity already holding a seat', () => {
    // A dropped participant rejoins with the same link and
    // the same identity: their seat is already counted.
    expect(isRoomFullFor(['host-h', 'guest-b', 'a'], 'guest-b', 3)).toBe(false);
    expect(isRoomFullFor(['host-h', 'guest-b', 'a'], 'host-h', 3)).toBe(false);
  });

  it('counts the host as a seat', () => {
    expect(isRoomFullFor(['host-h'], 'guest-b', 1 + 1)).toBe(false);
    expect(isRoomFullFor(['host-h', 'guest-b'], 'someone-else', 2)).toBe(true);
  });
});

describe('the join failure vocabulary (story 5.1.4)', () => {
  it('names exactly the failure types the story lists', () => {
    expect([...JOIN_FAILURE_TYPES].sort()).toEqual(
      [
        'admission_denied',
        'admission_pending',
        'bad_token',
        'browser_blocked',
        'livekit_unreachable',
        'removed',
        'room_closed',
        'room_full',
        'room_not_open',
      ].sort(),
    );
  });

  it('accepts the vocabulary and rejects everything else', () => {
    for (const type of JOIN_FAILURE_TYPES) expect(isJoinFailureType(type)).toBe(true);
    for (const bad of ['exploded', 'token_expired', '', 'ROOM_FULL', null, undefined, 42, {}]) {
      expect(isJoinFailureType(bad)).toBe(false);
    }
  });
});

describe('the meeting log shape (story 5.1.2)', () => {
  let lines: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lines = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    errorSpy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('an event line carries the consistent fields as one JSON line', () => {
    logMeetingEvent('token_minted', {
      bookingId: 'booking-1',
      room: 'redmeet-booking-1',
      role: 'guest',
      identity: 'guest-booking-1',
    });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.service).toBe('redmeet');
    expect(parsed.level).toBe('info');
    expect(parsed.event).toBe('token_minted');
    expect(parsed.bookingId).toBe('booking-1');
    expect(parsed.room).toBe('redmeet-booking-1');
    expect(parsed.role).toBe('guest');
    expect(parsed.identity).toBe('guest-booking-1');
    expect(typeof parsed.at).toBe('string');
  });

  it('a failure line carries the vocabulary type and the same base shape', () => {
    logJoinFailure('room_full', { bookingId: 'booking-1', room: 'redmeet-booking-1', count: 3, limit: 3 });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.level).toBe('warn');
    expect(parsed.event).toBe('join_failed');
    expect(parsed.type).toBe('room_full');
    expect(parsed.count).toBe(3);
    expect(parsed.limit).toBe(3);
  });

  it('event lines never carry a token shaped field', () => {
    logMeetingEvent('participant_joined', { bookingId: 'booking-1', role: 'host' });
    logJoinFailure('bad_token', { bookingId: 'booking-1' });
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      for (const key of Object.keys(parsed)) {
        expect(key.toLowerCase()).not.toContain('token');
        expect(key.toLowerCase()).not.toContain('secret');
      }
    }
  });
});

describe('token endpoint readiness (story 5.1.1 remainder)', () => {
  it('is ok with a well formed key pair and not configured without one', async () => {
    const config = await import('@/lib/config');
    const health = await import('@/lib/health');
    process.env.LIVEKIT_URL = 'http://127.0.0.1:9';
    process.env.LIVEKIT_API_KEY = 'APIopsTestKey0000';
    process.env.LIVEKIT_API_SECRET = 'ops-test-secret-that-is-long-enough';
    config.resetConfig();
    try {
      const ready = await health.checkTokenReadiness();
      expect(ready.ok).toBe(true);
      expect(ready.detail).toBe('mint and verify ok');

      delete process.env.LIVEKIT_API_SECRET;
      config.resetConfig();
      const missing = await health.checkTokenReadiness();
      expect(missing.ok).toBe(false);
      expect(missing.detail).toBe('not configured');
    } finally {
      config.resetConfig();
    }
  });
});

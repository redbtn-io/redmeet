import { describe, expect, it } from 'vitest';

import {
  colorForIdentity,
  displacedShareNotice,
  gridLayout,
  initialsFor,
  pickFallbackDevice,
  resolveDisplayedShare,
  type ShareRef,
} from './room-ui';

describe('gridLayout', () => {
  it('lays out 1 to 10 tiles in a readable grid', () => {
    expect(gridLayout(1)).toEqual({ columns: 1, rows: 1 });
    expect(gridLayout(2)).toEqual({ columns: 2, rows: 1 });
    expect(gridLayout(3)).toEqual({ columns: 2, rows: 2 });
    expect(gridLayout(4)).toEqual({ columns: 2, rows: 2 });
    expect(gridLayout(5)).toEqual({ columns: 3, rows: 2 });
    expect(gridLayout(6)).toEqual({ columns: 3, rows: 2 });
    expect(gridLayout(9)).toEqual({ columns: 3, rows: 3 });
    expect(gridLayout(10)).toEqual({ columns: 4, rows: 3 });
  });

  it('never returns zero columns or rows', () => {
    expect(gridLayout(0)).toEqual({ columns: 1, rows: 1 });
  });
});

describe('initialsFor', () => {
  it('takes the first and last initial of a full name', () => {
    expect(initialsFor('Smoke Guest')).toBe('SG');
    expect(initialsFor('Epic Three Host')).toBe('EH');
  });

  it('takes two letters of a single word name', () => {
    expect(initialsFor('Host')).toBe('HO');
  });

  it('falls back to a question mark for an empty name', () => {
    expect(initialsFor('')).toBe('?');
    expect(initialsFor('   ')).toBe('?');
  });
});

describe('colorForIdentity', () => {
  it('is stable for the same identity and differs across identities', () => {
    expect(colorForIdentity('guest-abc')).toBe(colorForIdentity('guest-abc'));
    expect(colorForIdentity('guest-abc')).not.toBe(
      colorForIdentity('host-xyz'),
    );
    expect(colorForIdentity('guest-abc')).toMatch(/^hsl\(\d+ 45% 38%\)$/);
  });
});

describe('screen share resolution', () => {
  const share = (
    trackSid: string,
    ownerIdentity: string,
    ownerName: string,
    seq: number,
  ): ShareRef => ({ trackSid, ownerIdentity, ownerName, seq });

  it('shows the most recently started share in the main area', () => {
    const older = share('TR_1', 'guest-1', 'Guest One', 1);
    const newer = share('TR_2', 'host-1', 'Host', 2);
    expect(resolveDisplayedShare([older, newer])?.trackSid).toBe('TR_2');
    expect(resolveDisplayedShare([newer, older])?.trackSid).toBe('TR_2');
  });

  it('falls back to the older share when the newer one ends', () => {
    const older = share('TR_1', 'guest-1', 'Guest One', 1);
    expect(resolveDisplayedShare([older])?.trackSid).toBe('TR_1');
    expect(resolveDisplayedShare([])).toBeNull();
  });

  it('owes a notice to the sharer whose share lost the main area', () => {
    const mine = share('TR_1', 'guest-1', 'Guest One', 1);
    const theirs = share('TR_2', 'host-1', 'Host', 2);
    const displayed = resolveDisplayedShare([mine, theirs]);
    const notice = displacedShareNotice([mine, theirs], displayed, 'guest-1');
    expect(notice).toContain('Host is sharing their screen now');
  });

  it('owes no notice to the one now displayed, or when not sharing', () => {
    const mine = share('TR_1', 'guest-1', 'Guest One', 1);
    const theirs = share('TR_2', 'host-1', 'Host', 2);
    const displayed = resolveDisplayedShare([mine, theirs]);
    expect(displacedShareNotice([mine, theirs], displayed, 'host-1')).toBeNull();
    expect(displacedShareNotice([theirs], displayed, 'guest-9')).toBeNull();
    expect(displacedShareNotice([mine], null, 'guest-1')).toBeNull();
  });
});

describe('pickFallbackDevice', () => {
  const devices = [
    { deviceId: 'mic-a', label: 'Mic A' },
    { deviceId: 'mic-b', label: 'Mic B' },
  ];

  it('returns null while the active device is still present', () => {
    expect(pickFallbackDevice('mic-a', devices)).toBeNull();
  });

  it('falls back to the first remaining device when the active one is gone', () => {
    expect(pickFallbackDevice('mic-gone', devices)?.deviceId).toBe('mic-a');
  });

  it('returns null for the browser default and for empty lists', () => {
    expect(pickFallbackDevice('', devices)).toBeNull();
    expect(pickFallbackDevice('mic-gone', [])).toBeNull();
  });
});

/**
 * LiveKit token shape tests (Epic 1, feature 1.2).
 *
 * Pure unit tests: they mint real LiveKit JWTs with the real
 * livekit-server-sdk and a throwaway key pair, then verify and
 * decode them with the same SDK. No server, no database. The point
 * is the GRANT SHAPE: it must match the Hub voice token route's
 * shape (one room, join + publish + subscribe) with the meeting
 * publish sources (camera, mic, screen share) for both roles, so
 * Epic 7 can adopt this mint for conversation rooms as is.
 */
import { describe, expect, it } from 'vitest';

import { mintRoomToken, verifyRoomToken } from '@/lib/livekit';
import type { LiveKitConfig } from '@/lib/config';

const CONFIG: LiveKitConfig = {
  url: 'https://livekit.example.test',
  apiKey: 'test-key',
  apiSecret: 'test-secret-that-is-long-enough',
};

describe('meeting room tokens', () => {
  it('mints a host token limited to the one room, with camera, mic, and screen share', async () => {
    const minted = await mintRoomToken(CONFIG, {
      room: 'redmeet-abc',
      identity: 'host-123',
      name: 'Host Name',
      role: 'host',
      ttlSeconds: 3600,
    });
    const claims = await verifyRoomToken(CONFIG, minted.token);
    expect(claims.sub).toBe('host-123');
    expect(claims.name).toBe('Host Name');
    expect(claims.video?.room).toBe('redmeet-abc');
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    expect(new Set(claims.video?.canPublishSources)).toEqual(
      new Set(['camera', 'microphone', 'screen_share']),
    );
    // Expiry is the TTL, not a day, not a week.
    expect(claims.exp! - claims.nbf!).toBe(3600);
  });

  it('mints a guest token for the same room with the same publish sources', async () => {
    const minted = await mintRoomToken(CONFIG, {
      room: 'redmeet-abc',
      identity: 'guest-abc',
      name: 'Guest Name',
      role: 'guest',
      ttlSeconds: 900,
    });
    const claims = await verifyRoomToken(CONFIG, minted.token);
    expect(claims.sub).toBe('guest-abc');
    expect(claims.video?.room).toBe('redmeet-abc');
    expect(claims.video?.roomJoin).toBe(true);
    expect(new Set(claims.video?.canPublishSources)).toEqual(
      new Set(['camera', 'microphone', 'screen_share']),
    );
    expect(claims.exp! - claims.nbf!).toBe(900);
  });

  it('rejects a token verified against a different secret', async () => {
    const minted = await mintRoomToken(CONFIG, {
      room: 'redmeet-abc',
      identity: 'guest-abc',
      name: 'Guest Name',
      role: 'guest',
      ttlSeconds: 900,
    });
    await expect(
      verifyRoomToken({ ...CONFIG, apiSecret: 'a-different-secret-altogether' }, minted.token),
    ).rejects.toThrow();
  });
});

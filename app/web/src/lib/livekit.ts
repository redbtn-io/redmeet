import {
  AccessToken,
  EgressClient,
  RoomServiceClient,
  TokenVerifier,
  TrackSource,
} from 'livekit-server-sdk';

import type { LiveKitConfig } from '@/lib/config';

/**
 * LiveKit token minting for meeting rooms (Epic 1).
 *
 * This module is deliberately the SAME SHAPE as the Hub's voice
 * token route (redbtn-webapp, POST /api/conversations/:id/voice/token):
 * an AccessToken with identity + display name, a grant limited to
 * one room with roomJoin + canPublish + canSubscribe, minted server
 * side from LIVEKIT_API_KEY / LIVEKIT_API_SECRET, returned to the
 * caller as a JWT. It takes its config as an argument and reads no
 * env and no request state, so the Hub can adopt this exact mint
 * (and its grant shape) for conversation voice rooms in Epic 7
 * without a second dialect of LiveKit token existing in the fleet.
 *
 * The one deliberate difference from the Hub voice grant: publish
 * sources. Voice rooms are mic only by design ("voice room v1").
 * Meeting rooms publish camera, microphone, and screen share, for
 * BOTH roles: spec decision 10, host and guest can both share, with
 * the host able to stop someone else's share (an Epic 4 control,
 * enforced in the room, not by withholding the grant here).
 */

export type RoomRole = 'host' | 'guest';

/** Publish sources for a meeting room token, either role. */
export const MEETING_PUBLISH_SOURCES: TrackSource[] = [
  TrackSource.CAMERA,
  TrackSource.MICROPHONE,
  TrackSource.SCREEN_SHARE,
];

export interface MintRoomTokenInput {
  /** The one room this token may join. */
  room: string;
  /** LiveKit participant identity. Stable per person per booking. */
  identity: string;
  /** Display name shown on the participant's tile. */
  name: string;
  role: RoomRole;
  /** Token lifetime in seconds. Callers cap this at the room window. */
  ttlSeconds: number;
}

export interface MintedRoomToken {
  token: string;
  room: string;
  identity: string;
  displayName: string;
  role: RoomRole;
  /** Unix seconds when the token expires. */
  expiresAt: number;
}

/**
 * Mint a meeting room token. The grant is limited to `input.room`,
 * join + publish + subscribe, with the meeting publish sources.
 * Host and guest tokens for the same booking carry the same sources
 * by George's ruling; the roles differ in identity and in who may
 * ask for them (session for the host, join token for the guest),
 * which the calling routes enforce.
 */
export async function mintRoomToken(
  config: LiveKitConfig,
  input: MintRoomTokenInput,
): Promise<MintedRoomToken> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: input.identity,
    name: input.name,
    ttl: input.ttlSeconds,
  });
  token.addGrant({
    room: input.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishSources: [...MEETING_PUBLISH_SOURCES],
  });
  const jwt = await token.toJwt();
  return {
    token: jwt,
    room: input.room,
    identity: input.identity,
    displayName: input.name,
    role: input.role,
    expiresAt: Math.floor(Date.now() / 1000) + input.ttlSeconds,
  };
}

/**
 * Verify and decode a token this service minted. Used by the tests
 * to prove grant shape, and available to any future route that
 * needs to check a presented token instead of re-minting.
 */
export async function verifyRoomToken(config: LiveKitConfig, jwt: string) {
  const verifier = new TokenVerifier(config.apiKey, config.apiSecret);
  return verifier.verify(jwt);
}

/** The server API client (room create/delete), as opposed to tokens. */
export function roomService(config: LiveKitConfig): RoomServiceClient {
  return new RoomServiceClient(config.url, config.apiKey, config.apiSecret);
}

/**
 * The Egress client (Epic 6), the same construction redCast's
 * fanout adapter uses: the deployment's LiveKit URL and key
 * pair, a short request timeout. Recording lives in
 * lib/recording.ts; this is only the client factory, kept
 * beside roomService so every LiveKit client in the app is
 * built in one place.
 */
export function egressService(config: LiveKitConfig): EgressClient {
  return new EgressClient(config.url, config.apiKey, config.apiSecret, {
    requestTimeout: 10_000,
  });
}

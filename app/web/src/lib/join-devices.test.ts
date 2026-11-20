/**
 * Join device tests (the Nov 20, 2026 iOS join fix).
 *
 * The incident: a guest on iPhone Chrome connected to the
 * room four times in twenty seconds and was torn down every
 * time a fraction of a second later, because turning the
 * mic on threw after the connect had already succeeded and
 * the throw reached the join catch-all, which disconnected
 * the room and reported livekit_unreachable.
 *
 * These tests pin the new contract at the level the join
 * itself uses it: the post-connect device setup runs through
 * enableJoinDevice, which never throws, so a device failure
 * is recorded and shown, and the participant stays joined.
 * The simulated setup below mirrors the lobby's post-connect
 * sequence step for step.
 */
import { describe, expect, it } from 'vitest';

import { isJoinFailureType } from './join-events';
import {
  deviceFailureDetail,
  deviceFailureNotice,
  enableJoinDevice,
  errorNameOf,
  failureTypeForUncodedThrow,
  type DeviceFailure,
  type JoinDevice,
} from './join-devices';

class FakeParticipant {
  micOn = false;
  camOn = false;

  constructor(private fail: Partial<Record<JoinDevice, unknown>>) {}

  async setMicrophoneEnabled(enabled: boolean) {
    if (this.fail.mic !== undefined) throw this.fail.mic;
    this.micOn = enabled;
  }

  async setCameraEnabled(enabled: boolean) {
    if (this.fail.camera !== undefined) throw this.fail.camera;
    this.camOn = enabled;
  }
}

/**
 * The lobby's post-connect sequence, mirrored: connect has
 * already resolved, then each wished-for device is enabled
 * through the helper, failures are collected, and the
 * notice is composed. Reaching the end IS being in the
 * room.
 */
async function joinWithDevices(
  participant: FakeParticipant,
  wishes = { mic: true, cam: true },
) {
  const failures: DeviceFailure[] = [];
  if (wishes.mic) {
    const failure = await enableJoinDevice(participant, 'mic');
    if (failure) failures.push(failure);
  }
  if (wishes.cam) {
    const failure = await enableJoinDevice(participant, 'camera');
    if (failure) failures.push(failure);
  }
  return { joined: true, failures, notice: deviceFailureNotice(failures) };
}

describe('post-connect device enables (Nov 20, 2026 fix)', () => {
  it('a mic that will not turn on still joins, camera on, mic named in the notice', async () => {
    const participant = new FakeParticipant({
      mic: new DOMException('denied', 'NotAllowedError'),
    });
    const result = await joinWithDevices(participant);
    expect(result.joined).toBe(true);
    expect(participant.camOn).toBe(true);
    expect(participant.micOn).toBe(false);
    expect(result.failures).toEqual([{ device: 'mic', errorName: 'NotAllowedError' }]);
    expect(result.notice).toContain('microphone');
    expect(result.notice).toContain('mic button');
  });

  it('a camera that will not turn on still joins, mic on, camera named in the notice', async () => {
    const participant = new FakeParticipant({
      camera: new DOMException('busy', 'NotReadableError'),
    });
    const result = await joinWithDevices(participant);
    expect(result.joined).toBe(true);
    expect(participant.micOn).toBe(true);
    expect(participant.camOn).toBe(false);
    expect(result.failures).toEqual([{ device: 'camera', errorName: 'NotReadableError' }]);
    expect(result.notice).toContain('camera');
    expect(result.notice).toContain('camera button');
  });

  it('both devices failing still joins, with one notice covering both', async () => {
    const participant = new FakeParticipant({
      mic: new DOMException('denied', 'NotAllowedError'),
      camera: new DOMException('denied', 'NotAllowedError'),
    });
    const result = await joinWithDevices(participant);
    expect(result.joined).toBe(true);
    expect(result.failures).toHaveLength(2);
    expect(result.notice).toContain('microphone and camera');
    expect(result.notice).toContain('both off');
  });

  it('devices that turn on join clean, no failures, no notice', async () => {
    const participant = new FakeParticipant({});
    const result = await joinWithDevices(participant);
    expect(result.joined).toBe(true);
    expect(participant.micOn).toBe(true);
    expect(participant.camOn).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.notice).toBeNull();
  });

  it('a device nobody asked for is never enabled and never fails', async () => {
    const participant = new FakeParticipant({
      camera: new DOMException('denied', 'NotAllowedError'),
    });
    const result = await joinWithDevices(participant, { mic: true, cam: false });
    expect(result.joined).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.notice).toBeNull();
  });
});

describe('the failure vocabulary for device and post-connect failures', () => {
  it('device failures report as device_enable_failed, never livekit_unreachable', () => {
    const failure: DeviceFailure = { device: 'mic', errorName: 'NotAllowedError' };
    expect(deviceFailureDetail(failure)).toBe('mic:NotAllowedError');
    expect(deviceFailureDetail({ device: 'camera', errorName: 'NotReadableError' })).toBe(
      'camera:NotReadableError',
    );
    expect(isJoinFailureType('device_enable_failed')).toBe(true);
    expect(isJoinFailureType('post_connect_failed')).toBe(true);
  });

  it('an uncoded throw is livekit_unreachable only before connect resolves', () => {
    expect(failureTypeForUncodedThrow('mint')).toBe('livekit_unreachable');
    expect(failureTypeForUncodedThrow('connect')).toBe('livekit_unreachable');
    expect(failureTypeForUncodedThrow('setup')).toBe('post_connect_failed');
  });
});

describe('errorNameOf', () => {
  it('keeps a plain error name and drops everything else about the error', () => {
    expect(errorNameOf(new DOMException('user said no, device 1234', 'NotAllowedError'))).toBe(
      'NotAllowedError',
    );
    expect(errorNameOf(new Error('prose that must never be logged'))).toBe('Error');
  });

  it('falls back to UnknownError for non-errors and unsafe names', () => {
    expect(errorNameOf('a thrown string')).toBe('UnknownError');
    expect(errorNameOf(null)).toBe('UnknownError');
    expect(errorNameOf(undefined)).toBe('UnknownError');
    expect(errorNameOf({ name: 'not an identifier; DROP TABLE' })).toBe('UnknownError');
    expect(errorNameOf({ name: 42 })).toBe('UnknownError');
  });
});

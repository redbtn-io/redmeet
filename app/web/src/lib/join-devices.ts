/**
 * Post-connect device enables for the join flow (the fix for
 * the Nov 20, 2026 join failure).
 *
 * The story: a guest on iPhone Chrome connected to the room
 * four times in twenty seconds, and every time the join tore
 * itself down a fraction of a second later. The connect had
 * SUCCEEDED; what threw was the next step, turning the mic
 * or the camera on. On iOS WebKit that call can lose the
 * user gesture context across the awaited mint and connect,
 * or hit a permission or device error, and the old join code
 * let the throw reach the join catch-all, which disconnected
 * the room and blamed the meeting infrastructure.
 *
 * The rule now: once room.connect() resolves, the join has
 * happened. Turning a device on is attempted here, one
 * device at a time, and a failure is a fact to report and
 * to show the person, never a reason to leave a room they
 * are already in. They join with that device off, and the
 * room's own mic and camera buttons are the retry.
 *
 * Only the error's NAME ever leaves this module (it rides
 * the join-events report): never the error object and never
 * its message, which can carry browser prose and device
 * labels.
 */

export type JoinDevice = 'mic' | 'camera';

export interface DeviceFailure {
  device: JoinDevice;
  /** The thrown error's name, e.g. NotAllowedError. Nothing else about it. */
  errorName: string;
}

/** The slice of LiveKit's LocalParticipant the join uses. */
export interface DeviceEnableTarget {
  setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  setCameraEnabled(enabled: boolean): Promise<unknown>;
}

const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * The error's name and nothing else. A name that is not a
 * plain identifier (or no name at all) becomes UnknownError,
 * so browser prose can never ride into a log line or a
 * report body through this field.
 */
export function errorNameOf(error: unknown): string {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && SAFE_ERROR_NAME.test(name) ? name : 'UnknownError';
}

/**
 * Turn one device on. Never throws: the answer is null when
 * the device came on, or the failure to report and show.
 */
export async function enableJoinDevice(
  target: DeviceEnableTarget,
  device: JoinDevice,
): Promise<DeviceFailure | null> {
  try {
    if (device === 'mic') await target.setMicrophoneEnabled(true);
    else await target.setCameraEnabled(true);
    return null;
  } catch (error) {
    return { device, errorName: errorNameOf(error) };
  }
}

/**
 * The join-events detail for a device failure: the device
 * and the error name, e.g. mic:NotAllowedError. The endpoint
 * accepts exactly this shape and nothing looser.
 */
export function deviceFailureDetail(failure: DeviceFailure): string {
  return `${failure.device}:${failure.errorName}`;
}

/**
 * The in-room notice for the devices that would not turn
 * on, or null when everything came on. Plain words, the
 * device named, the likely fix named. The room shows it
 * once as a toast; the mic and camera buttons are the
 * retry.
 */
export function deviceFailureNotice(failures: readonly DeviceFailure[]): string | null {
  if (!failures.length) return null;
  const mic = failures.some((f) => f.device === 'mic');
  const camera = failures.some((f) => f.device === 'camera');
  if (mic && camera) {
    return "Your microphone and camera could not be turned on, so you are in the meeting with both off. The browser may have blocked them: check this site's camera and microphone permissions in your browser, then turn them on with the mic and camera buttons.";
  }
  if (mic) {
    return "Your microphone could not be turned on, so you are in the meeting with your mic off. The browser may have blocked it: check this site's microphone permission in your browser, then turn it on with the mic button.";
  }
  return "Your camera could not be turned on, so you are in the meeting with your camera off. The browser may have blocked it: check this site's camera permission in your browser, then turn it on with the camera button.";
}

/**
 * Which step of the join was running when an uncoded throw
 * reached the lobby's catch. The failure type is read off
 * the phase: a throw before connect resolves is the media
 * server being unreachable; a throw after it is not, and
 * must never be logged as if it were.
 */
export type JoinPhase = 'mint' | 'connect' | 'setup';

export function failureTypeForUncodedThrow(
  phase: JoinPhase,
): 'livekit_unreachable' | 'post_connect_failed' {
  return phase === 'setup' ? 'post_connect_failed' : 'livekit_unreachable';
}

/**
 * Background blur for the lobby preview and the room camera.
 *
 * The effect is LiveKit's track processor (@livekit/track-processors),
 * which runs MediaPipe's selfie segmenter in the browser and composites
 * a blurred background on WebGL. Two rules:
 *
 *  - **Self hosted assets.** The wasm and the model are served from
 *    /mediapipe/ (see scripts/copy-mediapipe.mjs), never from the
 *    library's CDN defaults: the CSP forbids those origins and a meeting
 *    app should not hand its participants' IPs to third parties.
 *  - **Lazy.** The processor library is imported on first use, so a
 *    participant who never turns blur on never downloads it.
 *
 * The preference lives in this browser only (localStorage), like the
 * remembered devices, and fails soft: storage refusing just forgets.
 */
import type { LocalVideoTrack } from 'livekit-client';

const STORAGE_KEY = 'redmeet.blur.v1';

/** Blur strength. Strong enough to hide a room, soft enough to look natural. */
export const BLUR_RADIUS = 14;

export const BLUR_ASSET_PATHS = {
  tasksVisionFileSet: '/mediapipe/wasm',
  modelAssetPath: '/mediapipe/selfie_segmenter.tflite',
} as const;

export function parseBlurPreference(raw: string | null): boolean {
  return raw === '1';
}

export function serializeBlurPreference(on: boolean): string {
  return on ? '1' : '0';
}

export function loadBlurPreference(): boolean {
  try {
    return parseBlurPreference(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export function saveBlurPreference(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeBlurPreference(on));
  } catch {
    // A browser that refuses storage just forgets.
  }
}

let supportCache: Promise<boolean> | null = null;

/**
 * Whether this browser can run the blur at all (WebGL2, OffscreenCanvas,
 * VideoFrame). Resolved once; false on the server and on old browsers,
 * which simply never see the toggle.
 */
export function blurSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  supportCache ??= import('@livekit/track-processors')
    .then((m) => m.supportsBackgroundProcessors())
    .catch(() => false);
  return supportCache;
}

const BLUR_PROCESSOR_NAME = 'redmeet-background-blur';

/** True when the track already carries our blur. */
export function hasBlur(track: LocalVideoTrack): boolean {
  return track.getProcessor()?.name === BLUR_PROCESSOR_NAME;
}

/**
 * A fresh blur processor. Hand it to `setCameraEnabled(true, { processor })`
 * so the camera is blurred from its very first published frame, or to
 * `track.setProcessor` for a track that already exists.
 */
export async function createBlurProcessor() {
  const { BackgroundProcessor } = await import('@livekit/track-processors');
  return BackgroundProcessor(
    { mode: 'background-blur', blurRadius: BLUR_RADIUS, assetPaths: BLUR_ASSET_PATHS },
    BLUR_PROCESSOR_NAME,
  );
}

/**
 * Turn the blur on or off for one local camera track. Idempotent: asking
 * for the state the track is already in does nothing, so callers can
 * re-assert it after every republish or device switch.
 */
export async function applyBlur(track: LocalVideoTrack, on: boolean): Promise<void> {
  if (on) {
    if (hasBlur(track)) return;
    await track.setProcessor(await createBlurProcessor());
    return;
  }
  if (track.getProcessor()) await track.stopProcessor();
}

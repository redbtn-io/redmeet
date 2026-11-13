/**
 * Remembered meeting devices (Epic 3, story 3.3.3): the lobby
 * and the in room pickers share one localStorage record, so
 * the next meeting starts with the mic, camera, and speaker
 * the participant last picked. Browser only, and it fails
 * soft everywhere: a browser that refuses storage just
 * forgets, it never blocks a join.
 */

export interface DeviceMemory {
  micId: string;
  camId: string;
  speakerId: string;
}

export const EMPTY_DEVICE_MEMORY: DeviceMemory = {
  micId: '',
  camId: '',
  speakerId: '',
};

const STORAGE_KEY = 'redmeet.devices.v1';

export function parseDeviceMemory(raw: string | null): DeviceMemory {
  if (!raw) return { ...EMPTY_DEVICE_MEMORY };
  try {
    const parsed = JSON.parse(raw) as Partial<
      Record<keyof DeviceMemory, unknown>
    >;
    return {
      micId: typeof parsed.micId === 'string' ? parsed.micId : '',
      camId: typeof parsed.camId === 'string' ? parsed.camId : '',
      speakerId: typeof parsed.speakerId === 'string' ? parsed.speakerId : '',
    };
  } catch {
    return { ...EMPTY_DEVICE_MEMORY };
  }
}

export function serializeDeviceMemory(memory: DeviceMemory): string {
  return JSON.stringify({
    micId: memory.micId || '',
    camId: memory.camId || '',
    speakerId: memory.speakerId || '',
  });
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadDeviceMemory(
  storage: Storage | null = defaultStorage(),
): DeviceMemory {
  if (!storage) return { ...EMPTY_DEVICE_MEMORY };
  try {
    return parseDeviceMemory(storage.getItem(STORAGE_KEY));
  } catch {
    return { ...EMPTY_DEVICE_MEMORY };
  }
}

export function saveDeviceMemory(
  memory: DeviceMemory,
  storage: Storage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, serializeDeviceMemory(memory));
  } catch {
    // Storage refused; the meeting goes on, the choice is
    // simply not remembered.
  }
}

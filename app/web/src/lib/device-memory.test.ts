import { describe, expect, it } from 'vitest';

import {
  EMPTY_DEVICE_MEMORY,
  loadDeviceMemory,
  parseDeviceMemory,
  saveDeviceMemory,
  serializeDeviceMemory,
} from './device-memory';

class FakeStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe('device memory', () => {
  it('round trips through serialize and parse', () => {
    const memory = { micId: 'mic-1', camId: 'cam-2', speakerId: 'spk-3' };
    expect(parseDeviceMemory(serializeDeviceMemory(memory))).toEqual(memory);
  });

  it('treats missing and corrupt values as empty', () => {
    expect(parseDeviceMemory(null)).toEqual(EMPTY_DEVICE_MEMORY);
    expect(parseDeviceMemory('not json')).toEqual(EMPTY_DEVICE_MEMORY);
    expect(parseDeviceMemory('{"micId":42}')).toEqual(EMPTY_DEVICE_MEMORY);
  });

  it('keeps only string fields from a partial record', () => {
    expect(parseDeviceMemory('{"camId":"cam-9"}')).toEqual({
      micId: '',
      camId: 'cam-9',
      speakerId: '',
    });
  });

  it('saves and loads through storage', () => {
    const storage = new FakeStorage();
    saveDeviceMemory({ micId: 'm', camId: 'c', speakerId: 's' }, storage);
    expect(loadDeviceMemory(storage)).toEqual({
      micId: 'm',
      camId: 'c',
      speakerId: 's',
    });
  });

  it('fails soft with no storage at all', () => {
    expect(loadDeviceMemory(null)).toEqual(EMPTY_DEVICE_MEMORY);
    expect(() =>
      saveDeviceMemory({ micId: 'm', camId: '', speakerId: '' }, null),
    ).not.toThrow();
  });
});

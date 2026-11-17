import { describe, expect, it } from 'vitest';

import {
  BLUR_ASSET_PATHS,
  blurSupported,
  parseBlurPreference,
  serializeBlurPreference,
} from './background-blur';

describe('blur preference', () => {
  it('round trips on and off', () => {
    expect(parseBlurPreference(serializeBlurPreference(true))).toBe(true);
    expect(parseBlurPreference(serializeBlurPreference(false))).toBe(false);
  });

  it('defaults to off for anything it does not recognise', () => {
    expect(parseBlurPreference(null)).toBe(false);
    expect(parseBlurPreference('')).toBe(false);
    expect(parseBlurPreference('true')).toBe(false);
  });
});

describe('blur assets', () => {
  it('are self hosted, never a third party CDN', () => {
    expect(BLUR_ASSET_PATHS.tasksVisionFileSet.startsWith('/mediapipe/')).toBe(true);
    expect(BLUR_ASSET_PATHS.modelAssetPath.startsWith('/mediapipe/')).toBe(true);
  });
});

describe('blurSupported', () => {
  it('is false on the server', async () => {
    expect(await blurSupported()).toBe(false);
  });
});

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  autoNutritionTargetsEnabled,
  photoAiEnabled,
  textAiEnabled,
} from './nutritionFeatureFlags';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('autoNutritionTargetsEnabled', () => {
  test('only accepts the exact string true', () => {
    vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
    expect(autoNutritionTargetsEnabled()).toBe(true);
  });

  test.each(['TRUE', 'True', '1', ' true ', 'false', ''])(
    'fails closed for %j',
    (value) => {
      vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', value);
      expect(autoNutritionTargetsEnabled()).toBe(false);
    },
  );

  test('fails closed when the flag is absent', () => {
    vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', undefined);
    expect(autoNutritionTargetsEnabled()).toBe(false);
  });
});

describe('photoAiEnabled', () => {
  test('only accepts the exact string true', () => {
    vi.stubEnv('VITE_ENABLE_PHOTO_AI', 'true');
    expect(photoAiEnabled()).toBe(true);
  });

  test.each(['TRUE', 'True', '1', ' true ', 'false', ''])(
    'fails closed for %j',
    (value) => {
      vi.stubEnv('VITE_ENABLE_PHOTO_AI', value);
      expect(photoAiEnabled()).toBe(false);
    },
  );

  test('fails closed when the flag is absent', () => {
    vi.stubEnv('VITE_ENABLE_PHOTO_AI', undefined);
    expect(photoAiEnabled()).toBe(false);
  });
});

describe('textAiEnabled', () => {
  test('only accepts the exact string true', () => {
    vi.stubEnv('VITE_ENABLE_TEXT_AI', 'true');
    expect(textAiEnabled()).toBe(true);
  });

  test.each(['TRUE', 'True', '1', ' true ', 'false', ''])(
    'fails closed for %j',
    (value) => {
      vi.stubEnv('VITE_ENABLE_TEXT_AI', value);
      expect(textAiEnabled()).toBe(false);
    },
  );

  test('fails closed when the flag is absent without changing the photo flag', () => {
    vi.stubEnv('VITE_ENABLE_PHOTO_AI', 'true');
    vi.stubEnv('VITE_ENABLE_TEXT_AI', undefined);
    expect(textAiEnabled()).toBe(false);
    expect(photoAiEnabled()).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PHOTO_AI_LIMITS } from './photoAiContract';
import {
  PHOTO_AI_LOGIN_PATH,
  clearPhotoAiIntent,
  savePhotoAiIntent,
  takePhotoAiIntent,
} from './photoAiIntent';

const NOW = Date.UTC(2026, 7, 19, 4, 0, 0);

function onlyStorageKey(): string {
  expect(sessionStorage.length).toBe(1);
  const key = sessionStorage.key(0);
  expect(key).not.toBeNull();
  return key!;
}

function writeRaw(value: unknown): void {
  sessionStorage.setItem(onlyStorageKey(), JSON.stringify(value));
}

describe('photo AI login intent', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  test('uses a fixed same-origin login path', () => {
    expect(PHOTO_AI_LOGIN_PATH).toBe('/api/nutrition/photo/session?resume=1');
    expect(PHOTO_AI_LOGIN_PATH.startsWith('/api/nutrition/photo/')).toBe(true);
  });

  test('saves the exact bounded intent and consumes it once', () => {
    savePhotoAiIntent('2026-08-19', 'lunch', NOW);

    expect(takePhotoAiIntent(NOW + 1)).toEqual({
      version: 1,
      date: '2026-08-19',
      slot: 'lunch',
      createdAt: NOW,
      expiresAt: NOW + PHOTO_AI_LIMITS.intentMs,
    });
    expect(takePhotoAiIntent(NOW + 2)).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  test.each([
    ['2026-02-30', 'lunch'],
    ['2026-8-19', 'lunch'],
    ['https://evil.example/return', 'lunch'],
    ['2026-08-19', 'brunch'],
  ])('rejects invalid save input %j / %j', (date, slot) => {
    expect(() => savePhotoAiIntent(date, slot as never, NOW)).toThrow(TypeError);
    expect(sessionStorage.length).toBe(0);
  });

  test.each([
    { version: 2 },
    { returnUrl: 'https://evil.example/return' },
    { date: '2026-02-30' },
    { slot: 'brunch' },
    { createdAt: -1 },
    { createdAt: 1.5 },
    { createdAt: Number.MAX_SAFE_INTEGER + 1 },
    { expiresAt: NOW + PHOTO_AI_LIMITS.intentMs + 1 },
  ])('rejects and clears malformed persisted fields: %j', (override) => {
    savePhotoAiIntent('2026-08-19', 'dinner', NOW);
    writeRaw({
      version: 1,
      date: '2026-08-19',
      slot: 'dinner',
      createdAt: NOW,
      expiresAt: NOW + PHOTO_AI_LIMITS.intentMs,
      ...override,
    });

    expect(takePhotoAiIntent(NOW + 1)).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  test.each([
    ['future', NOW - 1],
    ['expired', NOW + PHOTO_AI_LIMITS.intentMs],
  ])('rejects and clears a %s intent', (_label, readAt) => {
    savePhotoAiIntent('2026-08-19', 'snack', NOW);
    expect(takePhotoAiIntent(readAt)).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  test('rejects corrupted JSON and clears it', () => {
    savePhotoAiIntent('2026-08-19', 'breakfast', NOW);
    sessionStorage.setItem(onlyStorageKey(), '{not-json');
    expect(takePhotoAiIntent(NOW + 1)).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  test('fails closed when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => savePhotoAiIntent('2026-08-19', 'lunch', NOW)).toThrow(TypeError);
    vi.restoreAllMocks();
    clearPhotoAiIntent();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(takePhotoAiIntent(NOW)).toBeUndefined();
    vi.restoreAllMocks();

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(clearPhotoAiIntent).not.toThrow();
  });

  test('does not leave an older intent replayable when a replacement write fails', () => {
    savePhotoAiIntent('2026-08-18', 'breakfast', NOW - 1);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(() => savePhotoAiIntent('2026-08-19', 'lunch', NOW)).toThrow(TypeError);
    vi.restoreAllMocks();

    expect(sessionStorage.length).toBe(0);
    expect(takePhotoAiIntent(NOW + 1)).toBeUndefined();
  });

  test('poisons an intent when remove fails so it cannot be replayed later', () => {
    savePhotoAiIntent('2026-08-19', 'dinner', NOW);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
      throw new DOMException('busy', 'InvalidStateError');
    });

    expect(takePhotoAiIntent(NOW + 1)).toBeUndefined();
    vi.restoreAllMocks();

    expect(takePhotoAiIntent(NOW + 2)).toBeUndefined();
  });

  test('rejects saving when the sessionStorage accessor itself is unavailable', () => {
    vi.spyOn(globalThis, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(() => savePhotoAiIntent('2026-08-19', 'lunch', NOW)).toThrow(TypeError);
  });
});

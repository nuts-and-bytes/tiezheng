import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TEXT_AI_LIMITS } from './textAiContract';
import {
  TEXT_AI_LOGIN_PATH,
  clearTextAiIntent,
  saveTextAiIntent,
  takeTextAiIntent,
  type TextAiIntentDraft,
} from './textAiIntent';

const NOW = Date.parse('2026-08-21T00:00:00.000Z');
const STORAGE_KEY = 'tiezheng:text-ai-intent:v1';

function draft(overrides: Partial<TextAiIntentDraft> = {}): TextAiIntentDraft {
  return {
    date: '2026-08-21',
    slot: 'dinner',
    description: '牛肉面一碗，少油',
    amount: { value: 500, unit: 'g' },
    ...overrides,
  };
}

function writeRaw(value: unknown): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('text AI login intent', () => {
  test('uses fixed same-origin path and storage key', () => {
    expect(TEXT_AI_LOGIN_PATH).toBe('/api/nutrition/text/session?resume=1');
    saveTextAiIntent(draft(), NOW);
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.key(0)).toBe(STORAGE_KEY);
  });

  test('saves the exact normalized draft for exactly 15 minutes and consumes it once', () => {
    saveTextAiIntent(draft({ description: '  Cafe\u0301 牛肉面  ' }), NOW);

    expect(takeTextAiIntent(NOW + 1)).toEqual({
      version: 1,
      date: '2026-08-21',
      slot: 'dinner',
      description: 'Café 牛肉面',
      amount: { value: 500, unit: 'g' },
      createdAt: NOW,
      expiresAt: NOW + TEXT_AI_LIMITS.intentMs,
    });
    expect(takeTextAiIntent(NOW + 2)).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  test('preserves a missing optional amount as null', () => {
    saveTextAiIntent(draft({ amount: null }), NOW);
    expect(takeTextAiIntent(NOW + 1)?.amount).toBeNull();
  });

  test.each([
    draft({ date: '2026-02-30' }),
    draft({ date: '2026-8-21' }),
    draft({ slot: 'brunch' as never }),
    draft({ description: '   ' }),
    draft({ description: '面'.repeat(501) }),
    draft({ description: '面\u0000条' }),
    draft({ amount: { value: 0, unit: 'g' } }),
    draft({ amount: { value: Number.POSITIVE_INFINITY, unit: 'g' } }),
    Object.assign(Object.create({ inherited: true }), draft()),
    Object.assign(draft(), { extra: true }),
  ])('rejects invalid save input without persisting it %#', (value) => {
    expect(() => saveTextAiIntent(value as TextAiIntentDraft, NOW)).toThrow(
      'Invalid text AI intent',
    );
    expect(sessionStorage.length).toBe(0);
  });

  test('does not execute a save-input getter', () => {
    const getter = vi.fn(() => '牛肉面');
    const value = Object.defineProperty({}, 'description', {
      enumerable: true,
      get: getter,
    });

    expect(() => saveTextAiIntent(value as TextAiIntentDraft, NOW)).toThrow(
      'Invalid text AI intent',
    );
    expect(getter).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER])(
    'rejects an invalid save time %s',
    (now) => {
      expect(() => saveTextAiIntent(draft(), now)).toThrow(TypeError);
      expect(sessionStorage.length).toBe(0);
    },
  );

  test.each([
    ['unknown key', { extra: true }],
    ['wrong version', { version: 2 }],
    ['invalid date', { date: '2026-02-30' }],
    ['invalid slot', { slot: 'brunch' }],
    ['non-canonical description', { description: ' 牛肉面一碗，少油' }],
    ['empty description', { description: '' }],
    ['missing amount', { amount: undefined }],
    ['invalid amount', { amount: { value: 0, unit: 'g' } }],
    ['amount extra key', { amount: { value: 500, unit: 'g', extra: true } }],
    ['negative createdAt', { createdAt: -1 }],
    ['fractional createdAt', { createdAt: 1.5 }],
    ['tampered expiry', { expiresAt: NOW + TEXT_AI_LIMITS.intentMs + 1 }],
  ])('fails closed and clears a persisted intent with %s', (_label, override) => {
    const value: Record<string, unknown> = {
      version: 1,
      ...draft(),
      createdAt: NOW,
      expiresAt: NOW + TEXT_AI_LIMITS.intentMs,
      ...override,
    };
    if ('amount' in override && override.amount === undefined) {
      delete value.amount;
    }
    writeRaw(value);

    expect(takeTextAiIntent(NOW + 1)).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  test.each([
    ['future', NOW - 1],
    ['expired', NOW + TEXT_AI_LIMITS.intentMs],
  ])('rejects and clears a %s intent', (_label, readAt) => {
    saveTextAiIntent(draft(), NOW);
    expect(takeTextAiIntent(readAt)).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  test('removes the stored value before parsing it', () => {
    saveTextAiIntent(draft(), NOW);
    const parse = JSON.parse.bind(JSON);
    vi.spyOn(JSON, 'parse').mockImplementation((raw) => {
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      return parse(raw);
    });

    expect(takeTextAiIntent(NOW + 1)?.description).toBe('牛肉面一碗，少油');
    expect(JSON.parse).toHaveBeenCalledOnce();
  });

  test('clears corrupt JSON', () => {
    sessionStorage.setItem(STORAGE_KEY, '{not-json');
    expect(takeTextAiIntent(NOW + 1)).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  test('fails closed when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => saveTextAiIntent(draft(), NOW)).toThrow(TypeError);
    vi.restoreAllMocks();

    saveTextAiIntent(draft(), NOW);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
      throw new DOMException('busy', 'InvalidStateError');
    });
    expect(takeTextAiIntent(NOW + 1)).toBeUndefined();
    vi.restoreAllMocks();
    expect(takeTextAiIntent(NOW + 2)).toBeUndefined();

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(clearTextAiIntent).not.toThrow();
  });
});

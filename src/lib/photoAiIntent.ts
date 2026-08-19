import { PHOTO_AI_LIMITS } from './photoAiContract';
import type { MealSlot } from './nutritionTypes';

export interface PhotoAiIntent {
  version: 1;
  date: string;
  slot: MealSlot;
  createdAt: number;
  expiresAt: number;
}

export const PHOTO_AI_LOGIN_PATH = '/api/nutrition/photo/session?resume=1';

const STORAGE_KEY = 'tiezheng:photo-ai:intent:v1';
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLOTS = new Set<MealSlot>(['breakfast', 'lunch', 'dinner', 'snack']);
const INTENT_KEYS = ['createdAt', 'date', 'expiresAt', 'slot', 'version'] as const;
let storageUnavailable = false;

function isSafeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function assertNow(value: number): void {
  if (!isSafeTimestamp(value)) throw new TypeError('Invalid photo AI intent time');
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isSlot(value: unknown): value is MealSlot {
  return typeof value === 'string' && SLOTS.has(value as MealSlot);
}

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    storageUnavailable = true;
    return undefined;
  }
}

function snapshotIntent(value: unknown): PhotoAiIntent | undefined {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== INTENT_KEYS.length ||
      keys.some((key) => typeof key !== 'string' || !INTENT_KEYS.includes(key as never))
    ) {
      return undefined;
    }

    const fields = new Map<string, unknown>();
    for (const key of INTENT_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) return undefined;
      fields.set(key, descriptor.value);
    }
    const version = fields.get('version');
    const date = fields.get('date');
    const slot = fields.get('slot');
    const createdAt = fields.get('createdAt');
    const expiresAt = fields.get('expiresAt');
    if (
      version !== 1 ||
      !isDateKey(date) ||
      !isSlot(slot) ||
      !isSafeTimestamp(createdAt) ||
      !isSafeTimestamp(expiresAt) ||
      expiresAt !== createdAt + PHOTO_AI_LIMITS.intentMs
    ) {
      return undefined;
    }
    return { version, date, slot, createdAt, expiresAt };
  } catch {
    return undefined;
  }
}

export function savePhotoAiIntent(date: string, slot: MealSlot, now = Date.now()): void {
  assertNow(now);
  if (!isDateKey(date) || !isSlot(slot)) throw new TypeError('Invalid photo AI intent');
  const expiresAt = now + PHOTO_AI_LIMITS.intentMs;
  if (!isSafeTimestamp(expiresAt)) throw new TypeError('Invalid photo AI intent expiry');
  const intent: PhotoAiIntent = { version: 1, date, slot, createdAt: now, expiresAt };
  const target = storage();
  if (target === undefined) throw new TypeError('Photo AI intent storage unavailable');
  try {
    target.removeItem(STORAGE_KEY);
  } catch {
    storageUnavailable = true;
    try {
      target.setItem(STORAGE_KEY, '');
    } catch {
      // The login navigation is stopped by the error below.
    }
    throw new TypeError('Photo AI intent storage unavailable');
  }
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(intent));
    storageUnavailable = false;
  } catch {
    storageUnavailable = true;
    try {
      target.removeItem(STORAGE_KEY);
    } catch {
      try {
        target.setItem(STORAGE_KEY, '');
      } catch {
        // The in-memory latch keeps this page fail closed until storage recovers.
      }
    }
    throw new TypeError('Photo AI intent storage unavailable');
  }
}

export function clearPhotoAiIntent(): void {
  const target = storage();
  if (target === undefined) return;
  try {
    target.removeItem(STORAGE_KEY);
    storageUnavailable = false;
  } catch {
    storageUnavailable = true;
    try {
      target.setItem(STORAGE_KEY, '');
    } catch {
      // Fail closed when storage is unavailable.
    }
  }
}

export function takePhotoAiIntent(now = Date.now()): PhotoAiIntent | undefined {
  assertNow(now);
  let raw: string | null;
  try {
    const target = storage();
    if (target === undefined) return undefined;
    if (storageUnavailable) {
      try {
        target.removeItem(STORAGE_KEY);
        storageUnavailable = false;
      } catch {
        try {
          target.setItem(STORAGE_KEY, '');
        } catch {
          // Keep the latch set until a later storage operation succeeds.
        }
      }
      return undefined;
    }
    raw = target.getItem(STORAGE_KEY);
    try {
      target.removeItem(STORAGE_KEY);
    } catch {
      storageUnavailable = true;
      try {
        target.setItem(STORAGE_KEY, '');
      } catch {
        // The in-memory latch prevents replay in this page.
      }
      return undefined;
    }
  } catch {
    storageUnavailable = true;
    return undefined;
  }
  if (raw === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const intent = snapshotIntent(parsed);
  if (intent === undefined || now < intent.createdAt || now >= intent.expiresAt) {
    return undefined;
  }
  return intent;
}

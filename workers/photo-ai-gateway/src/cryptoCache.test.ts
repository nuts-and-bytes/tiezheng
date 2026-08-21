import { afterEach, describe, expect, test, vi } from 'vitest';

import * as cryptoCache from './cryptoCache';
import { decryptCandidateCache, encryptCandidateCache } from './cryptoCache';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const OTHER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(8)));
const FINGERPRINT = 'a'.repeat(64);

function mutateBase64(value: string): string {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  bytes[0] ^= 1;
  return btoa(String.fromCharCode(...bytes));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('encrypted candidate cache', () => {
  test('exports a synchronous validator for one canonical 32-byte Base64 key', () => {
    expect(cryptoCache).toHaveProperty('isValidCacheEncryptionKey');
    const validate = (cryptoCache as unknown as {
      isValidCacheEncryptionKey(value: unknown): boolean;
    }).isValidCacheEncryptionKey;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const canonicalTailIndex = alphabet.indexOf(KEY.at(-2)!);
    const nonCanonicalEquivalent = `${KEY.slice(0, -2)}${alphabet[canonicalTailIndex + 1]}=`;

    expect(validate(KEY)).toBe(true);
    expect([
      null,
      '',
      'not-base64',
      KEY.slice(0, -1),
      `${KEY}\n`,
      nonCanonicalEquivalent,
      btoa(String.fromCharCode(...new Uint8Array(31))),
      btoa(String.fromCharCode(...new Uint8Array(33))),
    ].every((value) => !validate(value))).toBe(true);
  });

  test('round trips with a 32-byte Base64 key and fingerprint AAD', async () => {
    const cache = await encryptCandidateCache(
      { candidates: [{ name: '米饭' }] },
      FINGERPRINT,
      KEY,
      1_000,
    );

    await expect(decryptCandidateCache(cache, FINGERPRINT, KEY, 999)).resolves.toEqual({
      candidates: [{ name: '米饭' }],
    });
  });

  test('uses a fresh random 96-bit IV and stores no plaintext food name', async () => {
    const first = await encryptCandidateCache({ name: '熟鸡胸肉' }, FINGERPRINT, KEY, 2_000);
    const second = await encryptCandidateCache({ name: '熟鸡胸肉' }, FINGERPRINT, KEY, 2_000);

    expect(Uint8Array.from(atob(first.ivBase64), (value) => value.charCodeAt(0))).toHaveLength(12);
    expect(second.ivBase64).not.toBe(first.ivBase64);
    expect(atob(first.ciphertextBase64)).not.toContain('熟鸡胸肉');
    expect(first).toEqual({
      ivBase64: expect.any(String),
      ciphertextBase64: expect.any(String),
      expiresAt: 2_000,
    });
  });

  test('serializes JSON deterministically before encryption', async () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
      array.fill(3);
      return array;
    }) as typeof crypto.getRandomValues);

    const first = await encryptCandidateCache({ second: 2, first: 1 }, FINGERPRINT, KEY, 2_000);
    const second = await encryptCandidateCache({ first: 1, second: 2 }, FINGERPRINT, KEY, 2_000);

    expect(second).toEqual(first);
  });

  test.each([
    ['wrong key', (cache: Awaited<ReturnType<typeof encryptCandidateCache>>) => [cache, FINGERPRINT, OTHER_KEY] as const],
    ['wrong fingerprint', (cache: Awaited<ReturnType<typeof encryptCandidateCache>>) => [cache, 'b'.repeat(64), KEY] as const],
    ['wrong IV', (cache: Awaited<ReturnType<typeof encryptCandidateCache>>) => [{ ...cache, ivBase64: mutateBase64(cache.ivBase64) }, FINGERPRINT, KEY] as const],
    ['wrong ciphertext', (cache: Awaited<ReturnType<typeof encryptCandidateCache>>) => [{ ...cache, ciphertextBase64: mutateBase64(cache.ciphertextBase64) }, FINGERPRINT, KEY] as const],
  ])('rejects %s without exposing cryptographic details', async (_label, input) => {
    const cache = await encryptCandidateCache({ name: '米饭' }, FINGERPRINT, KEY, 2_000);
    const [candidate, fingerprint, key] = input(cache);
    await expect(decryptCandidateCache(candidate, fingerprint, key, 1_000)).rejects.toThrow(
      'Invalid encrypted candidate cache',
    );
  });

  test.each([
    '',
    'not-base64',
    btoa(String.fromCharCode(...new Uint8Array(31))),
    btoa(String.fromCharCode(...new Uint8Array(33))),
  ])('rejects a malformed AES key', async (key) => {
    await expect(encryptCandidateCache({}, FINGERPRINT, key, 2_000)).rejects.toThrow(
      'Invalid cache encryption configuration',
    );
  });

  test('rejects expired ciphertext before decrypting', async () => {
    const cache = await encryptCandidateCache({ name: '米饭' }, FINGERPRINT, KEY, 2_000);
    await expect(decryptCandidateCache(cache, FINGERPRINT, KEY, 2_000)).rejects.toThrow(
      'Invalid encrypted candidate cache',
    );
  });

  test.each(['short', 'A'.repeat(64), 'g'.repeat(64)])(
    'rejects a non-canonical request fingerprint',
    async (fingerprint) => {
      await expect(encryptCandidateCache({}, fingerprint, KEY, 2_000)).rejects.toThrow(
        'Invalid encrypted candidate cache',
      );
    },
  );
});

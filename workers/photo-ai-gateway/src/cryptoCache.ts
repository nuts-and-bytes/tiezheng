import { stableJson } from '../../../src/lib/stableJson';
import type { EncryptedCandidateCache } from './coordinator';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new TypeError('Invalid cache encryption configuration');
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new TypeError('Invalid cache encryption configuration');
  }
}

function encodeBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function canonicalKeyBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== 'string') return null;
  try {
    const bytes = decodeBase64(value);
    return bytes.length === 32 && encodeBase64(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

export function isValidCacheEncryptionKey(value: unknown): value is string {
  return canonicalKeyBytes(value) !== null;
}

async function keyFrom(value: string): Promise<CryptoKey> {
  const bytes = canonicalKeyBytes(value);
  if (bytes === null) {
    throw new TypeError('Invalid cache encryption configuration');
  }
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function assertFingerprint(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError('Invalid encrypted candidate cache');
  }
}

export async function encryptCandidateCache(
  value: unknown,
  fingerprint: string,
  keyBase64: string,
  expiresAt: number,
): Promise<EncryptedCandidateCache> {
  assertFingerprint(fingerprint);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new TypeError('Invalid encrypted candidate cache');
  }
  const key = await keyFrom(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(stableJson(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(fingerprint) },
    key,
    plaintext,
  );
  return {
    ivBase64: encodeBase64(iv),
    ciphertextBase64: encodeBase64(new Uint8Array(encrypted)),
    expiresAt,
  };
}

export async function decryptCandidateCache(
  cache: EncryptedCandidateCache,
  fingerprint: string,
  keyBase64: string,
  now: number,
): Promise<unknown> {
  assertFingerprint(fingerprint);
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(cache.expiresAt) || cache.expiresAt <= now) {
    throw new TypeError('Invalid encrypted candidate cache');
  }
  const key = await keyFrom(keyBase64);
  const iv = decodeBase64(cache.ivBase64);
  const ciphertext = decodeBase64(cache.ciphertextBase64);
  if (iv.length !== 12 || ciphertext.length < 17) {
    throw new TypeError('Invalid encrypted candidate cache');
  }
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(fingerprint) },
      key,
      ciphertext,
    );
    return JSON.parse(decoder.decode(decrypted)) as unknown;
  } catch {
    throw new TypeError('Invalid encrypted candidate cache');
  }
}

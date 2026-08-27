import { SignJWT, jwtVerify } from 'jose';
import { deriveOpaqueKey } from '../identity/opaqueKey';

export type TextAccountSlot = 'user-1' | 'user-2';

export interface TextAuthEnv {
  PHOTO_AI_ACCOUNT_HMAC_KEY: string;
  TEXT_AI_USER_1_ACCESS_CODE_PEPPER: string;
  TEXT_AI_USER_1_ACCESS_CODE_DIGEST: string;
  TEXT_AI_USER_2_ACCESS_CODE_PEPPER: string;
  TEXT_AI_USER_2_ACCESS_CODE_DIGEST: string;
  TEXT_AI_SESSION_SIGNING_KEY: string;
  TEXT_AI_RATE_LIMIT_HMAC_KEY: string;
}

export interface TextAuthConfig {
  readonly accountHmacSecret: string;
  readonly user1AccessCodePepper: string;
  readonly user1AccessCodeDigest: string;
  readonly user2AccessCodePepper: string;
  readonly user2AccessCodeDigest: string;
  readonly sessionSigningKey: string;
  readonly rateLimitHmacKey: string;
}

export interface TextIdentity {
  readonly slot: TextAccountSlot;
  readonly accountKey: string;
  readonly credentialVersion: string;
}

export const TEXT_SESSION_COOKIE = '__Host-tiezheng-text-ai-session';
export const TEXT_SESSION_SECONDS = 2_592_000;

const ACCESS_CODE = /^[A-Za-z0-9_-]{32}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const COMPACT_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9A-Fa-f:]{2,45}$/;
const JWT_ISSUER = 'tiezheng-text-ai';
const JWT_AUDIENCE = 'tiezheng-text-ai-preview';
const JWT_PAYLOAD_KEYS = Object.freeze(['aud', 'cv', 'exp', 'iat', 'iss', 'sub']);
const JWT_HEADER_KEYS = Object.freeze(['alg', 'typ']);
const parsedConfigs = new WeakSet<object>();

export function parseTextAuthConfig(env: TextAuthEnv): Readonly<TextAuthConfig> {
  try {
    if (typeof env !== 'object' || env === null) throw new TypeError();
    const accountHmacSecret = ownString(env, 'PHOTO_AI_ACCOUNT_HMAC_KEY');
    const user1AccessCodePepper = ownString(env, 'TEXT_AI_USER_1_ACCESS_CODE_PEPPER');
    const user1AccessCodeDigest = ownString(env, 'TEXT_AI_USER_1_ACCESS_CODE_DIGEST');
    const user2AccessCodePepper = ownString(env, 'TEXT_AI_USER_2_ACCESS_CODE_PEPPER');
    const user2AccessCodeDigest = ownString(env, 'TEXT_AI_USER_2_ACCESS_CODE_DIGEST');
    const sessionSigningKey = ownString(env, 'TEXT_AI_SESSION_SIGNING_KEY');
    const rateLimitHmacKey = ownString(env, 'TEXT_AI_RATE_LIMIT_HMAC_KEY');

    if (new TextEncoder().encode(accountHmacSecret).byteLength < 32) throw new TypeError();
    if (!DIGEST.test(user1AccessCodeDigest) || !DIGEST.test(user2AccessCodeDigest)) {
      throw new TypeError();
    }
    if (constantTimeEqual(user1AccessCodeDigest, user2AccessCodeDigest)) throw new TypeError();

    const encodedKeys = [
      user1AccessCodePepper,
      user2AccessCodePepper,
      sessionSigningKey,
      rateLimitHmacKey,
    ];
    for (const encodedKey of encodedKeys) decodeCanonicalKey(encodedKey);
    if (new Set(encodedKeys).size !== encodedKeys.length) throw new TypeError();

    const config: TextAuthConfig = Object.freeze({
      accountHmacSecret,
      user1AccessCodePepper,
      user1AccessCodeDigest,
      user2AccessCodePepper,
      user2AccessCodeDigest,
      sessionSigningKey,
      rateLimitHmacKey,
    });
    parsedConfigs.add(config);
    return config;
  } catch {
    return denied();
  }
}

export async function digestTextAccessCode(
  code: string,
  pepper: Uint8Array,
): Promise<string> {
  try {
    if (typeof code !== 'string' || !ACCESS_CODE.test(code)) throw new TypeError();
    if (!(pepper instanceof Uint8Array) || pepper.byteLength !== 32) throw new TypeError();
    return await hmacHex(new Uint8Array(pepper), new TextEncoder().encode(code));
  } catch {
    return denied();
  }
}

export async function authenticateTextAccessCode(
  code: string,
  config: TextAuthConfig,
): Promise<TextIdentity> {
  try {
    requireConfig(config);
    if (typeof code !== 'string' || !ACCESS_CODE.test(code)) throw new TypeError();
    const [user1Digest, user2Digest] = await Promise.all([
      digestTextAccessCode(code, decodeCanonicalKey(config.user1AccessCodePepper)),
      digestTextAccessCode(code, decodeCanonicalKey(config.user2AccessCodePepper)),
    ]);
    const user1Matches = constantTimeEqual(user1Digest, config.user1AccessCodeDigest);
    const user2Matches = constantTimeEqual(user2Digest, config.user2AccessCodeDigest);
    if (Number(user1Matches) + Number(user2Matches) !== 1) throw new TypeError();

    const slot: TextAccountSlot = user1Matches ? 'user-1' : 'user-2';
    const digest = user1Matches
      ? config.user1AccessCodeDigest
      : config.user2AccessCodeDigest;
    return Object.freeze({
      slot,
      accountKey: await deriveOpaqueKey(`text-ai:${slot}`, config.accountHmacSecret),
      credentialVersion: await credentialVersion(digest),
    });
  } catch {
    return denied();
  }
}

export async function issueTextSession(
  identity: TextIdentity,
  config: TextAuthConfig,
  nowMs = Date.now(),
): Promise<string> {
  try {
    requireConfig(config);
    const now = exactNowSeconds(nowMs);
    const normalizedIdentity = await validateIdentity(identity, config);
    return await new SignJWT({ cv: normalizedIdentity.credentialVersion })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setSubject(normalizedIdentity.slot)
      .setIssuedAt(now)
      .setExpirationTime(now + TEXT_SESSION_SECONDS)
      .sign(decodeCanonicalKey(config.sessionSigningKey));
  } catch {
    return denied();
  }
}

export async function verifyTextSession(
  request: Request,
  config: TextAuthConfig,
  nowMs = Date.now(),
): Promise<TextIdentity> {
  try {
    requireConfig(config);
    if (!(request instanceof Request)) throw new TypeError();
    const now = exactNowSeconds(nowMs);
    const token = sessionToken(request);
    const { payload, protectedHeader } = await jwtVerify(
      token,
      decodeCanonicalKey(config.sessionSigningKey),
      {
        algorithms: ['HS256'],
        audience: JWT_AUDIENCE,
        issuer: JWT_ISSUER,
        currentDate: new Date(nowMs),
      },
    );

    if (!sameOwnKeys(protectedHeader, JWT_HEADER_KEYS)
      || protectedHeader.alg !== 'HS256'
      || protectedHeader.typ !== 'JWT') {
      throw new TypeError();
    }
    if (!sameOwnKeys(payload, JWT_PAYLOAD_KEYS)
      || payload.iss !== JWT_ISSUER
      || payload.aud !== JWT_AUDIENCE
      || (payload.sub !== 'user-1' && payload.sub !== 'user-2')
      || !Number.isSafeInteger(payload.iat)
      || !Number.isSafeInteger(payload.exp)
      || (payload.iat as number) > now
      || (payload.exp as number) <= (payload.iat as number)
      || (payload.exp as number) - (payload.iat as number) > TEXT_SESSION_SECONDS
      || typeof payload.cv !== 'string'
      || !BASE64URL_32.test(payload.cv)) {
      throw new TypeError();
    }

    const slot = payload.sub;
    const digest = slot === 'user-1'
      ? config.user1AccessCodeDigest
      : config.user2AccessCodeDigest;
    const currentCredentialVersion = await credentialVersion(digest);
    if (!constantTimeEqual(payload.cv, currentCredentialVersion)) throw new TypeError();
    return Object.freeze({
      slot,
      accountKey: await deriveOpaqueKey(`text-ai:${slot}`, config.accountHmacSecret),
      credentialVersion: currentCredentialVersion,
    });
  } catch {
    return denied();
  }
}

export function textSessionCookie(token: string): string {
  const normalized = compactToken(token);
  return `${TEXT_SESSION_COOKIE}=${normalized}; Max-Age=${TEXT_SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearTextSessionCookie(): string {
  return `${TEXT_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export async function deriveTextAttemptKey(
  ip: string | null,
  config: TextAuthConfig,
): Promise<{ attemptKey: string; anonymous: boolean }> {
  try {
    requireConfig(config);
    const normalizedIp = normalizeIp(ip);
    const anonymous = normalizedIp === null;
    const subject = anonymous ? 'text-ai:ip:anonymous' : `text-ai:ip:${normalizedIp}`;
    return {
      attemptKey: await hmacHex(
        decodeCanonicalKey(config.rateLimitHmacKey),
        new TextEncoder().encode(subject),
      ),
      anonymous,
    };
  } catch {
    return denied();
  }
}

async function validateIdentity(
  identity: TextIdentity,
  config: TextAuthConfig,
): Promise<TextIdentity> {
  if (typeof identity !== 'object'
    || identity === null
    || !sameOwnKeys(identity, ['accountKey', 'credentialVersion', 'slot'])) {
    throw new TypeError();
  }
  const slot = ownString(identity, 'slot');
  const accountKey = ownString(identity, 'accountKey');
  const suppliedCredentialVersion = ownString(identity, 'credentialVersion');
  if ((slot !== 'user-1' && slot !== 'user-2')
    || !DIGEST.test(accountKey)
    || !BASE64URL_32.test(suppliedCredentialVersion)) {
    throw new TypeError();
  }
  const digest = slot === 'user-1'
    ? config.user1AccessCodeDigest
    : config.user2AccessCodeDigest;
  const [expectedAccountKey, expectedCredentialVersion] = await Promise.all([
    deriveOpaqueKey(`text-ai:${slot}`, config.accountHmacSecret),
    credentialVersion(digest),
  ]);
  if (!constantTimeEqual(accountKey, expectedAccountKey)
    || !constantTimeEqual(suppliedCredentialVersion, expectedCredentialVersion)) {
    throw new TypeError();
  }
  return { slot, accountKey, credentialVersion: suppliedCredentialVersion };
}

function requireConfig(config: TextAuthConfig): void {
  if (typeof config !== 'object' || config === null || !parsedConfigs.has(config)) {
    throw new TypeError();
  }
}

function ownString(value: object, key: string): string {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') {
    throw new TypeError();
  }
  return descriptor.value;
}

function sameOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function decodeCanonicalKey(value: string): Uint8Array {
  if (typeof value !== 'string' || !BASE64URL_32.test(value)) throw new TypeError();
  const base64 = `${value.replace(/-/g, '+').replace(/_/g, '/')}=`;
  const decoded = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  if (decoded.byteLength !== 32 || encodeBase64Url(decoded) !== value) throw new TypeError();
  return decoded;
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function credentialVersion(digest: string): Promise<string> {
  if (!DIGEST.test(digest)) throw new TypeError();
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(digest));
  return encodeBase64Url(new Uint8Array(bytes));
}

async function hmacHex(keyBytes: Uint8Array, valueBytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(keyBytes),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new Uint8Array(valueBytes));
  return Array.from(
    new Uint8Array(signature),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  const length = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function exactNowSeconds(nowMs: number): number {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError();
  return Math.floor(nowMs / 1000);
}

function compactToken(token: string): string {
  if (typeof token !== 'string' || token.length > 4_096 || !COMPACT_JWT.test(token)) {
    return denied();
  }
  return token;
}

function sessionToken(request: Request): string {
  const header = request.headers.get('cookie');
  if (header === null || header.length === 0 || header.length > 8_192) return denied();
  let token: string | undefined;
  for (const part of header.split(';')) {
    const segment = part.trim();
    const separator = segment.indexOf('=');
    if (separator < 0 || segment.slice(0, separator) !== TEXT_SESSION_COOKIE) continue;
    if (token !== undefined) return denied();
    token = segment.slice(separator + 1);
  }
  if (token === undefined) return denied();
  return compactToken(token);
}

function normalizeIp(ip: string | null): string | null {
  if (typeof ip !== 'string' || ip.length === 0 || ip.trim() !== ip) return null;
  const ipv4 = IPV4.exec(ip);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    return octets.join('.');
  }
  if (ip.includes(':') && IPV6.test(ip)) return ip.toLowerCase();
  return null;
}

function denied(): never {
  throw new Error('Access denied');
}

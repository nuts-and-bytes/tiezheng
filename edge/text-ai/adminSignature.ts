import { parseTextAiAdminRequest } from '../../src/lib/textAiAdminContract';

export const TEXT_ADMIN_SIGNATURE_HEADERS = Object.freeze({
  version: 'x-tiezheng-admin-version',
  timestamp: 'x-tiezheng-admin-timestamp',
  signature: 'x-tiezheng-admin-signature',
} as const);

const ADMIN_VERSION = 'v1';
const ADMIN_METHOD = 'POST';
const ADMIN_PATH = '/api/nutrition/text-admin/account';
const MAX_BODY_BYTES = 2_048;
const MAX_CLOCK_DRIFT_MS = 300_000;
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const OPERATION_ID = /^[a-f0-9]{32}$/;
const TIMESTAMP = /^(0|[1-9]\d{0,15})$/;
const SIGNATURE = /^[a-f0-9]{64}$/;
const INVALID_SIGNATURE = 'Invalid text admin signature';

export interface TextAdminSignatureInput {
  key: string;
  method: string;
  path: string;
  timestamp: string;
  operationId: string;
  body: Uint8Array;
}

export interface SignedTextAdminRequest {
  readonly version: 'v1';
  readonly timestamp: string;
  readonly signature: string;
}

function invalidSignature(): never {
  throw new Error(INVALID_SIGNATURE);
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeCanonicalKey(value: string): Uint8Array {
  if (typeof value !== 'string' || !BASE64URL_32.test(value)) return invalidSignature();
  try {
    const base64 = `${value.replace(/-/g, '+').replace(/_/g, '/')}=`;
    const decoded = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    if (decoded.byteLength !== 32 || encodeBase64Url(decoded) !== value) {
      return invalidSignature();
    }
    return decoded;
  } catch {
    return invalidSignature();
  }
}

function hex(value: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(value),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new Uint8Array(value)));
}

async function hmacHex(keyBytes: Uint8Array, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(keyBytes),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  );
  return hex(signature);
}

function constantTimeEqualHex(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  const length = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function signatureMaterial(input: {
  method: string;
  path: string;
  timestamp: string;
  operationId: string;
  body: Uint8Array;
}): Promise<string> {
  return [
    ADMIN_VERSION,
    input.method,
    input.path,
    input.timestamp,
    input.operationId,
    await sha256Hex(input.body),
  ].join('\n');
}

function exactAdminUrl(request: Request): URL {
  const url = new URL(request.url);
  if (
    request.method !== ADMIN_METHOD
    || url.pathname !== ADMIN_PATH
    || url.search !== ''
    || url.hash !== ''
    || url.username !== ''
    || url.password !== ''
    || url.port !== ''
  ) {
    return invalidSignature();
  }
  return url;
}

function exactTimestamp(value: string | null, nowMs: number): string {
  if (value === null || !TIMESTAMP.test(value)) return invalidSignature();
  const timestamp = Number(value);
  if (
    !Number.isSafeInteger(timestamp)
    || timestamp < 0
    || !Number.isSafeInteger(nowMs)
    || nowMs < 0
    || Math.abs(timestamp - nowMs) > MAX_CLOCK_DRIFT_MS
  ) {
    return invalidSignature();
  }
  return value;
}

async function readSignedBody(request: Request): Promise<{
  body: Uint8Array;
  operationId: string;
}> {
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_BODY_BYTES) {
    return invalidSignature();
  }
  const serialized = new TextDecoder('utf-8', { fatal: true }).decode(body);
  const parsed = parseTextAiAdminRequest(JSON.parse(serialized) as unknown);
  return { body, operationId: parsed.operationId };
}

export async function signTextAdminRequestForTest(
  input: TextAdminSignatureInput,
): Promise<SignedTextAdminRequest> {
  try {
    if (
      input.method !== ADMIN_METHOD
      || input.path !== ADMIN_PATH
      || !TIMESTAMP.test(input.timestamp)
      || !OPERATION_ID.test(input.operationId)
      || input.body.byteLength === 0
      || input.body.byteLength > MAX_BODY_BYTES
    ) {
      return invalidSignature();
    }
    const parsed = parseTextAiAdminRequest(JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(input.body),
    ) as unknown);
    if (parsed.operationId !== input.operationId) return invalidSignature();
    const key = decodeCanonicalKey(input.key);
    const material = await signatureMaterial(input);
    return Object.freeze({
      version: ADMIN_VERSION,
      timestamp: input.timestamp,
      signature: await hmacHex(key, material),
    });
  } catch {
    return invalidSignature();
  }
}

export async function verifyTextAdminSignature(
  request: Request,
  signingKey: string,
  nowMs: number = Date.now(),
): Promise<void> {
  try {
    const url = exactAdminUrl(request);
    const version = request.headers.get(TEXT_ADMIN_SIGNATURE_HEADERS.version);
    const timestamp = exactTimestamp(
      request.headers.get(TEXT_ADMIN_SIGNATURE_HEADERS.timestamp),
      nowMs,
    );
    const supplied = request.headers.get(TEXT_ADMIN_SIGNATURE_HEADERS.signature);
    if (version !== ADMIN_VERSION || supplied === null || !SIGNATURE.test(supplied)) {
      return invalidSignature();
    }
    const { body, operationId } = await readSignedBody(request);
    const material = await signatureMaterial({
      method: request.method,
      path: url.pathname,
      timestamp,
      operationId,
      body,
    });
    const expected = await hmacHex(decodeCanonicalKey(signingKey), material);
    if (!constantTimeEqualHex(supplied, expected)) return invalidSignature();
  } catch {
    return invalidSignature();
  }
}

import { createHash, createHmac } from 'node:crypto';

const FAILURE_MESSAGE = 'Text admin signature failed';
const ADMIN_PATH = '/api/nutrition/text-admin/account';
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const OPERATION_ID = /^[a-f0-9]{32}$/;
const TIMESTAMP = /^(0|[1-9]\d{0,15})$/;
const MAX_BODY_BYTES = 2_048;

function fail() {
  throw new Error(FAILURE_MESSAGE);
}

function snapshotInput(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const expected = ['body', 'key', 'operationId', 'timestamp'];
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expected.length
      || keys.some((key) => typeof key !== 'string' || !expected.includes(key))
    ) {
      fail();
    }
    const snapshot = new Map();
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
      snapshot.set(key, descriptor.value);
    }
    return snapshot;
  } catch {
    fail();
  }
}

function decodeCanonicalKey(value) {
  if (typeof value !== 'string' || !BASE64URL_32.test(value)) fail();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.byteLength !== 32 || decoded.toString('base64url') !== value) fail();
  return decoded;
}

export function signTextAdminRequest(input) {
  try {
    const snapshot = snapshotInput(input);
    const key = decodeCanonicalKey(snapshot.get('key'));
    const timestamp = snapshot.get('timestamp');
    const operationId = snapshot.get('operationId');
    const body = snapshot.get('body');
    if (
      typeof timestamp !== 'string'
      || !TIMESTAMP.test(timestamp)
      || !Number.isSafeInteger(Number(timestamp))
      || Number(timestamp) < 0
      || typeof operationId !== 'string'
      || !OPERATION_ID.test(operationId)
      || typeof body !== 'string'
    ) {
      fail();
    }
    const bodyBytes = Buffer.from(body, 'utf8');
    if (bodyBytes.byteLength === 0 || bodyBytes.byteLength > MAX_BODY_BYTES) fail();
    const bodyHash = createHash('sha256').update(bodyBytes).digest('hex');
    const material = [
      'v1',
      'POST',
      ADMIN_PATH,
      timestamp,
      operationId,
      bodyHash,
    ].join('\n');
    return createHmac('sha256', key).update(material, 'utf8').digest('hex');
  } catch {
    fail();
  }
}

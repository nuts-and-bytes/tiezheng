import { createRemoteJWKSet, customFetch, jwtVerify, type RemoteJWKSet } from 'jose';

export interface AccessIdentity {
  accountKey: string;
  expiresAt: number;
}

export type VerifiedAccessPrincipal =
  | { kind: 'user'; email: string; expiresAt: number }
  | { kind: 'service'; clientId: string; expiresAt: number };

export interface AccessEnv {
  PHOTO_AI_TEAM_DOMAIN: string;
  PHOTO_AI_ACCESS_AUD: string;
  PHOTO_AI_ALLOWED_EMAILS: string;
  PHOTO_AI_ACCOUNT_HMAC_KEY: string;
}

export interface AccessConfig {
  issuer: string;
  audience: string;
  allowedEmails: ReadonlySet<string>;
  accountHmacSecret: string;
}

export interface AccessConfigFields {
  teamDomain: string;
  audience: string;
  allowedEmails: string;
  expectedEmailCount: 1 | 2 | 3;
  accountHmacSecret: string;
}

export class AccessDeniedError extends Error {
  constructor() {
    super('Access denied');
  }
}

const TEAM_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const ACCESS_ISSUER = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.cloudflareaccess\.com$/;
const remoteKeySets = new WeakMap<typeof fetch, Map<string, RemoteJWKSet>>();

export function parseAccessConfig(env: AccessEnv): AccessConfig {
  return parseAccessConfigFields({
    teamDomain: env.PHOTO_AI_TEAM_DOMAIN,
    audience: env.PHOTO_AI_ACCESS_AUD,
    allowedEmails: env.PHOTO_AI_ALLOWED_EMAILS,
    expectedEmailCount: 3,
    accountHmacSecret: env.PHOTO_AI_ACCOUNT_HMAC_KEY,
  });
}

export function parseAccessConfigFields(fields: AccessConfigFields): AccessConfig {
  if (typeof fields.teamDomain !== 'string' || !TEAM_SLUG.test(fields.teamDomain)) throw new AccessDeniedError();
  if (typeof fields.audience !== 'string' || fields.audience.trim().length === 0) throw new AccessDeniedError();
  if (typeof fields.accountHmacSecret !== 'string'
    || new TextEncoder().encode(fields.accountHmacSecret).byteLength < 32) {
    throw new AccessDeniedError();
  }
  if (fields.expectedEmailCount !== 1
    && fields.expectedEmailCount !== 2
    && fields.expectedEmailCount !== 3) {
    throw new AccessDeniedError();
  }
  if (typeof fields.allowedEmails !== 'string') throw new AccessDeniedError();

  const emails = fields.allowedEmails.split(',');
  if (emails.length !== fields.expectedEmailCount
    || emails.some((email) => !EMAIL.test(email))
    || new Set(emails).size !== fields.expectedEmailCount) {
    throw new AccessDeniedError();
  }

  const issuer = `https://${fields.teamDomain}.cloudflareaccess.com`;
  return {
    issuer,
    audience: fields.audience,
    allowedEmails: new Set(emails),
    accountHmacSecret: fields.accountHmacSecret,
  };
}

export async function deriveAccountKey(email: string, secret: string): Promise<string> {
  try {
    if (typeof email !== 'string' || !EMAIL.test(email)) throw new AccessDeniedError();
    if (typeof secret !== 'string') throw new AccessDeniedError();

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { hash: 'SHA-256', name: 'HMAC' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email));
    return hex(signature);
  } catch {
    throw new AccessDeniedError();
  }
}

export async function verifyAccessPrincipal(
  request: Request,
  config: AccessConfig,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedAccessPrincipal> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new AccessDeniedError();

  try {
    const keys = remoteKeySet(config.issuer, fetcher);
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      audience: config.audience,
      issuer: config.issuer,
      clockTolerance: 30,
    });
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      throw new AccessDeniedError();
    }

    if (typeof payload.sub === 'string'
      && payload.sub.length > 0
      && typeof payload.email === 'string'
      && payload.common_name === undefined) {
      const email = payload.email.toLowerCase();
      if (!EMAIL.test(email) || !config.allowedEmails.has(email)) throw new AccessDeniedError();
      return { kind: 'user', email, expiresAt: payload.exp };
    }

    if (payload.sub === ''
      && payload.email === undefined
      && typeof payload.common_name === 'string'
      && payload.common_name.length > 0) {
      return { kind: 'service', clientId: payload.common_name, expiresAt: payload.exp };
    }

    throw new AccessDeniedError();
  } catch {
    throw new AccessDeniedError();
  }
}

export async function verifyAccess(
  request: Request,
  config: AccessConfig,
  fetcher: typeof fetch = fetch,
): Promise<AccessIdentity> {
  try {
    const principal = await verifyAccessPrincipal(request, config, fetcher);
    if (principal.kind !== 'user') throw new AccessDeniedError();
    return {
      accountKey: await deriveAccountKey(principal.email, config.accountHmacSecret),
      expiresAt: principal.expiresAt,
    };
  } catch {
    throw new AccessDeniedError();
  }
}

function remoteKeySet(issuer: string, fetcher: typeof fetch): RemoteJWKSet {
  if (!ACCESS_ISSUER.test(issuer)) throw new AccessDeniedError();
  const certsUrl = `${issuer}/cdn-cgi/access/certs`;
  let byCertsUrl = remoteKeySets.get(fetcher);
  if (!byCertsUrl) {
    byCertsUrl = new Map();
    remoteKeySets.set(fetcher, byCertsUrl);
  }
  let keySet = byCertsUrl.get(certsUrl);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(certsUrl), { [customFetch]: fetcher });
    byCertsUrl.set(certsUrl, keySet);
  }
  return keySet;
}

function hex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

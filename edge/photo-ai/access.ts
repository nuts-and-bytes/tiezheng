import { createRemoteJWKSet, customFetch, jwtVerify, type RemoteJWKSet } from 'jose';

export interface AccessIdentity {
  accountKey: string;
  expiresAt: number;
}

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
  if (!TEAM_SLUG.test(env.PHOTO_AI_TEAM_DOMAIN)) throw new AccessDeniedError();
  if (env.PHOTO_AI_ACCESS_AUD.trim().length === 0) throw new AccessDeniedError();
  if (new TextEncoder().encode(env.PHOTO_AI_ACCOUNT_HMAC_KEY).byteLength < 32) throw new AccessDeniedError();

  const emails = env.PHOTO_AI_ALLOWED_EMAILS.split(',');
  if (emails.length !== 3 || emails.some((email) => !EMAIL.test(email)) || new Set(emails).size !== 3) {
    throw new AccessDeniedError();
  }

  const issuer = `https://${env.PHOTO_AI_TEAM_DOMAIN}.cloudflareaccess.com`;
  return {
    issuer,
    audience: env.PHOTO_AI_ACCESS_AUD,
    allowedEmails: new Set(emails),
    accountHmacSecret: env.PHOTO_AI_ACCOUNT_HMAC_KEY,
  };
}

export async function verifyAccess(request: Request, config: AccessConfig, fetcher: typeof fetch = fetch): Promise<AccessIdentity> {
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
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      throw new AccessDeniedError();
    }
    if (!config.allowedEmails.has(payload.email.toLowerCase())) throw new AccessDeniedError();

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(config.accountHmacSecret),
      { hash: 'SHA-256', name: 'HMAC' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload.sub));
    return { accountKey: hex(signature), expiresAt: payload.exp };
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

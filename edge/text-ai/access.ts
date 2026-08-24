import {
  AccessDeniedError,
  parseAccessConfigFields,
  verifyAccessPrincipal,
  type AccessConfig,
  type VerifiedAccessPrincipal,
} from '../photo-ai/access';

export interface TextAccessEnv {
  PHOTO_AI_TEAM_DOMAIN: string;
  PHOTO_AI_ACCOUNT_HMAC_KEY: string;
  TEXT_AI_ACCESS_AUD: string;
  TEXT_AI_ALLOWED_EMAILS: string;
  TEXT_AI_ALLOWED_EMAIL_COUNT: string;
  TEXT_AI_ADMIN_ACCESS_AUD: string;
  TEXT_AI_ADMIN_EMAIL: string;
  TEXT_AI_ADMIN_SERVICE_CLIENT_ID: string;
}

export interface TextAdminAccessConfig extends AccessConfig {
  adminEmail: string;
  serviceClientId: string;
}

export function parseTextUserAccessConfig(env: TextAccessEnv): AccessConfig {
  return parseAccessConfigFields({
    teamDomain: env.PHOTO_AI_TEAM_DOMAIN,
    audience: env.TEXT_AI_ACCESS_AUD,
    allowedEmails: env.TEXT_AI_ALLOWED_EMAILS,
    expectedEmailCount: parseExpectedEmailCount(env.TEXT_AI_ALLOWED_EMAIL_COUNT),
    accountHmacSecret: env.PHOTO_AI_ACCOUNT_HMAC_KEY,
  });
}

export function parseTextAdminAccessConfig(env: TextAccessEnv): TextAdminAccessConfig {
  const config = parseAccessConfigFields({
    teamDomain: env.PHOTO_AI_TEAM_DOMAIN,
    audience: env.TEXT_AI_ADMIN_ACCESS_AUD,
    allowedEmails: env.TEXT_AI_ALLOWED_EMAILS,
    expectedEmailCount: parseExpectedEmailCount(env.TEXT_AI_ALLOWED_EMAIL_COUNT),
    accountHmacSecret: env.PHOTO_AI_ACCOUNT_HMAC_KEY,
  });
  const adminEmail = env.TEXT_AI_ADMIN_EMAIL;
  const serviceClientId = env.TEXT_AI_ADMIN_SERVICE_CLIENT_ID;
  if (typeof adminEmail !== 'string' || !config.allowedEmails.has(adminEmail)) {
    throw new AccessDeniedError();
  }
  if (typeof serviceClientId !== 'string'
    || serviceClientId.length === 0
    || serviceClientId.trim() !== serviceClientId) {
    throw new AccessDeniedError();
  }
  return { ...config, adminEmail, serviceClientId };
}

export async function verifyTextAdminAccess(
  request: Request,
  config: TextAdminAccessConfig,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedAccessPrincipal> {
  try {
    const principal = await verifyAccessPrincipal(request, config, fetcher);
    if (principal.kind === 'user' && principal.email === config.adminEmail) return principal;
    if (principal.kind === 'service' && principal.clientId === config.serviceClientId) return principal;
    throw new AccessDeniedError();
  } catch {
    throw new AccessDeniedError();
  }
}

function parseExpectedEmailCount(value: string): 2 | 3 {
  if (value === '2') return 2;
  if (value === '3') return 3;
  throw new AccessDeniedError();
}

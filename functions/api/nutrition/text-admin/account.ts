import type { TextAiAdminResponse } from '../../../../src/lib/textAiAdminContract';
import {
  authorizeTextAdminPagesRequest,
  proxyTextAdminRequest,
} from '../../../../edge/text-ai/admin';
import type { TextAiPagesEnv } from '../../../../edge/text-ai/pagesProxy';

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;

function failure(code: 'auth-required' | 'service-disabled', status: 401 | 503): Response {
  const body: TextAiAdminResponse = { ok: false, code };
  return new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });
}

export const onRequestPost: PagesFunction<TextAiPagesEnv> = async ({ request, env }) => {
  let authorized;
  try {
    authorized = await authorizeTextAdminPagesRequest(request, env);
  } catch {
    return failure('auth-required', 401);
  }

  try {
    return await proxyTextAdminRequest(env, authorized.accountKey, authorized.request);
  } catch {
    return failure('service-disabled', 503);
  }
};

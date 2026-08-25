import type { TextAiAdminResponse } from '../../../../src/lib/textAiAdminContract';
import { handleTextAdminPagesRequest } from '../../../../edge/text-ai/admin';
import type { TextAiPagesEnv } from '../../../../edge/text-ai/pagesProxy';

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;

function serviceDisabled(): Response {
  const body: TextAiAdminResponse = { ok: false, code: 'service-disabled' };
  return new Response(JSON.stringify(body), { status: 503, headers: SECURITY_HEADERS });
}

export const onRequestPost: PagesFunction<TextAiPagesEnv> = async ({ request, env }) => {
  try {
    return await handleTextAdminPagesRequest(request, env);
  } catch {
    return serviceDisabled();
  }
};

import {
  authorizeTextAiPagesRequest,
  proxyTextAiRequest,
  textAiPagesFailure,
  type TextAiPagesEnv,
} from '../../../../edge/text-ai/pagesProxy';

export const onRequestGet: PagesFunction<TextAiPagesEnv> = async ({ request, env }) => {
  let authorized;
  try {
    authorized = await authorizeTextAiPagesRequest(request, env, ['session']);
  } catch {
    return textAiPagesFailure('auth-required', 401);
  }
  return proxyTextAiRequest(request, env, authorized.accountKey, 'session');
};

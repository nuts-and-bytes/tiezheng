import {
  authorizeTextAiPagesRequest,
  proxyTextAiRequest,
  textAiPagesFailure,
  textAiPagesResumeRedirect,
  type TextAiPagesEnv,
} from '../../../../edge/text-ai/pagesProxy';

export const onRequestGet: PagesFunction<TextAiPagesEnv> = async ({ request, env }) => {
  let authorized;
  try {
    authorized = await authorizeTextAiPagesRequest(request, env, ['session', 'resume']);
  } catch {
    return textAiPagesFailure('auth-required', 401);
  }
  if (authorized.route === 'resume') {
    return textAiPagesResumeRedirect(authorized.origin);
  }
  return proxyTextAiRequest(request, env, authorized.accountKey, 'session');
};

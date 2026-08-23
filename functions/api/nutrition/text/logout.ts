import {
  authorizeTextAiPagesRequest,
  textAiPagesFailure,
  textAiPagesJson,
  type PhotoAiPagesEnv,
} from '../../../../edge/text-ai/pagesProxy';

export const onRequestPost: PagesFunction<PhotoAiPagesEnv> = async ({ request, env }) => {
  try {
    await authorizeTextAiPagesRequest(request, env, ['logout']);
  } catch {
    return textAiPagesFailure('auth-required', 401);
  }
  return textAiPagesJson({ logoutUrl: '/cdn-cgi/access/logout' }, 200);
};

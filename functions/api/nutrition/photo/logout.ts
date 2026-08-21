import {
  authorizePhotoAiPagesRequest,
  photoAiPagesFailure,
  photoAiPagesJson,
  type PhotoAiPagesEnv,
} from '../../../../edge/photo-ai/pagesProxy';

export const onRequestPost: PagesFunction<PhotoAiPagesEnv> = async ({ request, env }) => {
  try {
    await authorizePhotoAiPagesRequest(request, env, ['logout']);
    return photoAiPagesJson({ logoutUrl: '/cdn-cgi/access/logout' }, 200);
  } catch {
    return photoAiPagesFailure('auth-required', 401);
  }
};

import {
  authorizePhotoAiPagesRequest,
  photoAiPagesFailure,
  proxyPhotoAiRequest,
  type PhotoAiPagesEnv,
} from '../../../../edge/photo-ai/pagesProxy';

export const onRequestPost: PagesFunction<PhotoAiPagesEnv> = async ({ request, env }) => {
  try {
    const authorized = await authorizePhotoAiPagesRequest(request, env, ['estimate']);
    return proxyPhotoAiRequest(request, env, authorized.accountKey, 'estimate');
  } catch {
    return photoAiPagesFailure('auth-required', 401);
  }
};

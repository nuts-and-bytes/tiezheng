import {
  authorizePhotoAiPagesRequest,
  photoAiPagesFailure,
  photoAiPagesResumeRedirect,
  proxyPhotoAiRequest,
  type PhotoAiPagesEnv,
} from '../../../../edge/photo-ai/pagesProxy';

export const onRequestGet: PagesFunction<PhotoAiPagesEnv> = async ({ request, env }) => {
  try {
    const authorized = await authorizePhotoAiPagesRequest(
      request,
      env,
      ['session', 'resume'],
    );
    if (authorized.route === 'resume') {
      return photoAiPagesResumeRedirect(authorized.origin);
    }
    return proxyPhotoAiRequest(request, env, authorized.accountKey, 'session');
  } catch {
    return photoAiPagesFailure('auth-required', 401);
  }
};

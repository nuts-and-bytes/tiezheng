import {
  textAiPagesFailure,
  textAiPagesJson,
  type TextAiPagesEnv,
} from '../../../../edge/text-ai/pagesProxy';
import { clearTextSessionCookie } from '../../../../edge/text-ai/auth';
import {
  parseTextPagesRequestConfig,
  validateTextPagesRequest,
} from '../../../../edge/text-ai/pagesRequest';

export const onRequestPost: PagesFunction<TextAiPagesEnv> = async ({ request, env }) => {
  try {
    const config = parseTextPagesRequestConfig({
      PHOTO_AI_PAGES_ORIGIN: env.PHOTO_AI_ALLOWED_ORIGINS,
    });
    const validated = validateTextPagesRequest(request, config);
    if (validated.route !== 'logout') throw new TypeError('Invalid Pages route');
  } catch {
    return textAiPagesFailure('auth-required', 401);
  }
  const response = textAiPagesJson({ ok: true }, 200);
  response.headers.set('set-cookie', clearTextSessionCookie());
  return response;
};

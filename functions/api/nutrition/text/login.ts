import { handleTextLoginRequest } from '../../../../edge/text-ai/login';
import type { TextAiPagesEnv } from '../../../../edge/text-ai/pagesProxy';

export const onRequestPost: PagesFunction<TextAiPagesEnv> = async ({ request, env }) => (
  handleTextLoginRequest(request, env)
);

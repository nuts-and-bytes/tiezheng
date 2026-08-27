import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: [
      'workers/**/*.worker.test.ts',
      'edge/nutrition-ai/**/*.test.ts',
      'edge/photo-ai/access.test.ts',
      'edge/text-ai/access.test.ts',
      'edge/text-ai/pagesRequest.test.ts',
      'edge/text-ai/pagesProxy.test.ts',
      'edge/text-ai/admin.test.ts',
      'edge/photo-ai/pagesProxy.test.ts',
      'edge/photo-ai/pagesRoutes.test.ts',
      'workers/photo-ai-gateway/src/doubaoTextSchema.test.ts',
      'workers/photo-ai-gateway/src/doubaoResponse.test.ts',
      'workers/photo-ai-gateway/src/doubaoTextAdapter.test.ts',
      'workers/photo-ai-gateway/src/doubaoAdapter.test.ts',
      'workers/photo-ai-gateway/src/textAdminHandler.test.ts',
      'workers/photo-ai-gateway/src/textAuthThrottleHandler.test.ts',
      'workers/photo-ai-gateway/src/textHandler.test.ts',
      'workers/photo-ai-gateway/src/handler.test.ts',
    ],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './workers/photo-ai-gateway/wrangler.jsonc',
        },
      },
    },
  },
});

import {
  TEXT_AI_VERSIONS,
  type TextAiEstimateCandidate,
  type TextAiEstimateInFlight,
  type TextAiEstimateRequest,
  type TextAiEstimateSuccess,
  type TextAiFailure,
  type TextAiSessionSuccess,
} from '../lib/textAiContract';

export const textAiCandidateFixture = {
  id: 'text-candidate-1',
  name: '少油牛肉面',
  preparation: '整餐文字估算',
  amountLow: 450,
  amountHigh: 550,
  unit: 'g',
  catalogFoodId: null,
  nutrientSource: 'model-range',
  energyKcalLow: 560,
  energyKcalHigh: 780,
  proteinGLow: 28,
  proteinGHigh: 42,
  assumptions: ['按一碗面、熟牛肉和少量油估算', '未包含额外饮料或小菜'],
} satisfies TextAiEstimateCandidate;

export const textAiRequestFixture: TextAiEstimateRequest = {
  requestId: '11111111-1111-4111-8111-111111111111',
  idempotencyKey: '11111111111141118111111111111111',
  description: '牛肉面一碗，少油',
  amount: { value: 500, unit: 'g' },
  modelVersion: TEXT_AI_VERSIONS.model,
  promptVersion: TEXT_AI_VERSIONS.prompt,
  schemaVersion: TEXT_AI_VERSIONS.schema,
  catalogVersion: TEXT_AI_VERSIONS.catalog,
  uncertaintyVersion: TEXT_AI_VERSIONS.uncertainty,
  providerPolicyVersion: TEXT_AI_VERSIONS.providerPolicy,
  locale: 'zh-CN',
};

export const textAiSessionSuccessFixture = {
  ok: true,
  enabled: true,
  accountRemaining: 10,
  globalRemaining: 30,
  resetAt: '2026-08-22T00:00:00.000Z',
} satisfies TextAiSessionSuccess;

export const textAiEstimateSuccessFixture = {
  ok: true,
  status: 'complete',
  requestId: '11111111-1111-4111-8111-111111111111',
  requestFingerprint: 'a'.repeat(64),
  versions: { ...TEXT_AI_VERSIONS },
  candidates: [
    {
      ...textAiCandidateFixture,
      assumptions: [...textAiCandidateFixture.assumptions],
    },
  ],
} satisfies TextAiEstimateSuccess;

export const textAiEstimateInFlightFixture = {
  ok: true,
  status: 'in-flight',
  requestId: '11111111-1111-4111-8111-111111111111',
  retryAfterMs: 750,
} satisfies TextAiEstimateInFlight;

export const textAiFailureFixture = {
  ok: false,
  code: 'provider-unavailable',
  retryAt: '2026-08-21T12:01:00.000Z',
  resetAt: null,
} satisfies TextAiFailure;

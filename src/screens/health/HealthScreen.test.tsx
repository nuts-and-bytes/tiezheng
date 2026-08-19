import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider, useLocation, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PRESET_FOODS } from '../../data/presetFoods';
import { db } from '../../lib/db';
import { PHOTO_AI_LIMITS } from '../../lib/photoAiContract';
import {
  preparePhoto,
  type PreparedPhoto,
} from '../../lib/photoAiImage';
import {
  PHOTO_AI_LOGIN_PATH,
  savePhotoAiIntent,
  takePhotoAiIntent,
} from '../../lib/photoAiIntent';
import { seedPresetFoods } from '../../repos/foodRepo';
import {
  removeMealItem,
  saveConfirmedFoodItem,
  updateMealItemAmount,
} from '../../repos/mealRepo';
import { resetDb } from '../../test/dbTestUtils';
import { mealItemRow, mealRow, nutritionPlanRow } from '../../test/nutritionFixtures';
import {
  photoAiCatalogCandidateFixture,
  photoAiEstimateSuccessFixture,
  photoAiSessionSuccessFixture,
} from '../../test/photoAiFixtures';
import { HealthScreen } from './HealthScreen';

const photoClient = vi.hoisted(() => ({
  session: vi.fn(),
  estimate: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../../lib/photoAiClient', () => ({
  createPhotoAiClient: () => photoClient,
}));

vi.mock('../../lib/photoAiImage', async () => {
  const actual = await vi.importActual<typeof import('../../lib/photoAiImage')>(
    '../../lib/photoAiImage',
  );
  return { ...actual, preparePhoto: vi.fn() };
});

const mockedPreparePhoto = vi.mocked(preparePhoto);
const PHOTO_FILE = new File(['food-photo'], '午餐.jpg', { type: 'image/jpeg' });

function webp(bytes = 12): Blob {
  const body = new Uint8Array(Math.max(bytes, 12));
  body.set([82, 73, 70, 70], 0);
  body.set([87, 69, 66, 80], 8);
  return new Blob([body], { type: 'image/webp' });
}

function preparedPhoto(): PreparedPhoto {
  return {
    uploadBlob: webp(24),
    uploadBlobSha256: 'c'.repeat(64),
    uploadWidth: 800,
    uploadHeight: 600,
    thumbnailBlob: webp(),
    thumbnailWidth: 160,
    thumbnailHeight: 120,
    dispose: vi.fn(),
  };
}

class TestRequest {
  url: string;
  signal: AbortSignal;
  method: string;
  headers: Headers;

  constructor(input: string | URL, init: RequestInit = {}) {
    this.url = String(input);
    this.signal = init.signal ?? new AbortController().signal;
    this.method = init.method ?? 'GET';
    this.headers = new Headers(init.headers);
  }
}

function RouteProbe() {
  const location = useLocation();
  const historyAction = useNavigationType();
  return <h1>{`今日页探针; ${location.pathname}; ${historyAction}`}</h1>;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-14T08:00:00+08:00'));
  vi.stubGlobal('Request', TestRequest);
  vi.unstubAllEnvs();
  mockedPreparePhoto.mockReset();
  photoClient.session.mockReset().mockResolvedValue(photoAiSessionSuccessFixture);
  photoClient.estimate.mockReset().mockImplementation(async (input: { requestId: string }) => ({
    ...photoAiEstimateSuccessFixture,
    requestId: input.requestId,
    versions: { ...photoAiEstimateSuccessFixture.versions },
    candidates: photoAiEstimateSuccessFixture.candidates.map((candidate) => ({
      ...candidate,
      catalogFoodId:
        candidate.nutrientSource === 'catalog' ? PRESET_FOODS[0].id : candidate.catalogFoodId,
      assumptions: [...candidate.assumptions],
    })),
  }));
  photoClient.logout
    .mockReset()
    .mockResolvedValue({ logoutUrl: '/cdn-cgi/access/logout' as const });
  sessionStorage.clear();
  await resetDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderHealth(initialEntry = '/health', strict = false) {
  const router = createMemoryRouter(
    [
      { path: '/health', element: <HealthScreen /> },
      { path: '/', element: <RouteProbe /> },
    ],
    { initialEntries: [initialEntry] },
  );
  const app = <RouterProvider router={router} />;
  return { ...render(strict ? <StrictMode>{app}</StrictMode> : app), router };
}

async function openLunchPhoto(user: ReturnType<typeof userEvent.setup>) {
  const lunch = await screen.findByRole('region', { name: '午餐' });
  await user.click(within(lunch).getByRole('button', { name: '拍照识别' }));
  await screen.findByText(/清晰拍摄整份食物/);
  return lunch;
}

async function chooseLunchPhoto(
  user: ReturnType<typeof userEvent.setup>,
  value = preparedPhoto(),
) {
  mockedPreparePhoto.mockResolvedValueOnce(value);
  await user.upload(screen.getByLabelText('从相册选择食物照片'), PHOTO_FILE);
  await screen.findByRole('heading', { name: '确认单次上传' });
  return value;
}

test('健康计划位于全屏路由，保留 eyebrow/锻造表面且返回固定 replace 到今日页', async () => {
  const user = userEvent.setup();
  const { router } = renderHealth();

  expect(screen.getByRole('heading', { name: '健康' })).toBeInTheDocument();
  expect(screen.getByText('DAILY NUTRITION')).toBeInTheDocument();
  expect(screen.getByRole('group', { name: '饮食日期' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: '健康计划' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '健康计划' }).closest('.forged-surface')).not.toBeNull();
  expect(document.querySelector('.etch')).not.toBeNull();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '返回今日页' }));

  expect(await screen.findByRole('heading', { name: '今日页探针; /; REPLACE' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');
  expect(router.state.historyAction).toBe('REPLACE');
});

test('组合 live query 加载时不闪现新计划提交表单或伪造餐段', async () => {
  renderHealth();
  expect(screen.getByRole('status', { name: '正在读取健康记录' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存健康计划' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '午餐' })).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: '健康计划' })).toBeInTheDocument();
});

test('照片开关缺失时四餐不显示拍照入口，本地选食物保持可用', async () => {
  await seedPresetFoods();
  const user = userEvent.setup();
  renderHealth();
  const sections = await screen.findAllByRole('region', { name: /^(早餐|午餐|晚餐|加餐)$/ });
  expect(sections).toHaveLength(4);
  expect(screen.queryByRole('button', { name: '拍照识别' })).not.toBeInTheDocument();

  await user.click(within(screen.getByRole('region', { name: '午餐' })).getByRole('button', {
    name: '选择食物',
  }));
  expect(await screen.findByRole('dialog', { name: '选择食物' })).toBeInTheDocument();
});

test('仅 exact true 为四餐添加独立拍照动作，不打开本地 picker', async () => {
  vi.stubEnv('VITE_ENABLE_PHOTO_AI', 'true');
  const user = userEvent.setup();
  renderHealth();
  expect(await screen.findAllByRole('button', { name: '拍照识别' })).toHaveLength(4);

  const lunch = screen.getByRole('region', { name: '午餐' });
  await user.click(within(lunch).getByRole('button', { name: '拍照识别' }));

  expect(await screen.findByRole('dialog', { name: '拍照识别午餐' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: '选择食物' })).not.toBeInTheDocument();
});

test('未登录只保存日期与餐段意图，并导航到固定 session 路径', async () => {
  vi.stubEnv('VITE_ENABLE_PHOTO_AI', 'true');
  photoClient.session.mockResolvedValue({
    ok: false,
    code: 'auth-required',
    retryAt: null,
    resetAt: null,
  });
  const assign = vi.fn();
  vi.stubGlobal('location', { assign });
  const user = userEvent.setup();
  renderHealth();
  const lunch = await screen.findByRole('region', { name: '午餐' });
  await user.click(within(lunch).getByRole('button', { name: '拍照识别' }));
  await user.click(await screen.findByRole('button', { name: '登录后识别' }));

  expect(assign).toHaveBeenCalledWith(PHOTO_AI_LOGIN_PATH);
  expect(takePhotoAiIntent()).toEqual(
    expect.objectContaining({ date: '2026-08-14', slot: 'lunch', version: 1 }),
  );
});

test('resume 一次性消费原日期/餐段意图，并 replace 移除查询参数', async () => {
  vi.stubEnv('VITE_ENABLE_PHOTO_AI', 'true');
  savePhotoAiIntent('2026-08-13', 'dinner');
  const { router } = renderHealth('/health?photoAi=resume', true);

  expect(await screen.findByRole('dialog', { name: '拍照识别晚餐' })).toBeInTheDocument();
  expect(screen.getByText('2026-08-13')).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/health');
  expect(router.state.location.search).toBe('');
  expect(router.state.historyAction).toBe('REPLACE');
  expect(takePhotoAiIntent()).toBeUndefined();
  expect(photoClient.session).toHaveBeenCalledOnce();
});

test.each([
  ['expired', () => savePhotoAiIntent('2026-08-13', 'dinner', Date.now() - PHOTO_AI_LIMITS.intentMs - 1)],
  ['corrupt', () => sessionStorage.setItem('tiezheng:photo-ai:intent:v1', '{broken')],
] as const)('%s resume 不打开照片面板且仍清除查询参数', async (_kind, arrange) => {
  vi.stubEnv('VITE_ENABLE_PHOTO_AI', 'true');
  arrange();
  const { router } = renderHealth('/health?photoAi=resume');

  expect(await screen.findByRole('heading', { name: '健康计划' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: /拍照识别/ })).not.toBeInTheDocument();
  expect(router.state.location.search).toBe('');
  expect(router.state.historyAction).toBe('REPLACE');
});

test('换日会关闭照片面板、释放内存并清除临时估算', async () => {
  vi.stubEnv('VITE_ENABLE_PHOTO_AI', 'true');
  const user = userEvent.setup();
  renderHealth();
  await openLunchPhoto(user);
  const value = await chooseLunchPhoto(user);
  expect(await db.mealEstimates.count()).toBe(1);

  await user.click(screen.getByRole('button', { name: '前一天' }));

  expect(await screen.findByText('2026-08-13')).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: /拍照识别/ })).not.toBeInTheDocument();
  await waitFor(() => expect(value.dispose).toHaveBeenCalledOnce());
  await waitFor(async () => expect(await db.mealEstimates.count()).toBe(0));
});

test('照片候选只经原子确认写入一次，并实时更新餐段与汇总', async () => {
  vi.stubEnv('VITE_ENABLE_PHOTO_AI', 'true');
  await seedPresetFoods();
  const user = userEvent.setup();
  renderHealth();
  const lunch = await openLunchPhoto(user);
  await chooseLunchPhoto(user);
  await user.click(screen.getByRole('button', { name: '同意并开始识别' }));
  await screen.findByRole('heading', { name: '确认识别结果' });
  await user.click(screen.getByRole('button', { name: '确认并加入午餐' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(async () => expect(await db.mealItems.count()).toBe(2));
  expect(await within(lunch).findByText('米饭')).toBeInTheDocument();
  expect(within(lunch).getByText('鸡胸肉')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '今日摄入' })).not.toHaveTextContent(
    '今天还没有已确认食物',
  );
  expect(await db.meals.count()).toBe(1);
});

test('原子确认失败时保留编辑面板，不改变既有条目与汇总', async () => {
  vi.stubEnv('VITE_ENABLE_PHOTO_AI', 'true');
  await seedPresetFoods();
  await saveConfirmedFoodItem({
    operationId: 'existing-rice-before-photo-failure',
    date: '2026-08-14',
    slot: 'lunch',
    food: PRESET_FOODS[0],
    amount: 150,
  });
  photoClient.estimate.mockImplementation(async (input: { requestId: string }) => ({
    ...photoAiEstimateSuccessFixture,
    requestId: input.requestId,
    candidates: [{ ...photoAiCatalogCandidateFixture, catalogFoodId: 'food:missing' }],
  }));
  const user = userEvent.setup();
  renderHealth();
  await openLunchPhoto(user);
  await chooseLunchPhoto(user);
  await user.click(screen.getByRole('button', { name: '同意并开始识别' }));
  await screen.findByRole('heading', { name: '确认识别结果' });
  await user.click(screen.getByRole('button', { name: '确认并加入午餐' }));

  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '确认识别结果' })).toBeInTheDocument();
  expect(await db.mealItems.count()).toBe(1);
  expect(screen.getByRole('region', { name: '今日摄入' })).toHaveTextContent('195 kcal');
});

test('网关关闭仅影响拍照面板，预设食物仍可正常保存', async () => {
  vi.stubEnv('VITE_ENABLE_PHOTO_AI', 'true');
  photoClient.session.mockResolvedValue({
    ok: false,
    code: 'service-disabled',
    retryAt: null,
    resetAt: null,
  });
  await seedPresetFoods();
  const user = userEvent.setup();
  renderHealth();
  const lunch = await screen.findByRole('region', { name: '午餐' });
  await user.click(within(lunch).getByRole('button', { name: '拍照识别' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('图片识别服务当前未开启');
  await user.click(screen.getByRole('button', { name: '改用手动记录' }));

  await user.click(within(lunch).getByRole('button', { name: '选择食物' }));
  await user.click(await screen.findByRole('button', { name: '熟米饭' }));
  await user.clear(screen.getByLabelText('实际克数'));
  await user.type(screen.getByLabelText('实际克数'), '150');
  await user.click(screen.getByRole('button', { name: '加入午餐' }));

  expect(await within(lunch).findByText(/195 kcal/)).toBeInTheDocument();
  expect(await db.mealItems.count()).toBe(1);
});

test('四餐按 repo 固定顺序渲染，通过真实 repo 记录 150 g 米饭并刷新汇总', async () => {
  await seedPresetFoods();
  const user = userEvent.setup();
  renderHealth();
  const sections = await screen.findAllByRole('region', {
    name: /^(早餐|午餐|晚餐|加餐)$/,
  });
  expect(sections.map((section) => within(section).getByRole('heading').textContent)).toEqual([
    '早餐',
    '午餐',
    '晚餐',
    '加餐',
  ]);
  expect(sections.every((section) => section.classList.contains('forged-surface'))).toBe(true);

  const lunch = screen.getByRole('region', { name: '午餐' });
  await user.click(within(lunch).getByRole('button', { name: '选择食物' }));
  await user.click(screen.getByRole('button', { name: '熟米饭' }));
  await user.clear(screen.getByLabelText('实际克数'));
  await user.type(screen.getByLabelText('实际克数'), '150');
  await user.click(screen.getByRole('button', { name: '加入午餐' }));

  expect(await within(lunch).findByText(/195 kcal/)).toBeInTheDocument();
  const intake = screen.getByRole('region', { name: '今日摄入' });
  expect(await within(intake).findByText(/195 kcal/)).toBeInTheDocument();
  expect(intake).toHaveClass('forged-surface');
  expect(await db.mealItems.count()).toBe(1);
  expect(await db.mealItems.toArray()).toEqual([
    expect.objectContaining({ name: '熟米饭', amount: 150, energyKcalLow: 195 }),
  ]);
  expect(screen.queryByText(/分数|惩罚|热量达标|卡路里达标|失败/)).not.toBeInTheDocument();
});

test('真实 DB 外部写入、改量和删除都经 live query 刷新餐段与今日摄入', async () => {
  renderHealth();
  const lunch = await screen.findByRole('region', { name: '午餐' });
  let itemId = '';

  await act(async () => {
    const saved = await saveConfirmedFoodItem({
      operationId: 'health-live-rice',
      date: '2026-08-14',
      slot: 'lunch',
      food: PRESET_FOODS[0],
      amount: 150,
    });
    itemId = saved.id;
  });
  expect(await within(lunch).findByText(/195 kcal/)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '今日摄入' })).toHaveTextContent('195 kcal');

  await act(async () => {
    await updateMealItemAmount(itemId, 200);
  });
  await waitFor(() => expect(lunch).toHaveTextContent('260 kcal'));
  expect(screen.getByRole('region', { name: '今日摄入' })).toHaveTextContent('260 kcal');

  await act(async () => {
    await removeMealItem(itemId);
  });
  await waitFor(() => expect(lunch).toHaveTextContent('尚未记录'));
  expect(screen.getByRole('region', { name: '今日摄入' })).toHaveTextContent(
    '今天还没有已确认食物',
  );
});

test('持久计划卡持续展示双目标范围、来源、体重依据日期、blocker 和固定声明', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const base = nutritionPlanRow();
  const active = nutritionPlanRow({
    safetyInputs: {
      ...base.safetyInputs,
      basisWeightKg: 80,
      basisWeightDate: '2026-08-14',
      eligibilityBlockers: [],
    },
  });
  await db.nutritionPlans.put(active);
  renderHealth();
  const card = await screen.findByRole('region', { name: '当前健康计划' });
  expect(card).toHaveTextContent(/蛋白质建议：\d+–\d+ g/);
  expect(card).toHaveTextContent(/热量建议：\d+–\d+ kcal/);
  expect(card).toHaveTextContent('当前目标按 2026-08-14 的 80.0 kg 估算');
  expect(card).toHaveTextContent('蛋白质来源：ISSN · JISSN-2017-14-20');
  expect(card).toHaveTextContent('热量来源：NASEM 2023 成人 EER');
  expect(card).toHaveTextContent('不构成医疗诊断或治疗建议，也不保证');

  await act(async () => {
    await db.nutritionPlans.put({
      ...active,
      safetyInputs: {
        ...active.safetyInputs,
        eligibilityBlockers: ['fat-loss-bmi-ineligible'],
      },
      targetRanges: {
        ...active.targetRanges,
        energyLowKcal: null,
        energyHighKcal: null,
        energyRawLowKcal: null,
        energyRawHighKcal: null,
      },
      targetMode: {
        ...active.targetMode,
        energy: 'disabled',
        evaluationPolicy: 'protein-range',
        reason: 'active',
      },
      updatedAt: active.updatedAt + 1,
    });
  });
  expect(await screen.findByTestId('blocker-fat-loss-bmi-ineligible')).toHaveTextContent(
    '当前 BMI 不在首阶段自动热量估算范围',
  );
  expect(screen.getByRole('region', { name: '当前健康计划' })).toHaveTextContent(
    '热量建议：暂不自动估算',
  );
});

test('current kill switch 压过历史 active 快照，计划卡和评价只显示记录态', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  await db.nutritionPlans.put(nutritionPlanRow());
  renderHealth();

  const card = await screen.findByRole('region', { name: '当前健康计划' });
  expect(card).toHaveTextContent('当前状态：仅记录饮食');
  expect(card).toHaveTextContent('自动目标评价未开启');
  expect(card).not.toHaveTextContent(
    /蛋白质建议|热量建议|计算依据|蛋白质来源|热量来源|减脂节奏|ISSN|NASEM/,
  );
  expect(screen.getByLabelText('今日目标状态')).toHaveTextContent('目标评价未开启');
});

test('切换日期会 remount 计划表单并清空未保存的体重确认', async () => {
  const user = userEvent.setup();
  renderHealth();
  await user.click(await screen.findByLabelText('增肌'));
  await user.type(screen.getByLabelText('当前体重（公斤）'), '80');
  await user.click(screen.getByLabelText('确认使用这条体重'));
  await user.click(screen.getByRole('button', { name: '前一天' }));

  expect(await screen.findByText('2026-08-13')).toBeInTheDocument();
  expect(await screen.findByLabelText('增肌')).not.toBeChecked();
  await user.click(screen.getByLabelText('增肌'));
  expect(screen.getByLabelText('当前体重（公斤）')).toHaveValue(null);
  expect(screen.getByLabelText('确认使用这条体重')).not.toBeChecked();
});

test.each([
  ['protein', '建议范围', '当前估算'],
  ['energy', '当前估算', '蛋白质相对建议范围'],
  ['both', '建议范围', '不存在的惩罚文案'],
  ['overlap', '重叠', '不存在的惩罚文案'],
] as const)('%s 模式只渲染独立中性评价', async (mode, copy, absent) => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const plan = nutritionPlanRow({
    id: 'nutrition-plan:2026-08-14',
    effectiveFrom: '2026-08-14',
  });
  if (mode === 'protein') {
    plan.targetMode = {
      ...plan.targetMode,
      protein: 'range',
      energy: 'disabled',
      evaluationPolicy: 'protein-range',
    };
    plan.targetRanges = {
      ...plan.targetRanges,
      energyLowKcal: null,
      energyHighKcal: null,
      energyRawLowKcal: null,
      energyRawHighKcal: null,
    };
  } else if (mode === 'energy') {
    plan.targetMode = {
      ...plan.targetMode,
      protein: 'disabled',
      energy: 'range',
      evaluationPolicy: 'energy-relative',
    };
    plan.targetRanges = {
      ...plan.targetRanges,
      proteinLowG: null,
      proteinHighG: null,
      proteinReferenceG: null,
      proteinLowCoefficient: null,
      proteinHighCoefficient: null,
      proteinReferenceCoefficient: null,
    };
  }
  await db.nutritionPlans.put(plan);
  await db.meals.put(
    mealRow({ id: 'meal:2026-08-14:lunch', date: '2026-08-14', slot: 'lunch' }),
  );
  await db.mealItems.put(
    mealItemRow({
      mealId: 'meal:2026-08-14:lunch',
      energyKcalLow: 195,
      energyKcalHigh: mode === 'overlap' ? plan.targetRanges.energyHighKcal! : 195,
      proteinGLow: 4.035,
      proteinGHigh: mode === 'overlap' ? plan.targetRanges.proteinHighG! : 4.035,
      quality: mode === 'overlap' ? 'B' : 'A',
    }),
  );
  renderHealth();
  const status = await screen.findByLabelText('今日目标状态');
  expect(status).toHaveTextContent(copy);
  expect(status).not.toHaveTextContent(absent);
  expect(status).not.toHaveTextContent(/分数|惩罚|热量达标|卡路里达标|失败/);
});

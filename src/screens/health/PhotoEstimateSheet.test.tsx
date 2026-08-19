import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, type ComponentProps } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PRESET_FOODS } from '../../data/presetFoods';
import {
  PHOTO_AI_LIMITS,
  PHOTO_AI_PROVIDER_POLICY_URL,
  PHOTO_AI_VERSIONS,
  type PhotoAiFailure,
  type PhotoAiEstimateResponse,
} from '../../lib/photoAiContract';
import type { PhotoAiClient } from '../../lib/photoAiClient';
import {
  preparePhoto,
  type PreparedPhoto,
} from '../../lib/photoAiImage';
import {
  photoAiCatalogCandidateFixture,
  photoAiEstimateSuccessFixture,
  photoAiModelRangeCandidateFixture,
  photoAiNoNutrientCandidateFixture,
  photoAiSessionSuccessFixture,
} from '../../test/photoAiFixtures';
import { PhotoEstimateSheet } from './PhotoEstimateSheet';

vi.mock('../../lib/photoAiImage', async () => {
  const actual = await vi.importActual<typeof import('../../lib/photoAiImage')>(
    '../../lib/photoAiImage',
  );
  return { ...actual, preparePhoto: vi.fn() };
});

const mockedPreparePhoto = vi.mocked(preparePhoto);
const FILE = new File(['food-photo'], '午餐.jpg', { type: 'image/jpeg' });

function webp(bytes = 12): Blob {
  const body = new Uint8Array(Math.max(bytes, 12));
  body.set([82, 73, 70, 70], 0);
  body.set([87, 69, 66, 80], 8);
  return new Blob([body], { type: 'image/webp' });
}

function prepared(): PreparedPhoto {
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

function fakeClient(overrides: Partial<PhotoAiClient> = {}): PhotoAiClient {
  return {
    session: vi.fn().mockResolvedValue(photoAiSessionSuccessFixture),
    estimate: vi.fn().mockResolvedValue(photoAiEstimateSuccessFixture),
    logout: vi.fn().mockResolvedValue({ logoutUrl: '/cdn-cgi/access/logout' as const }),
    ...overrides,
  };
}

function sheet(overrides: Partial<ComponentProps<typeof PhotoEstimateSheet>> = {}) {
  const client = overrides.client ?? fakeClient();
  const onLogin = overrides.onLogin ?? vi.fn();
  const onPutEstimate = overrides.onPutEstimate ?? vi.fn().mockResolvedValue(undefined);
  const onClearEstimate = overrides.onClearEstimate ?? vi.fn().mockResolvedValue(undefined);
  const onConfirm = overrides.onConfirm ?? vi.fn().mockResolvedValue(undefined);
  const onClose = overrides.onClose ?? vi.fn();
  const view = render(
    <PhotoEstimateSheet
      date="2026-08-14"
      slot="lunch"
      foods={PRESET_FOODS}
      client={client}
      onLogin={onLogin}
      onPutEstimate={onPutEstimate}
      onClearEstimate={onClearEstimate}
      onConfirm={onConfirm}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...view, client, onLogin, onPutEstimate, onClearEstimate, onConfirm, onClose };
}

async function reachSource() {
  return screen.findByRole('dialog', { name: '拍照识别午餐' });
}

async function choosePhoto(user: ReturnType<typeof userEvent.setup>, value = prepared()) {
  mockedPreparePhoto.mockResolvedValueOnce(value);
  await user.upload(screen.getByLabelText('从相册选择食物照片'), FILE);
  await screen.findByRole('heading', { name: '确认单次上传' });
  return value;
}

async function reachCandidates(user: ReturnType<typeof userEvent.setup>) {
  const value = await choosePhoto(user);
  await user.click(screen.getByRole('button', { name: '同意并开始识别' }));
  await screen.findByRole('heading', { name: '确认识别结果' });
  return value;
}

beforeEach(() => {
  document.body.style.overflow = '';
  mockedPreparePhoto.mockReset();
  vi.spyOn(globalThis.crypto, 'randomUUID')
    .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
    .mockReturnValue('22222222-2222-4222-8222-222222222222');
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.style.overflow = '';
});

test('复用铁证面板、焦点陷阱、滚动锁、Escape 回焦与 reduced-motion', async () => {
  const opener = document.createElement('button');
  opener.textContent = '打开识别';
  document.body.append(opener);
  opener.focus();
  const { onClose, unmount } = sheet();
  const dialog = await reachSource();

  expect(dialog).toHaveClass('forged-surface');
  expect(dialog).toHaveClass('motion-reduce:transition-none');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
  unmount();
  expect(document.activeElement).toBe(opener);
  expect(document.body.style.overflow).toBe('');
  opener.remove();
});

test('清晰拍照提示先于两个入口，相机有 capture 而相册没有', async () => {
  const { container } = sheet();
  await reachSource();
  expect(screen.getByText(/清晰拍摄整份食物/)).toBeInTheDocument();
  const camera = screen.getByLabelText('拍摄食物照片');
  const library = screen.getByLabelText('从相册选择食物照片');
  expect(camera).toHaveAttribute('accept', 'image/*');
  expect(camera).toHaveAttribute('capture', 'environment');
  expect(library).toHaveAttribute('accept', 'image/*');
  expect(library).not.toHaveAttribute('capture');
  expect(container.querySelectorAll('input[type="file"]')).toHaveLength(2);
});

test.each([
  ['service-disabled', '图片识别服务当前未开启'],
  ['quota-exceeded', '次数已用完'],
  ['budget-exceeded', '今日额度已用完'],
  ['rate-limited', '请求过于频繁'],
] as const)('session %s 显示页内错误且保留手动退出', async (code, copy) => {
  const failure: PhotoAiFailure = { ok: false, code, retryAt: null, resetAt: null };
  const onClose = vi.fn();
  sheet({ client: fakeClient({ session: vi.fn().mockResolvedValue(failure) }), onClose });
  expect(await screen.findByRole('alert')).toHaveTextContent(copy);
  await userEvent.click(screen.getByRole('button', { name: '改用手动记录' }));
  expect(onClose).toHaveBeenCalledOnce();
});

test('未登录只调用固定登录出口；已登录可请求固定 Cloudflare 退出路径', async () => {
  const user = userEvent.setup();
  const authFailure: PhotoAiFailure = {
    ok: false,
    code: 'auth-required',
    retryAt: null,
    resetAt: null,
  };
  const onLogin = vi.fn();
  const first = sheet({
    client: fakeClient({ session: vi.fn().mockResolvedValue(authFailure) }),
    onLogin,
  });
  await user.click(await screen.findByRole('button', { name: '登录后识别' }));
  expect(onLogin).toHaveBeenCalledOnce();
  first.unmount();

  const logout = vi.fn().mockResolvedValue({ logoutUrl: '/cdn-cgi/access/logout' as const });
  sheet({ client: fakeClient({ logout }) });
  await reachSource();
  await user.click(screen.getByRole('button', { name: '退出照片识别登录' }));
  await waitFor(() => expect(logout).toHaveBeenCalledOnce());
  expect(await screen.findByRole('link', { name: '继续退出照片识别登录' })).toHaveAttribute(
    'href',
    '/cdn-cgi/access/logout',
  );
});

test('单次授权文案完整，取消会清状态、释放内存且不请求识别', async () => {
  const user = userEvent.setup();
  const client = fakeClient();
  const onClearEstimate = vi.fn().mockResolvedValue(undefined);
  sheet({ client, onClearEstimate });
  await reachSource();
  const value = await choosePhoto(user);

  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Cloudflare');
  expect(dialog).toHaveTextContent('火山方舟');
  expect(dialog).toHaveTextContent('铁证不会保存原始照片');
  expect(dialog).toHaveTextContent('第三方日志保留时间未知');
  expect(dialog).toHaveTextContent(`${PHOTO_AI_LIMITS.consentMs / 60_000} 分钟`);
  expect(screen.getByRole('link', { name: '查看服务商隐私政策' })).toHaveAttribute(
    'href',
    PHOTO_AI_PROVIDER_POLICY_URL,
  );
  await user.click(screen.getByRole('button', { name: '取消这张照片' }));
  await waitFor(() => expect(onClearEstimate).toHaveBeenCalledWith('meal:2026-08-14:lunch'));
  expect(value.dispose).toHaveBeenCalledOnce();
  expect(client.estimate).not.toHaveBeenCalled();
  expect(await screen.findByText(/清晰拍摄整份食物/)).toBeInTheDocument();
});

test('取消清理进行中不能并发启动上传', async () => {
  const user = userEvent.setup();
  let resolveClear!: () => void;
  const onClearEstimate = vi.fn(
    () => new Promise<void>((resolve) => {
      resolveClear = resolve;
    }),
  );
  const estimate = vi.fn().mockResolvedValue(photoAiEstimateSuccessFixture);
  const onPutEstimate = vi.fn().mockResolvedValue(undefined);
  sheet({ client: fakeClient({ estimate }), onClearEstimate, onPutEstimate });
  await reachSource();
  await choosePhoto(user);

  await user.click(screen.getByRole('button', { name: '取消这张照片' }));
  await user.click(screen.getByRole('button', { name: '同意并开始识别' }));

  expect(onClearEstimate).toHaveBeenCalledOnce();
  expect(estimate).not.toHaveBeenCalled();
  expect(onPutEstimate.mock.calls.map(([row]) => row.status)).toEqual(['awaiting-consent']);
  await act(async () => resolveClear());
  expect(await screen.findByText(/清晰拍摄整份食物/)).toBeInTheDocument();
});

test('关闭已持久化的识别会先清理再退出', async () => {
  const user = userEvent.setup();
  let resolveClear!: () => void;
  const onClearEstimate = vi.fn(
    () => new Promise<void>((resolve) => {
      resolveClear = resolve;
    }),
  );
  const onClose = vi.fn();
  sheet({ onClearEstimate, onClose });
  await reachSource();
  const value = await choosePhoto(user);

  await user.click(screen.getByRole('button', { name: '关闭照片识别' }));
  expect(onClearEstimate).toHaveBeenCalledWith('meal:2026-08-14:lunch');
  expect(onClose).not.toHaveBeenCalled();
  expect(value.dispose).not.toHaveBeenCalled();

  await act(async () => resolveClear());
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(value.dispose).toHaveBeenCalledOnce();
});

test('外部卸载也会清理已持久化的识别', async () => {
  const user = userEvent.setup();
  const onClearEstimate = vi.fn().mockResolvedValue(undefined);
  const view = sheet({ onClearEstimate });
  await reachSource();
  const value = await choosePhoto(user);

  view.unmount();

  await waitFor(() =>
    expect(onClearEstimate).toHaveBeenCalledWith('meal:2026-08-14:lunch'),
  );
  expect(value.dispose).toHaveBeenCalledOnce();
});

test('卸载期清理失败不会产生未处理拒绝', async () => {
  const user = userEvent.setup();
  const onClearEstimate = vi.fn().mockRejectedValue(new Error('卸载期清理失败'));
  const view = sheet({ onClearEstimate });
  await reachSource();
  await choosePhoto(user);

  view.unmount();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(onClearEstimate).toHaveBeenCalledOnce();
});

test('上传失败与关闭交错时不会在清理后重写 failed', async () => {
  const user = userEvent.setup();
  let rejectEstimate!: (reason: Error) => void;
  const estimate = vi.fn(
    () => new Promise<PhotoAiEstimateResponse>((_resolve, reject) => {
      rejectEstimate = reject;
    }),
  );
  const onPutEstimate = vi.fn().mockResolvedValue(undefined);
  const onClearEstimate = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  sheet({
    client: fakeClient({ estimate }),
    onPutEstimate,
    onClearEstimate,
    onClose,
  });
  await reachSource();
  await choosePhoto(user);
  await user.click(screen.getByRole('button', { name: '同意并开始识别' }));
  await waitFor(() => expect(estimate).toHaveBeenCalledOnce());

  await user.click(screen.getByRole('button', { name: '关闭照片识别' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  await act(async () => rejectEstimate(new Error('模型进程已结束')));

  expect(onClearEstimate).toHaveBeenCalledOnce();
  expect(onPutEstimate.mock.calls.map(([row]) => row.status)).toEqual([
    'awaiting-consent',
    'uploading',
    'estimating',
  ]);
});

test('上传复用同一 request/key/hash，双击门闩且按精确状态顺序持久化', async () => {
  const user = userEvent.setup();
  let resolveEstimate!: (value: PhotoAiEstimateResponse) => void;
  const estimate: PhotoAiClient['estimate'] = vi.fn(
    () => new Promise<PhotoAiEstimateResponse>((resolve) => {
      resolveEstimate = resolve;
    }),
  );
  const onPutEstimate = vi.fn().mockResolvedValue(undefined);
  sheet({ client: fakeClient({ estimate }), onPutEstimate });
  await reachSource();
  const value = await choosePhoto(user);
  const upload = screen.getByRole('button', { name: '同意并开始识别' });
  await user.dblClick(upload);

  await waitFor(() => expect(estimate).toHaveBeenCalledOnce());
  expect(estimate).toHaveBeenCalledWith({
    requestId: expect.any(String),
    idempotencyKey: expect.stringMatching(/^[a-f0-9]{32}$/),
    uploadBlobSha256: value.uploadBlobSha256,
    uploadBlob: value.uploadBlob,
  });
  expect(onPutEstimate.mock.calls.map(([row]) => row.status)).toEqual([
    'awaiting-consent',
    'uploading',
    'estimating',
  ]);
  await act(async () =>
    resolveEstimate({
      ...photoAiEstimateSuccessFixture,
      versions: { ...photoAiEstimateSuccessFixture.versions },
      candidates: photoAiEstimateSuccessFixture.candidates.map((candidate) => ({
        ...candidate,
        assumptions: [...candidate.assumptions],
      })),
    }),
  );
  await waitFor(() =>
    expect(onPutEstimate.mock.calls.map(([row]) => row.status)).toEqual([
      'awaiting-consent',
      'uploading',
      'estimating',
      'needs-confirmation',
    ]),
  );
  await screen.findByRole('heading', { name: '确认识别结果' });
});

test('最多六项，none 不可确认，目录/模型来源与高不确定性可见且无置信度', async () => {
  const user = userEvent.setup();
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    ...(index === 0
      ? photoAiCatalogCandidateFixture
      : index === 5
        ? photoAiNoNutrientCandidateFixture
        : photoAiModelRangeCandidateFixture),
    id: `candidate-${index}`,
    name: `候选 ${index + 1}`,
  }));
  const client = fakeClient({
    estimate: vi.fn().mockResolvedValue({
      ...photoAiEstimateSuccessFixture,
      candidates,
    }),
  });
  sheet({ client });
  await reachSource();
  await reachCandidates(user);

  expect(screen.getAllByRole('group', { name: /候选/ })).toHaveLength(6);
  expect(screen.getByText(/本地食物目录/)).toBeInTheDocument();
  expect(screen.getAllByText(/模型区间估算/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/估算不确定性较高/).length).toBeGreaterThan(0);
  expect(screen.getByText(/无法直接确认，请手动记录/)).toBeInTheDocument();
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('启用候选 6')).toBeDisabled();
});

test('候选可删除、改名称/做法/份量/假设；原子保存成功后才关闭', async () => {
  const user = userEvent.setup();
  let resolveConfirm!: () => void;
  const onConfirm = vi.fn(
    () => new Promise<void>((resolve) => {
      resolveConfirm = resolve;
    }),
  );
  const onClose = vi.fn();
  sheet({ onConfirm, onClose });
  await reachSource();
  const value = await reachCandidates(user);

  await user.click(screen.getByRole('button', { name: '删除候选 自制酱汁' }));
  const rice = screen.getByRole('group', { name: '候选 米饭' });
  await user.clear(within(rice).getByLabelText('食物名称'));
  await user.type(within(rice).getByLabelText('食物名称'), '糙米饭');
  await user.clear(within(rice).getByLabelText('处理方式'));
  await user.type(within(rice).getByLabelText('处理方式'), '蒸熟');
  await user.clear(within(rice).getByLabelText('实际数量'));
  await user.type(within(rice).getByLabelText('实际数量'), '160');
  await user.type(within(rice).getByLabelText('确认说明'), '，碗较深');
  await user.click(screen.getByRole('button', { name: '确认并加入午餐' }));

  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  expect(onClose).not.toHaveBeenCalled();
  expect(onConfirm).toHaveBeenCalledWith(
    expect.objectContaining({
      date: '2026-08-14',
      slot: 'lunch',
      uploadBlobSha256: value.uploadBlobSha256,
      thumbnail: {
        blob: value.thumbnailBlob,
        width: value.thumbnailWidth,
        height: value.thumbnailHeight,
      },
      candidates: expect.arrayContaining([
        expect.objectContaining({
          confirmedName: '糙米饭',
          confirmedPreparation: '蒸熟',
          confirmedAmount: 160,
        }),
      ]),
    }),
  );
  await act(async () => resolveConfirm());
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(value.dispose).toHaveBeenCalledOnce();
});

test('确认前拦截超长名称，空确认说明不写入空字符串', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  sheet({ onConfirm });
  await reachSource();
  await reachCandidates(user);
  await user.click(screen.getByRole('button', { name: '删除候选 自制酱汁' }));
  const rice = screen.getByRole('group', { name: '候选 米饭' });
  const name = within(rice).getByLabelText('食物名称');
  fireEvent.change(name, { target: { value: '名'.repeat(121) } });
  await user.click(screen.getByRole('button', { name: '确认并加入午餐' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('请检查食物名称和实际数量');
  expect(onConfirm).not.toHaveBeenCalled();

  await user.clear(name);
  await user.type(name, '米饭');
  const assumptions = within(rice).getByLabelText('确认说明');
  await user.clear(assumptions);
  await user.click(screen.getByRole('button', { name: '确认并加入午餐' }));

  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  expect(onConfirm.mock.calls[0]?.[0].candidates[0]?.confirmedAssumptions).toEqual([]);
});

test('保存失败保持候选可编辑、可重试且不调用 window.alert', async () => {
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  const onConfirm = vi
    .fn()
    .mockRejectedValueOnce(new Error('本地原子保存失败'))
    .mockResolvedValue(undefined);
  const user = userEvent.setup();
  sheet({ onConfirm });
  await reachSource();
  await reachCandidates(user);
  const submit = screen.getByRole('button', { name: '确认并加入午餐' });

  await user.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent('本地原子保存失败');
  expect(
    within(screen.getByRole('group', { name: '候选 米饭' })).getByLabelText('食物名称'),
  ).toBeEnabled();
  expect(alertSpy).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '重试保存' }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
});

test('StrictMode 异步失败后可重试，不会留下永久门闩', async () => {
  const session = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      code: 'offline',
      retryAt: null,
      resetAt: null,
    })
    .mockResolvedValue(photoAiSessionSuccessFixture);
  render(
    <StrictMode>
      <PhotoEstimateSheet
        date="2026-08-14"
        slot="lunch"
        foods={PRESET_FOODS}
        client={fakeClient({ session })}
        onLogin={vi.fn()}
        onPutEstimate={vi.fn().mockResolvedValue(undefined)}
        onClearEstimate={vi.fn().mockResolvedValue(undefined)}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    </StrictMode>,
  );
  const retry = await screen.findByRole('button', { name: '重试检查' });
  await userEvent.click(retry);
  expect(await screen.findByText(/清晰拍摄整份食物/)).toBeInTheDocument();
  expect(session.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test('服务返回的版本仍保留在 needs-confirmation 上下文，不由 UI 改写', async () => {
  const user = userEvent.setup();
  const onPutEstimate = vi.fn().mockResolvedValue(undefined);
  sheet({ onPutEstimate });
  await reachSource();
  await reachCandidates(user);
  const needs = onPutEstimate.mock.calls.find(([row]) => row.status === 'needs-confirmation')?.[0];
  expect(needs.requestFingerprint).toBe(photoAiEstimateSuccessFixture.requestFingerprint);
  expect(photoAiEstimateSuccessFixture.versions).toEqual(PHOTO_AI_VERSIONS);
});

test('client 抛错会持久化 failed，不能把本地状态卡在 estimating', async () => {
  const user = userEvent.setup();
  const onPutEstimate = vi.fn().mockResolvedValue(undefined);
  sheet({
    client: fakeClient({
      estimate: vi.fn().mockRejectedValue(new Error('provider transport exploded')),
    }),
    onPutEstimate,
  });
  await reachSource();
  await choosePhoto(user);
  await user.click(screen.getByRole('button', { name: '同意并开始识别' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('provider transport exploded');
  expect(onPutEstimate.mock.calls.map(([row]) => row.status)).toEqual([
    'awaiting-consent',
    'uploading',
    'estimating',
    'failed',
  ]);
  expect(onPutEstimate.mock.lastCall?.[0]).toEqual(
    expect.objectContaining({
      status: 'failed',
      candidates: [],
      requestFingerprint: null,
      error: 'provider-unavailable',
    }),
  );
});

test('授权在进入模型前过期会清除本地同意且绝不调用 estimate', async () => {
  const user = userEvent.setup();
  let wall = Date.parse('2026-08-14T12:00:00.000Z');
  vi.spyOn(Date, 'now').mockImplementation(() => wall);
  const estimate = vi.fn().mockResolvedValue(photoAiEstimateSuccessFixture);
  const onClearEstimate = vi.fn().mockResolvedValue(undefined);
  const onPutEstimate = vi.fn().mockImplementation(async (row) => {
    if (row.status === 'uploading') wall += PHOTO_AI_LIMITS.consentMs + 1;
  });
  sheet({ client: fakeClient({ estimate }), onPutEstimate, onClearEstimate });
  await reachSource();
  await choosePhoto(user);
  await user.click(screen.getByRole('button', { name: '同意并开始识别' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('授权已过期');
  expect(onClearEstimate).toHaveBeenCalledOnce();
  expect(onClearEstimate).toHaveBeenCalledWith('meal:2026-08-14:lunch');
  expect(estimate).not.toHaveBeenCalled();
  expect(onPutEstimate.mock.calls.map(([row]) => row.status)).toEqual([
    'awaiting-consent',
    'uploading',
  ]);
});

test('取消与失败重启都有同步门闩，资源只释放一次', async () => {
  const user = userEvent.setup();
  let resolveClear!: () => void;
  const onClearEstimate = vi.fn(
    () => new Promise<void>((resolve) => {
      resolveClear = resolve;
    }),
  );
  sheet({ onClearEstimate });
  await reachSource();
  const value = await choosePhoto(user);
  await user.dblClick(screen.getByRole('button', { name: '取消这张照片' }));
  expect(onClearEstimate).toHaveBeenCalledOnce();
  await act(async () => resolveClear());
  await screen.findByText(/清晰拍摄整份食物/);
  expect(value.dispose).toHaveBeenCalledOnce();
});

test('失败后的重新确认上传只能创建一次新请求', async () => {
  const user = userEvent.setup();
  const failure: PhotoAiFailure = {
    ok: false,
    code: 'provider-unavailable',
    retryAt: null,
    resetAt: null,
  };
  let resolveClear!: () => void;
  const onClearEstimate = vi.fn(
    () => new Promise<void>((resolve) => {
      resolveClear = resolve;
    }),
  );
  const onPutEstimate = vi.fn().mockResolvedValue(undefined);
  sheet({
    client: fakeClient({ estimate: vi.fn().mockResolvedValue(failure) }),
    onPutEstimate,
    onClearEstimate,
  });
  await reachSource();
  await choosePhoto(user);
  await user.click(screen.getByRole('button', { name: '同意并开始识别' }));
  const restart = await screen.findByRole('button', { name: '重新确认上传' });
  await user.dblClick(restart);
  expect(onClearEstimate).toHaveBeenCalledOnce();
  await act(async () => resolveClear());
  await screen.findByRole('heading', { name: '确认单次上传' });
  expect(onPutEstimate.mock.calls.filter(([row]) => row.status === 'awaiting-consent')).toHaveLength(2);
});

test('伪造客户端返回第七项时 fail closed，不渲染或提交部分结果', async () => {
  const user = userEvent.setup();
  const candidates = Array.from({ length: 7 }, (_, index) => ({
    ...photoAiModelRangeCandidateFixture,
    id: `forged-${index}`,
    name: `伪造候选 ${index + 1}`,
    assumptions: [...photoAiModelRangeCandidateFixture.assumptions],
  }));
  const onPutEstimate = vi.fn().mockResolvedValue(undefined);
  sheet({
    client: fakeClient({
      estimate: vi.fn().mockResolvedValue({
        ...photoAiEstimateSuccessFixture,
        candidates,
      }),
    }),
    onPutEstimate,
  });
  await reachSource();
  await choosePhoto(user);
  await user.click(screen.getByRole('button', { name: '同意并开始识别' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('识别结果无效');
  expect(screen.queryAllByRole('group', { name: /候选/ })).toHaveLength(0);
  expect(onPutEstimate.mock.lastCall?.[0]).toEqual(
    expect.objectContaining({ status: 'failed', error: 'invalid-estimate', candidates: [] }),
  );
});

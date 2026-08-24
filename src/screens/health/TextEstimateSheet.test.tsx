import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { TextAiClient, TextAiEstimateInput } from '../../lib/textAiClient';
import {
  textAiErrorCopy,
  type TextAiErrorCode,
  type TextAiEstimateResponse,
  type TextAiFailure,
  type TextAiSessionResponse,
  type TextMealDraft,
} from '../../lib/textAiContract';
import type { ConfirmTextEstimateInput } from '../../repos/mealRepo';
import {
  textAiEstimateInFlightFixture,
  textAiEstimateSuccessFixture,
  textAiSessionSuccessFixture,
} from '../../test/textAiFixtures';
import { TextEstimateSheet } from './TextEstimateSheet';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const THIRD_REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const DESCRIPTION = '牛肉面一碗，少油';

function failure(code: TextAiErrorCode): TextAiFailure {
  return { ok: false, code, retryAt: null, resetAt: null };
}

interface RenderOptions {
  client?: TextAiClient;
  estimateResponse?: TextAiEstimateResponse;
  sessionResponse?: TextAiSessionResponse;
  initialDraft?: TextMealDraft;
  onLogin?: (draft: TextMealDraft) => void;
  onUseManual?: (draft: TextMealDraft) => void;
  onConfirm?: (input: ConfirmTextEstimateInput) => Promise<void>;
  onClose?: () => void;
  strict?: boolean;
}

function renderSheet(options: RenderOptions = {}) {
  const estimateResponse = options.estimateResponse
    ?? structuredClone(textAiEstimateSuccessFixture);
  const estimate = vi.fn(async (_input: TextAiEstimateInput) => estimateResponse);
  const client: TextAiClient = options.client ?? {
    session: vi.fn().mockResolvedValue(
      options.sessionResponse ?? structuredClone(textAiSessionSuccessFixture),
    ),
    estimate,
    estimateWithOutcome: vi.fn(async (input: TextAiEstimateInput) => {
      const response = await estimate(input);
      return response.ok && response.status === 'in-flight'
        ? { terminal: false as const, response }
        : { terminal: true as const, response };
    }),
  };
  const onLogin = options.onLogin ?? vi.fn();
  const onUseManual = options.onUseManual ?? vi.fn();
  const onConfirm = options.onConfirm ?? vi.fn().mockResolvedValue(undefined);
  const onClose = options.onClose ?? vi.fn();
  const sheet = (
    <TextEstimateSheet
      date="2026-08-21"
      slot="dinner"
      initialDraft={options.initialDraft}
      client={client}
      onLogin={onLogin}
      onUseManual={onUseManual}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
  const view = render(options.strict ? <StrictMode>{sheet}</StrictMode> : sheet);
  return { ...view, client, onLogin, onUseManual, onConfirm, onClose };
}

function outcomeAwareClient(outcomes: Array<{
  terminal: boolean;
  response: TextAiEstimateResponse;
}>) {
  const outcomeQueue = structuredClone(outcomes);
  const estimate = vi.fn(async (_input: TextAiEstimateInput) => {
    throw new Error('UI must use the outcome-aware estimate path');
  });
  const estimateWithOutcome = vi.fn(async (_input: TextAiEstimateInput) => {
    const next = outcomeQueue.shift();
    if (next === undefined) throw new Error('unexpected outcome estimate');
    return next;
  });
  const client = {
    session: vi.fn().mockResolvedValue(structuredClone(textAiSessionSuccessFixture)),
    estimate,
    estimateWithOutcome,
  } as unknown as TextAiClient;
  const calls = () => estimateWithOutcome.mock.calls;
  return { client, calls };
}

function terminalOutcomeEstimate(
  estimate: TextAiClient['estimate'],
): TextAiClient['estimateWithOutcome'] {
  return async (input) => {
    const response = await estimate(input);
    return response.ok && response.status === 'in-flight'
      ? { terminal: false, response }
      : { terminal: true, response };
  };
}

async function enterDraft(
  user: ReturnType<typeof userEvent.setup>,
  description = DESCRIPTION,
  amount = '500',
): Promise<void> {
  const descriptionInput = await screen.findByLabelText('餐食描述');
  await user.type(descriptionInput, description);
  if (amount.length > 0) {
    await user.type(screen.getByLabelText('大约重量'), amount);
  }
}

async function reachConfirmation(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await enterDraft(user);
  await user.click(screen.getByRole('button', { name: '开始估算' }));
  await screen.findByText('560–780 kcal');
}

async function expectFieldError(label: string, message: string): Promise<void> {
  const alert = await screen.findByRole('alert');
  const control = screen.getByLabelText(label);
  expect(alert).toHaveTextContent(message);
  expect(control).toHaveFocus();
  expect(control).toHaveAttribute('aria-invalid', 'true');
  const describedBy = control.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  expect(document.getElementById(describedBy!)).toHaveTextContent(message);
}

beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(REQUEST_ID);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.overflow = '';
});

test.each([
  ['换行', '牛肉\n面'],
  ['Tab', '牛肉\t面'],
  ['DEL', '牛肉\u007f面'],
] as const)('餐食描述含 %s 时在 UUID 前字段级拒绝并可原样编辑重试', async (_case, value) => {
  const user = userEvent.setup();
  const { client } = renderSheet();
  const description = await screen.findByLabelText('餐食描述');
  fireEvent.change(description, { target: { value } });

  await user.click(screen.getByRole('button', { name: '开始估算' }));

  await expectFieldError('餐食描述', '餐食描述不能包含换行、Tab 或控制字符');
  expect(description).toHaveValue(value);
  expect(globalThis.crypto.randomUUID).not.toHaveBeenCalled();
  expect(client.estimate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '开始估算' })).toBeInTheDocument();

  fireEvent.change(description, { target: { value: DESCRIPTION } });
  await user.click(screen.getByRole('button', { name: '开始估算' }));
  await screen.findByText('560–780 kcal');
  expect(client.estimate).toHaveBeenCalledOnce();
});

test('空重量时单位明确禁用，填写后启用，清空后再次禁用', async () => {
  const user = userEvent.setup();
  renderSheet();
  const amount = await screen.findByLabelText('大约重量');
  const unit = screen.getByLabelText('重量单位');

  expect(unit).toBeDisabled();
  expect(unit).toHaveAttribute('aria-disabled', 'true');
  await user.type(amount, '500');
  expect(unit).toBeEnabled();
  expect(unit).toHaveAttribute('aria-disabled', 'false');
  await user.clear(amount);
  expect(unit).toBeDisabled();
  expect(unit).toHaveAttribute('aria-disabled', 'true');
});

test.each(['missing', 'throws'] as const)(
  'randomUUID %s 时可恢复且恢复后能估算，不产生未处理拒绝',
  async (mode) => {
    const user = userEvent.setup();
    if (mode === 'missing') {
      vi.stubGlobal('crypto', {} as Crypto);
    } else {
      vi.mocked(globalThis.crypto.randomUUID)
        .mockImplementationOnce(() => {
          throw new Error('uuid unavailable');
        })
        .mockReturnValue(REQUEST_ID);
    }
    const { client } = renderSheet();
    await enterDraft(user);

    await user.click(screen.getByRole('button', { name: '开始估算' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '无法创建估算请求，请重试',
    );
    expect(screen.getByLabelText('餐食描述')).toHaveValue(DESCRIPTION);
    expect(screen.getByLabelText('大约重量')).toHaveValue(500);
    expect(client.estimate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '重新估算' })).toBeInTheDocument();

    if (mode === 'missing') {
      vi.stubGlobal('crypto', {
        randomUUID: vi.fn().mockReturnValue(REQUEST_ID),
      } as unknown as Crypto);
    }
    await user.click(screen.getByRole('button', { name: '重新估算' }));
    await screen.findByText('560–780 kcal');
    expect(client.estimate).toHaveBeenCalledOnce();
  },
);

test('mount 只检查一次 session，显式估算使用独立 UUID/key 并按规则给默认值', async () => {
  const user = userEvent.setup();
  const { client } = renderSheet({ strict: true });

  await waitFor(() => expect(client.session).toHaveBeenCalledTimes(1));
  expect(client.estimate).not.toHaveBeenCalled();
  await enterDraft(user);
  expect(client.estimate).not.toHaveBeenCalled();

  for (const label of ['餐食描述', '大约重量', '重量单位']) {
    expect(screen.getByLabelText(label)).toHaveClass('min-h-11');
  }
  await user.click(screen.getByRole('button', { name: '开始估算' }));

  await screen.findByText('560–780 kcal');
  expect(client.estimate).toHaveBeenCalledOnce();
  expect(client.estimate).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    idempotencyKey: '11111111111141118111111111111111',
    description: DESCRIPTION,
    amount: { value: 500, unit: 'g' },
  });
  expect(screen.getByLabelText('实际数量')).toHaveValue(500);
  expect(screen.getByLabelText('最终热量（kcal）')).toHaveValue(670);
  expect(screen.getByLabelText('最终蛋白质（g）')).toHaveValue(35);
});

test.each([
  [
    '份量两位小数',
    { amountLow: 1, amountHigh: 1.01 },
    '实际数量',
    1.01,
  ],
  [
    '蛋白质一位小数',
    { proteinGLow: 0.1, proteinGHigh: 4.6 },
    '最终蛋白质（g）',
    2.4,
  ],
] as const)('%s midpoint 使用十进制 half-up 舍入', async (_case, range, label, expected) => {
  const user = userEvent.setup();
  const estimateResponse = structuredClone(textAiEstimateSuccessFixture);
  Object.assign(estimateResponse.candidates[0], range);
  renderSheet({ estimateResponse });

  await reachConfirmation(user);

  expect(screen.getByLabelText(label)).toHaveValue(expected);
});

test.each([
  ['amountLow', 'amountLow'],
  ['amountHigh', 'amountHigh'],
  ['energyKcalLow', 'energyKcalLow'],
  ['energyKcalHigh', 'energyKcalHigh'],
  ['proteinGLow', 'proteinGLow'],
  ['proteinGHigh', 'proteinGHigh'],
] as const)('%s 为 -0 时 bad response fail closed 且不确认', async (_case, field) => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  const estimateResponse = structuredClone(textAiEstimateSuccessFixture);
  Object.assign(estimateResponse.candidates[0], { [field]: -0 });
  expect(Object.is(estimateResponse.candidates[0][field], -0)).toBe(true);
  renderSheet({ estimateResponse, onConfirm });

  await enterDraft(user);
  await user.click(screen.getByRole('button', { name: '开始估算' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    textAiErrorCopy('invalid-estimate'),
  );
  expect(screen.queryByRole('button', { name: '确认并加入晚餐' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('实际数量')).not.toBeInTheDocument();
  expect(onConfirm).not.toHaveBeenCalled();
});

test.each([
  ['能量', { energyKcalLow: 0, energyKcalHigh: 0 }, '最终热量（kcal）'],
  ['蛋白质', { proteinGLow: 0, proteinGHigh: 0 }, '最终蛋白质（g）'],
] as const)('合法 +0 %s范围仍可进入确认', async (_case, range, label) => {
  const user = userEvent.setup();
  const estimateResponse = structuredClone(textAiEstimateSuccessFixture);
  Object.assign(estimateResponse.candidates[0], range);
  renderSheet({ estimateResponse });

  await enterDraft(user);
  await user.click(screen.getByRole('button', { name: '开始估算' }));
  await screen.findByRole('button', { name: '确认并加入晚餐' });

  expect(screen.getByLabelText(label)).toHaveValue(0);
  expect(screen.getByRole('button', { name: '确认并加入晚餐' })).toBeInTheDocument();
});

test.each([
  ['食物名称', '牛\u200b肉面', '食物名称不能包含换行、控制或不可见格式字符'],
  ['处理方式', '整餐\u200b估算', '处理方式不能包含换行、控制或不可见格式字符'],
  ['确认说明', '依据\n', '确认说明不能包含换行、控制或不可见格式字符'],
] as const)('确认字段 %s 含不安全显示字符时原样保留并字段级拒绝', async (label, value, message) => {
  const user = userEvent.setup();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  renderSheet({ onConfirm });
  await reachConfirmation(user);
  const control = screen.getByLabelText(label);
  fireEvent.change(control, { target: { value } });

  await user.click(screen.getByRole('button', { name: '确认并加入晚餐' }));

  await expectFieldError(label, message);
  expect(control).toHaveValue(value);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('确认单位与 AI 候选单位不一致时字段级拒绝且不静默改回', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  renderSheet({ onConfirm });
  await reachConfirmation(user);
  await user.selectOptions(screen.getByLabelText('单位'), 'mL');

  await user.click(screen.getByRole('button', { name: '确认并加入晚餐' }));

  await expectFieldError('单位', '单位必须与 AI 估算单位一致');
  expect(screen.getByLabelText('单位')).toHaveValue('mL');
  expect(onConfirm).not.toHaveBeenCalled();
});

test.each([
  ['最终热量（kcal）', '最终热量不能为 -0'],
  ['最终蛋白质（g）', '最终蛋白质不能为 -0'],
] as const)('%s 输入 -0 时字段级拒绝且不确认', async (label, message) => {
  const user = userEvent.setup();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  renderSheet({ onConfirm });
  await reachConfirmation(user);
  fireEvent.change(screen.getByLabelText(label), { target: { value: '-0' } });

  await user.click(screen.getByRole('button', { name: '确认并加入晚餐' }));

  await expectFieldError(label, message);
  expect(onConfirm).not.toHaveBeenCalled();
});

test.each([
  ['最终热量（kcal）', 'confirmedEnergyKcal'],
  ['最终蛋白质（g）', 'confirmedProteinG'],
] as const)('%s 输入合法 +0 时仍可确认', async (label, field) => {
  const user = userEvent.setup();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  renderSheet({ onConfirm });
  await reachConfirmation(user);
  fireEvent.change(screen.getByLabelText(label), { target: { value: '0' } });

  await user.click(screen.getByRole('button', { name: '确认并加入晚餐' }));

  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  const value = onConfirm.mock.calls[0]?.[0].candidate[field];
  expect(value).toBe(0);
  expect(Object.is(value, -0)).toBe(false);
});

test('多个确认字段无效时报告并聚焦首个字段', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  renderSheet({ onConfirm });
  await reachConfirmation(user);
  fireEvent.change(screen.getByLabelText('食物名称'), { target: { value: '   ' } });
  fireEvent.change(screen.getByLabelText('最终热量（kcal）'), { target: { value: '-0' } });

  await user.click(screen.getByRole('button', { name: '确认并加入晚餐' }));

  await expectFieldError('食物名称', '食物名称不能为空');
  expect(screen.getByLabelText('最终热量（kcal）')).not.toHaveAttribute('aria-invalid', 'true');
  expect(onConfirm).not.toHaveBeenCalled();
});

test('人工覆盖后只确认一次且 repo 输入不泄漏 UI-only 字段', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  renderSheet({ onConfirm, onClose });
  await reachConfirmation(user);

  await user.clear(screen.getByLabelText('最终热量（kcal）'));
  await user.type(screen.getByLabelText('最终热量（kcal）'), '900');
  await user.clear(screen.getByLabelText('确认说明'));
  await user.type(screen.getByLabelText('确认说明'), '一碗面，少油');
  await user.click(screen.getByRole('button', { name: '确认并加入晚餐' }));

  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  const input = onConfirm.mock.calls[0]?.[0];
  expect(input).toEqual({
    operationId: REQUEST_ID,
    date: '2026-08-21',
    slot: 'dinner',
    candidate: expect.objectContaining({
      confirmedEnergyKcal: 900,
      confirmedProteinG: 35,
      confirmedAssumptions: ['一碗面', '少油'],
    }),
  });
  expect(input?.candidate).not.toHaveProperty('assumptionsText');
  expect(input?.candidate).not.toHaveProperty('enabled');
  expect(input?.candidate).not.toHaveProperty('assumptionsEdited');
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

test('保存双击只启动一次，失败保留完整结果并用同一 operationId 重试', async () => {
  const user = userEvent.setup();
  let rejectFirst!: (cause: unknown) => void;
  const onConfirm = vi
    .fn()
    .mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      }),
    )
    .mockResolvedValueOnce(undefined);
  renderSheet({ onConfirm });
  await reachConfirmation(user);
  await user.clear(screen.getByLabelText('最终热量（kcal）'));
  await user.type(screen.getByLabelText('最终热量（kcal）'), '901');
  const submit = screen.getByRole('button', { name: '确认并加入晚餐' });

  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(onConfirm).toHaveBeenCalledOnce();
  await act(async () => rejectFirst(new Error('write failed')));

  expect(await screen.findByRole('alert')).toHaveTextContent('write failed');
  expect(screen.getByLabelText('最终热量（kcal）')).toHaveValue(901);
  await user.click(screen.getByRole('button', { name: '重试保存' }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  expect(onConfirm.mock.calls[0]?.[0].operationId).toBe(REQUEST_ID);
  expect(onConfirm.mock.calls[1]?.[0].operationId).toBe(REQUEST_ID);
  expect(onConfirm.mock.calls[1]?.[0].candidate.confirmedEnergyKcal).toBe(901);
});

test('认证失败登录 callback 保留当前描述、重量与单位且不估算', async () => {
  const user = userEvent.setup();
  const onLogin = vi.fn();
  const { client } = renderSheet({
    sessionResponse: failure('auth-required'),
    onLogin,
  });

  await screen.findByRole('button', { name: '登录后继续' });
  await enterDraft(user);
  await user.selectOptions(screen.getByLabelText('重量单位'), 'mL');
  await user.click(screen.getByRole('button', { name: '登录后继续' }));

  expect(onLogin).toHaveBeenCalledWith({
    description: DESCRIPTION,
    amount: { value: 500, unit: 'mL' },
  });
  expect(client.estimate).not.toHaveBeenCalled();
});

test.each([
  ['feature disabled', { ...textAiSessionSuccessFixture, enabled: false }, 'service-disabled'],
  ['account quota', { ...textAiSessionSuccessFixture, accountRemaining: 0 }, 'quota-exceeded'],
  ['global budget', { ...textAiSessionSuccessFixture, globalRemaining: 0 }, 'budget-exceeded'],
] as const)('session %s 进入可恢复错误且不自动估算', async (_label, response, code) => {
  const { client } = renderSheet({ sessionResponse: response });

  expect(await screen.findByRole('alert')).toHaveTextContent(textAiErrorCopy(code));
  expect(screen.getByLabelText('餐食描述')).toBeEnabled();
  expect(screen.getByRole('button', { name: '重试检查' })).toBeInTheDocument();
  expect(client.estimate).not.toHaveBeenCalled();
});

test.each([
  'offline',
  'auth-required',
  'auth-expired',
  'quota-exceeded',
  'rate-limited',
  'service-disabled',
  'budget-exceeded',
  'provider-timeout',
  'provider-unavailable',
  'invalid-estimate',
  'uncertain-food',
  'idempotency-conflict',
] as TextAiErrorCode[])('estimate 错误 %s 保留输入、可恢复且绝不确认', async (code) => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  renderSheet({ estimateResponse: failure(code), onConfirm });
  await enterDraft(user);
  await user.click(screen.getByRole('button', { name: '开始估算' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(textAiErrorCopy(code));
  expect(screen.getByLabelText('餐食描述')).toHaveValue(DESCRIPTION);
  expect(screen.getByLabelText('大约重量')).toHaveValue(500);
  expect(screen.getByRole('button', {
    name: code === 'auth-required' || code === 'auth-expired'
      ? '登录后继续'
      : '重新估算',
  })).toBeInTheDocument();
  expect(onConfirm).not.toHaveBeenCalled();
});

test('in-flight 响应按超时处理并允许重新估算', async () => {
  const user = userEvent.setup();
  renderSheet({ estimateResponse: structuredClone(textAiEstimateInFlightFixture) });
  await enterDraft(user);
  await user.click(screen.getByRole('button', { name: '开始估算' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    textAiErrorCopy('provider-timeout'),
  );
  expect(screen.getByRole('button', { name: '重新估算' })).toBeInTheDocument();
});

test('session reject 可重试且保留恢复前输入', async () => {
  const user = userEvent.setup();
  const session = vi
    .fn()
    .mockRejectedValueOnce(new Error('network down'))
    .mockResolvedValueOnce(structuredClone(textAiSessionSuccessFixture));
  const client: TextAiClient = {
    session,
    estimate: vi.fn().mockResolvedValue(structuredClone(textAiEstimateSuccessFixture)),
    estimateWithOutcome: vi.fn().mockResolvedValue({
      terminal: true,
      response: structuredClone(textAiEstimateSuccessFixture),
    }),
  };
  renderSheet({ client });

  expect(await screen.findByRole('alert')).toHaveTextContent(textAiErrorCopy('offline'));
  await enterDraft(user);
  await user.click(screen.getByRole('button', { name: '重试检查' }));

  await waitFor(() => expect(session).toHaveBeenCalledTimes(2));
  expect(await screen.findByLabelText('餐食描述')).toHaveValue(DESCRIPTION);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('本地超时后的下一次动作先用同 UUID/key 恢复隐藏成功', async () => {
  vi.mocked(globalThis.crypto.randomUUID)
    .mockReturnValueOnce(REQUEST_ID)
    .mockReturnValueOnce(SECOND_REQUEST_ID);
  const user = userEvent.setup();
  const { client, calls } = outcomeAwareClient([
    { terminal: false, response: failure('provider-timeout') },
    { terminal: true, response: structuredClone(textAiEstimateSuccessFixture) },
  ]);
  renderSheet({ client });
  await enterDraft(user);
  await user.click(screen.getByRole('button', { name: '开始估算' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    textAiErrorCopy('provider-timeout'),
  );

  await user.click(screen.getByRole('button', { name: '重新估算' }));
  await screen.findByText('560–780 kcal');
  expect(calls().map(([input]) => [input.requestId, input.idempotencyKey]))
    .toEqual([
      [REQUEST_ID, '11111111111141118111111111111111'],
      [REQUEST_ID, '11111111111141118111111111111111'],
    ]);
  expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
});

test('连续本地超时始终恢复原请求且绝不生成新 key', async () => {
  vi.mocked(globalThis.crypto.randomUUID)
    .mockReturnValueOnce(REQUEST_ID)
    .mockReturnValueOnce(SECOND_REQUEST_ID)
    .mockReturnValueOnce(THIRD_REQUEST_ID);
  const user = userEvent.setup();
  const { client, calls } = outcomeAwareClient([
    { terminal: false, response: failure('provider-timeout') },
    { terminal: false, response: failure('offline') },
    { terminal: false, response: structuredClone(textAiEstimateInFlightFixture) },
  ]);
  renderSheet({ client });
  await enterDraft(user);
  await user.click(screen.getByRole('button', { name: '开始估算' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: '重新估算' }));
  await waitFor(() => expect(calls()).toHaveLength(2));
  await user.click(screen.getByRole('button', { name: '重新估算' }));
  await waitFor(() => expect(calls()).toHaveLength(3));

  expect(calls().map(([input]) => input.requestId)).toEqual([
    REQUEST_ID,
    REQUEST_ID,
    REQUEST_ID,
  ]);
  expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
});

test('编辑草稿时先按原 fingerprint 恢复，确定失败后的下一次才用新 key', async () => {
  vi.mocked(globalThis.crypto.randomUUID)
    .mockReturnValueOnce(REQUEST_ID)
    .mockReturnValueOnce(SECOND_REQUEST_ID)
    .mockReturnValueOnce(THIRD_REQUEST_ID);
  const user = userEvent.setup();
  const editedDescription = '编辑后的鸡肉饭';
  const { client, calls } = outcomeAwareClient([
    { terminal: false, response: failure('provider-timeout') },
    { terminal: true, response: failure('provider-unavailable') },
    {
      terminal: true,
      response: {
        ...structuredClone(textAiEstimateSuccessFixture),
        requestId: SECOND_REQUEST_ID,
      },
    },
  ]);
  renderSheet({ client });
  await enterDraft(user);
  await user.click(screen.getByRole('button', { name: '开始估算' }));
  await screen.findByRole('alert');
  await user.clear(screen.getByLabelText('餐食描述'));
  await user.type(screen.getByLabelText('餐食描述'), editedDescription);

  await user.click(screen.getByRole('button', { name: '重新估算' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    textAiErrorCopy('provider-unavailable'),
  );
  await user.click(screen.getByRole('button', { name: '重新估算' }));
  await screen.findByText('560–780 kcal');

  expect(calls().map(([input]) => ({
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    description: input.description,
  }))).toEqual([
    {
      requestId: REQUEST_ID,
      idempotencyKey: '11111111111141118111111111111111',
      description: DESCRIPTION,
    },
    {
      requestId: REQUEST_ID,
      idempotencyKey: '11111111111141118111111111111111',
      description: DESCRIPTION,
    },
    {
      requestId: SECOND_REQUEST_ID,
      idempotencyKey: '22222222222242228222222222222222',
      description: editedDescription,
    },
  ]);
});

test.each([
  ['mismatched request', {
    ...structuredClone(textAiEstimateSuccessFixture),
    requestId: SECOND_REQUEST_ID,
  }],
  ['missing candidate', {
    ...structuredClone(textAiEstimateSuccessFixture),
    candidates: [],
  }],
] as const)('bad response: %s fail closed 且不确认', async (_label, response) => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  renderSheet({
    estimateResponse: response as unknown as TextAiEstimateResponse,
    onConfirm,
  });
  await enterDraft(user);
  await user.click(screen.getByRole('button', { name: '开始估算' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    textAiErrorCopy('invalid-estimate'),
  );
  expect(onConfirm).not.toHaveBeenCalled();
});

test('空描述和非法重量在创建 UUID 前拦截并保留表单', async () => {
  const user = userEvent.setup();
  const { client } = renderSheet();
  await screen.findByLabelText('餐食描述');
  fireEvent.change(screen.getByLabelText('大约重量'), { target: { value: '1e309' } });
  await user.click(screen.getByRole('button', { name: '开始估算' }));

  await expectFieldError('餐食描述', '请输入 1–500 个字符的餐食描述');
  expect(screen.getByRole('button', { name: '开始估算' })).toBeInTheDocument();
  expect(client.estimate).not.toHaveBeenCalled();
  expect(globalThis.crypto.randomUUID).not.toHaveBeenCalled();
});

test('越界重量在 UUID 前字段级拒绝并聚焦重量输入', async () => {
  const user = userEvent.setup();
  const { client } = renderSheet();
  await screen.findByLabelText('餐食描述');
  fireEvent.change(screen.getByLabelText('餐食描述'), {
    target: { value: DESCRIPTION },
  });
  fireEvent.change(screen.getByLabelText('大约重量'), { target: { value: '0' } });

  await user.click(screen.getByRole('button', { name: '开始估算' }));

  await expectFieldError('大约重量', '大约重量必须是 0.01–100000 之间的有限数字');
  expect(client.estimate).not.toHaveBeenCalled();
  expect(globalThis.crypto.randomUUID).not.toHaveBeenCalled();
});

test.each([
  ['name blank', '食物名称', '   ', '食物名称不能为空'],
  ['name long', '食物名称', '名'.repeat(121), '食物名称不能超过 120 个字符'],
  ['preparation long', '处理方式', '做'.repeat(121), '处理方式不能超过 120 个字符'],
  ['amount zero', '实际数量', '0', '实际数量必须是 0.01–100000 之间的有限数字'],
  ['amount non-finite', '实际数量', '1e309', '实际数量必须是 0.01–100000 之间的有限数字'],
  ['energy blank', '最终热量（kcal）', '', '最终热量必须是 0–100000 之间的有限数字'],
  ['energy high', '最终热量（kcal）', '100001', '最终热量必须是 0–100000 之间的有限数字'],
  ['protein high', '最终蛋白质（g）', '10001', '最终蛋白质必须是 0–10000 之间的有限数字'],
  ['assumptions empty', '确认说明', '', '确认说明需要 1–8 条有效依据'],
  ['assumptions count', '确认说明', '一,二,三,四,五,六,七,八,九', '确认说明需要 1–8 条有效依据'],
  ['assumption long', '确认说明', '依'.repeat(241), '每条确认依据不能超过 240 个字符'],
] as const)('提交验证拒绝 %s 并保持完整候选', async (_case, label, value, message) => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  renderSheet({ onConfirm });
  await reachConfirmation(user);
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  await user.click(screen.getByRole('button', { name: '确认并加入晚餐' }));

  await expectFieldError(label, message);
  expect(onConfirm).not.toHaveBeenCalled();
  expect(screen.getByLabelText(label)).toHaveValue(
    label === '实际数量' || label.includes('热量') || label.includes('蛋白质')
      ? value === '' || value === '1e309' ? null : Number(value)
      : value,
  );
});

test('做法可为空且验证上限内的确认数据可以保存', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  renderSheet({ onConfirm });
  await reachConfirmation(user);
  await user.clear(screen.getByLabelText('处理方式'));
  await user.click(screen.getByRole('button', { name: '确认并加入晚餐' }));

  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  expect(onConfirm.mock.calls[0]?.[0].candidate.confirmedPreparation).toBe('');
});

test('关闭和手动路径都不确认，uncertain 后把完整草稿安全传给手动记录', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const onUseManual = vi.fn();
  const first = renderSheet({
    estimateResponse: failure('uncertain-food'),
    onConfirm,
    onClose,
    onUseManual,
  });
  await enterDraft(user);
  await user.click(screen.getByRole('button', { name: '开始估算' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('无法可靠估算');
  expect(screen.getByLabelText('餐食描述')).toHaveValue(DESCRIPTION);
  await user.click(screen.getByRole('button', { name: '改用手动记录' }));
  expect(onUseManual).toHaveBeenCalledOnce();
  expect(onUseManual).toHaveBeenCalledWith({
    description: DESCRIPTION,
    amount: { value: 500, unit: 'g' },
  });
  expect(onConfirm).not.toHaveBeenCalled();
  first.unmount();

  const second = renderSheet({ onConfirm, onClose });
  await user.click(await screen.findByRole('button', { name: '关闭' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onConfirm).not.toHaveBeenCalled();
  second.unmount();
});

test('估算重复点击只发一个请求，关闭后晚到成功不得污染状态', async () => {
  const user = userEvent.setup();
  let resolveEstimate!: (response: TextAiEstimateResponse) => void;
  const estimate = vi.fn(
    () => new Promise<TextAiEstimateResponse>((resolve) => {
      resolveEstimate = resolve;
    }),
  );
  const onClose = vi.fn();
  const client: TextAiClient = {
    session: vi.fn().mockResolvedValue(structuredClone(textAiSessionSuccessFixture)),
    estimate,
    estimateWithOutcome: terminalOutcomeEstimate(estimate),
  };
  renderSheet({ client, onClose });
  await enterDraft(user);
  const start = screen.getByRole('button', { name: '开始估算' });
  fireEvent.click(start);
  fireEvent.click(start);
  expect(estimate).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: '关闭' }));
  expect(onClose).toHaveBeenCalledOnce();

  await act(async () => resolveEstimate(structuredClone(textAiEstimateSuccessFixture)));
  expect(screen.queryByText('560–780 kcal')).not.toBeInTheDocument();
});

test('卸载后 session reject 被消费且不会更新已卸载组件', async () => {
  let rejectSession!: (cause: unknown) => void;
  const session = vi.fn(
    () => new Promise<TextAiSessionResponse>((_resolve, reject) => {
      rejectSession = reject;
    }),
  );
  const client: TextAiClient = {
    session,
    estimate: vi.fn().mockResolvedValue(structuredClone(textAiEstimateSuccessFixture)),
    estimateWithOutcome: vi.fn().mockResolvedValue({
      terminal: true,
      response: structuredClone(textAiEstimateSuccessFixture),
    }),
  };
  const view = renderSheet({ client });
  await waitFor(() => expect(session).toHaveBeenCalledOnce());
  view.unmount();

  await act(async () => rejectSession(new Error('late failure')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

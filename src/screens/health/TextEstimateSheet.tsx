import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import type { TextAiClient } from '../../lib/textAiClient';
import {
  textAiErrorCopy,
  type TextAiErrorCode,
  type TextAiEstimateCandidate,
  type TextAiSessionResponse,
  type TextMealDraft,
} from '../../lib/textAiContract';
import type { MealSlot } from '../../lib/nutritionTypes';
import type { ConfirmTextEstimateInput } from '../../repos/mealRepo';
import {
  EstimateConfirmationEditor,
  fromEditorDraft,
  toEditorDraft,
  type EstimateConfirmationDraft,
} from './EstimateConfirmationEditor';
import { MEAL_LABELS } from './MealSection';
import { useDialogFocusTrap } from './useDialogFocusTrap';

const CONTROL_CLASS =
  'min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink outline-none focus-visible:ring-2 focus-visible:ring-iron focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REQUEST_UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f]/;
const DISPLAY_UNSAFE_CHARACTERS = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const FIELD_ERROR_ID = 'text-estimate-field-error';
const ERROR_CODES = new Set<TextAiErrorCode>([
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
]);
const CONFIRMATION_FIELD_LABELS: Record<ConfirmationField, string> = {
  name: '食物名称',
  preparation: '处理方式',
  amount: '实际数量',
  unit: '单位',
  energy: '最终热量（kcal）',
  protein: '最终蛋白质（g）',
  assumptions: '确认说明',
};

export interface TextEstimateSheetProps {
  date: string;
  slot: MealSlot;
  initialDraft?: TextMealDraft;
  client: TextAiClient;
  onLogin(draft: TextMealDraft): void;
  onUseManual(): void;
  onConfirm(input: ConfirmTextEstimateInput): Promise<void>;
  onClose(): void;
}

type DraftField = 'description' | 'amount' | 'unit';
type ConfirmationField =
  | 'name'
  | 'preparation'
  | 'amount'
  | 'unit'
  | 'energy'
  | 'protein'
  | 'assumptions';

interface FieldFailure<Field extends string> {
  field: Field;
  message: string;
}

type TextFlowErrorState =
  | {
      step: 'error';
      recovery: 'session';
      draft: TextMealDraft;
      code: TextAiErrorCode;
      message: string;
    }
  | {
      step: 'error';
      recovery: 'input';
      draft: TextMealDraft;
      code: 'invalid-estimate';
      message: string;
      field: DraftField;
    }
  | {
      step: 'error';
      recovery: 'estimate';
      draft: TextMealDraft;
      code: TextAiErrorCode;
      message: string;
      requestId: string | null;
    }
  | {
      step: 'error';
      recovery: 'login';
      draft: TextMealDraft;
      code: 'auth-required' | 'auth-expired';
      message: string;
    }
  | {
      step: 'error';
      recovery: 'confirm';
      draft: TextMealDraft;
      code: 'invalid-estimate';
      message: string;
      requestId: string;
      candidate: EstimateConfirmationDraft;
      field: ConfirmationField;
    }
  | {
      step: 'error';
      recovery: 'save';
      draft: TextMealDraft;
      code: 'invalid-estimate';
      message: string;
      requestId: string;
      candidate: EstimateConfirmationDraft;
    };

type TextFlowState =
  | { step: 'checking-session' }
  | { step: 'input'; draft: TextMealDraft }
  | { step: 'estimating'; draft: TextMealDraft; requestId: string }
  | {
      step: 'confirming';
      draft: TextMealDraft;
      requestId: string;
      candidate: EstimateConfirmationDraft;
    }
  | {
      step: 'saving';
      draft: TextMealDraft;
      requestId: string;
      candidate: EstimateConfirmationDraft;
    }
  | TextFlowErrorState;

function cloneDraft(draft: TextMealDraft): TextMealDraft {
  return {
    description: draft.description,
    amount: draft.amount === null ? null : { ...draft.amount },
  };
}

function numberValue(value: number | undefined): number | '' {
  return value === undefined || !Number.isFinite(value) ? '' : value;
}

function decimalRatio(value: number): { coefficient: bigint; scale: number } {
  const [mantissa, exponentText] = value.toString().toLowerCase().split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const [integer, fraction = ''] = mantissa.split('.');
  let coefficient = BigInt(`${integer}${fraction}`);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

function roundMidpoint(low: number, high: number, decimals: number): number {
  if (
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    Object.is(low, -0) ||
    Object.is(high, -0) ||
    low < 0 ||
    high < 0 ||
    low > 100_000 ||
    high > 100_000 ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 2
  ) {
    return Number.NaN;
  }

  const lowRatio = decimalRatio(low);
  const highRatio = decimalRatio(high);
  const commonScale = Math.max(lowRatio.scale, highRatio.scale);
  const sum =
    lowRatio.coefficient * 10n ** BigInt(commonScale - lowRatio.scale) +
    highRatio.coefficient * 10n ** BigInt(commonScale - highRatio.scale);
  const scaleDifference = commonScale - decimals;
  const numerator = scaleDifference <= 0
    ? sum * 10n ** BigInt(-scaleDifference)
    : sum;
  const denominator = scaleDifference <= 0
    ? 2n
    : 2n * 10n ** BigInt(scaleDifference);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return Number(rounded) / 10 ** decimals;
}

function confirmationDraft(candidate: TextAiEstimateCandidate): EstimateConfirmationDraft | null {
  const confirmedAmount = roundMidpoint(candidate.amountLow, candidate.amountHigh, 2);
  const confirmedEnergyKcal = roundMidpoint(
    candidate.energyKcalLow,
    candidate.energyKcalHigh,
    0,
  );
  const confirmedProteinG = roundMidpoint(
    candidate.proteinGLow,
    candidate.proteinGHigh,
    1,
  );
  if (
    !Number.isFinite(confirmedAmount) ||
    !Number.isFinite(confirmedEnergyKcal) ||
    !Number.isFinite(confirmedProteinG)
  ) {
    return null;
  }
  return toEditorDraft({
    candidate: {
      ...candidate,
      assumptions: [...candidate.assumptions],
    },
    confirmedAmount,
    confirmedUnit: candidate.unit,
    confirmedName: candidate.name,
    confirmedPreparation: candidate.preparation,
    confirmedAssumptions: [...candidate.assumptions],
    confirmedEnergyKcal,
    confirmedProteinG,
  });
}

function estimateDraftFailure(draft: TextMealDraft): FieldFailure<DraftField> | null {
  if (REQUEST_UNSAFE_CHARACTERS.test(draft.description)) {
    return {
      field: 'description',
      message: '餐食描述不能包含换行、Tab 或控制字符',
    };
  }
  const description = draft.description.normalize('NFC').trim();
  if (description.length < 1 || description.length > 500) {
    return {
      field: 'description',
      message: '请输入 1–500 个字符的餐食描述',
    };
  }
  if (draft.amount === null) return null;
  if (
    !Number.isFinite(draft.amount.value) ||
    Object.is(draft.amount.value, -0) ||
    draft.amount.value < 0.01 ||
    draft.amount.value > 100_000
  ) {
    return {
      field: 'amount',
      message: '大约重量必须是 0.01–100000 之间的有限数字',
    };
  }
  if (draft.amount.unit !== 'g' && draft.amount.unit !== 'mL') {
    return { field: 'unit', message: '重量单位必须是 g 或 mL' };
  }
  return null;
}

function confirmationFailure(
  draft: EstimateConfirmationDraft,
): FieldFailure<ConfirmationField> | null {
  if (draft.confirmedName.trim().length === 0) {
    return { field: 'name', message: '食物名称不能为空' };
  }
  if (draft.confirmedName.length > 120) {
    return { field: 'name', message: '食物名称不能超过 120 个字符' };
  }
  if (DISPLAY_UNSAFE_CHARACTERS.test(draft.confirmedName)) {
    return {
      field: 'name',
      message: '食物名称不能包含换行、控制或不可见格式字符',
    };
  }
  if (draft.confirmedPreparation.length > 120) {
    return { field: 'preparation', message: '处理方式不能超过 120 个字符' };
  }
  if (DISPLAY_UNSAFE_CHARACTERS.test(draft.confirmedPreparation)) {
    return {
      field: 'preparation',
      message: '处理方式不能包含换行、控制或不可见格式字符',
    };
  }
  if (
    !Number.isFinite(draft.confirmedAmount) ||
    Object.is(draft.confirmedAmount, -0) ||
    draft.confirmedAmount < 0.01 ||
    draft.confirmedAmount > 100_000
  ) {
    return {
      field: 'amount',
      message: '实际数量必须是 0.01–100000 之间的有限数字',
    };
  }
  if (draft.confirmedUnit !== draft.candidate.unit) {
    return { field: 'unit', message: '单位必须与 AI 估算单位一致' };
  }
  if (Object.is(draft.confirmedEnergyKcal, -0)) {
    return { field: 'energy', message: '最终热量不能为 -0' };
  }
  if (
    typeof draft.confirmedEnergyKcal !== 'number' ||
    !Number.isFinite(draft.confirmedEnergyKcal) ||
    draft.confirmedEnergyKcal < 0 ||
    draft.confirmedEnergyKcal > 100_000
  ) {
    return {
      field: 'energy',
      message: '最终热量必须是 0–100000 之间的有限数字',
    };
  }
  if (Object.is(draft.confirmedProteinG, -0)) {
    return { field: 'protein', message: '最终蛋白质不能为 -0' };
  }
  if (
    typeof draft.confirmedProteinG !== 'number' ||
    !Number.isFinite(draft.confirmedProteinG) ||
    draft.confirmedProteinG < 0 ||
    draft.confirmedProteinG > 10_000
  ) {
    return {
      field: 'protein',
      message: '最终蛋白质必须是 0–10000 之间的有限数字',
    };
  }
  if (DISPLAY_UNSAFE_CHARACTERS.test(draft.assumptionsText)) {
    return {
      field: 'assumptions',
      message: '确认说明不能包含换行、控制或不可见格式字符',
    };
  }
  const confirmedAssumptions = fromEditorDraft(draft).confirmedAssumptions;
  if (confirmedAssumptions.length < 1 || confirmedAssumptions.length > 8) {
    return { field: 'assumptions', message: '确认说明需要 1–8 条有效依据' };
  }
  if (confirmedAssumptions.some((assumption) => assumption.length > 240)) {
    return { field: 'assumptions', message: '每条确认依据不能超过 240 个字符' };
  }
  if (confirmedAssumptions.some((assumption) => DISPLAY_UNSAFE_CHARACTERS.test(assumption))) {
    return {
      field: 'assumptions',
      message: '确认说明不能包含换行、控制或不可见格式字符',
    };
  }
  return null;
}

function knownFailureCode(value: unknown): TextAiErrorCode | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) return undefined;
  const code = value.code;
  return typeof code === 'string' && ERROR_CODES.has(code as TextAiErrorCode)
    ? code as TextAiErrorCode
    : undefined;
}

function safeSaveMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? cause.message
    : '保存失败，请重试';
}

export function TextEstimateSheet({
  date,
  slot,
  initialDraft,
  client,
  onLogin,
  onUseManual,
  onConfirm,
  onClose,
}: TextEstimateSheetProps) {
  const initialDraftRef = useRef<TextMealDraft>(
    cloneDraft(initialDraft ?? { description: '', amount: null }),
  );
  const [state, setState] = useState<TextFlowState>({ step: 'checking-session' });
  const dialogRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const unitRef = useRef<HTMLSelectElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const closed = useRef(false);
  const initialSessionStarted = useRef(false);
  const sessionGeneration = useRef(0);
  const estimateGeneration = useRef(0);
  const sessionLatch = useRef(false);
  const estimateLatch = useRef(false);
  const saveLatch = useRef(false);
  const mealLabel = MEAL_LABELS[slot];

  function active(generation?: { kind: 'session' | 'estimate'; value: number }): boolean {
    if (!mounted.current || closed.current) return false;
    if (generation?.kind === 'session') return sessionGeneration.current === generation.value;
    if (generation?.kind === 'estimate') return estimateGeneration.current === generation.value;
    return true;
  }

  function remoteError(
    draft: TextMealDraft,
    code: TextAiErrorCode,
    recovery: 'session' | 'estimate',
    requestId: string | null = null,
    message: string = textAiErrorCopy(code),
  ): void {
    if (code === 'auth-required' || code === 'auth-expired') {
      setState({ step: 'error', recovery: 'login', draft, code, message });
      return;
    }
    if (recovery === 'session') {
      setState({ step: 'error', recovery, draft, code, message });
      return;
    }
    setState({ step: 'error', recovery, draft, code, message, requestId });
  }

  function inputError(draft: TextMealDraft, failure: FieldFailure<DraftField>): void {
    setState({
      step: 'error',
      recovery: 'input',
      draft,
      code: 'invalid-estimate',
      message: failure.message,
      field: failure.field,
    });
  }

  function confirmError(
    draft: TextMealDraft,
    requestId: string,
    candidate: EstimateConfirmationDraft,
    failure: FieldFailure<ConfirmationField>,
  ): void {
    setState({
      step: 'error',
      recovery: 'confirm',
      draft,
      code: 'invalid-estimate',
      message: failure.message,
      requestId,
      candidate,
      field: failure.field,
    });
  }

  function saveError(
    draft: TextMealDraft,
    requestId: string,
    candidate: EstimateConfirmationDraft,
    message: string,
  ): void {
    setState({
      step: 'error',
      recovery: 'save',
      draft,
      code: 'invalid-estimate',
      message,
      requestId,
      candidate,
    });
  }

  async function checkSession(draft: TextMealDraft): Promise<void> {
    if (sessionLatch.current || closed.current) return;
    sessionLatch.current = true;
    const generation = sessionGeneration.current + 1;
    sessionGeneration.current = generation;
    const snapshot = cloneDraft(draft);
    setState({ step: 'checking-session' });
    try {
      const response: TextAiSessionResponse = await client.session();
      if (!active({ kind: 'session', value: generation })) return;
      if (typeof response !== 'object' || response === null || !('ok' in response)) {
        remoteError(snapshot, 'invalid-estimate', 'session');
      } else if (!response.ok) {
        const code = knownFailureCode(response) ?? 'invalid-estimate';
        remoteError(snapshot, code, 'session');
      } else if (!response.enabled) {
        remoteError(snapshot, 'service-disabled', 'session');
      } else if (response.accountRemaining <= 0) {
        remoteError(snapshot, 'quota-exceeded', 'session');
      } else if (response.globalRemaining <= 0) {
        remoteError(snapshot, 'budget-exceeded', 'session');
      } else {
        setState({ step: 'input', draft: snapshot });
      }
    } catch {
      if (active({ kind: 'session', value: generation })) {
        remoteError(snapshot, 'offline', 'session');
      }
    } finally {
      if (sessionGeneration.current === generation) sessionLatch.current = false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    closed.current = false;
    if (!initialSessionStarted.current) {
      initialSessionStarted.current = true;
      void checkSession(initialDraftRef.current);
    }
    return () => {
      mounted.current = false;
      closed.current = true;
    };
    // Session is checked once per mounted sheet. Retry is an explicit user action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.step !== 'error') return undefined;
    let control: HTMLElement | null = null;
    if (state.recovery === 'input') {
      if (state.field === 'description') control = descriptionRef.current;
      if (state.field === 'amount') control = amountRef.current;
      if (state.field === 'unit') control = unitRef.current;
    } else if (state.recovery === 'confirm') {
      const label = CONFIRMATION_FIELD_LABELS[state.field];
      control = confirmationRef.current?.querySelector<HTMLElement>(
        `[aria-label="${label}"]`,
      ) ?? null;
    }
    if (control === null) return undefined;
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', FIELD_ERROR_ID);
    control.focus();
    return () => {
      control?.removeAttribute('aria-invalid');
      if (control?.getAttribute('aria-describedby') === FIELD_ERROR_ID) {
        control.removeAttribute('aria-describedby');
      }
    };
  }, [state]);

  function invalidateAnd(action: () => void): void {
    if (closed.current || saveLatch.current) return;
    closed.current = true;
    sessionGeneration.current += 1;
    estimateGeneration.current += 1;
    action();
  }

  function close(): void {
    invalidateAnd(onClose);
  }

  function useManual(): void {
    invalidateAnd(onUseManual);
  }

  function login(draft: TextMealDraft): void {
    invalidateAnd(() => onLogin(cloneDraft(draft)));
  }

  function updateDraft(draft: TextMealDraft): void {
    if (state.step === 'input') {
      setState({ ...state, draft });
    } else if (state.step === 'error' && state.recovery === 'input') {
      setState({ step: 'input', draft });
    } else if (
      state.step === 'error' &&
      (state.recovery === 'session' ||
        state.recovery === 'estimate' ||
        state.recovery === 'login')
    ) {
      setState({ ...state, draft });
    }
  }

  async function startEstimate(draft: TextMealDraft): Promise<void> {
    if (estimateLatch.current || closed.current) return;
    const snapshot = cloneDraft(draft);
    const failure = estimateDraftFailure(snapshot);
    if (failure !== null) {
      inputError(snapshot, failure);
      return;
    }
    let requestId: string;
    try {
      const randomUUID = globalThis.crypto?.randomUUID;
      if (typeof randomUUID !== 'function') throw new Error('randomUUID unavailable');
      requestId = randomUUID.call(globalThis.crypto);
    } catch {
      remoteError(
        snapshot,
        'invalid-estimate',
        'estimate',
        null,
        '无法创建估算请求，请重试',
      );
      return;
    }
    if (!UUID_PATTERN.test(requestId)) {
      remoteError(
        snapshot,
        'invalid-estimate',
        'estimate',
        null,
        '无法创建估算请求，请重试',
      );
      return;
    }
    const idempotencyKey = requestId.replaceAll('-', '').toLowerCase();
    const generation = estimateGeneration.current + 1;
    estimateGeneration.current = generation;
    estimateLatch.current = true;
    setState({ step: 'estimating', draft: snapshot, requestId });
    try {
      const response = await client.estimate({
        requestId,
        idempotencyKey,
        ...cloneDraft(snapshot),
      });
      if (!active({ kind: 'estimate', value: generation })) return;
      if (typeof response !== 'object' || response === null || !('ok' in response)) {
        remoteError(snapshot, 'invalid-estimate', 'estimate', requestId);
      } else if (!response.ok) {
        const code = knownFailureCode(response) ?? 'invalid-estimate';
        remoteError(snapshot, code, 'estimate', requestId);
      } else if (response.status === 'in-flight') {
        remoteError(snapshot, 'provider-timeout', 'estimate', requestId);
      } else if (
        response.status !== 'complete' ||
        response.requestId !== requestId ||
        !Array.isArray(response.candidates) ||
        response.candidates.length !== 1 ||
        response.candidates[0] === undefined
      ) {
        remoteError(snapshot, 'invalid-estimate', 'estimate', requestId);
      } else {
        const candidate = confirmationDraft(response.candidates[0]);
        if (candidate === null) {
          remoteError(snapshot, 'invalid-estimate', 'estimate', requestId);
        } else {
          setState({
            step: 'confirming',
            draft: snapshot,
            requestId,
            candidate,
          });
        }
      }
    } catch {
      if (active({ kind: 'estimate', value: generation })) {
        remoteError(snapshot, 'provider-unavailable', 'estimate', requestId);
      }
    } finally {
      if (estimateGeneration.current === generation) estimateLatch.current = false;
    }
  }

  function updateCandidate(candidate: EstimateConfirmationDraft): void {
    if (state.step === 'confirming') {
      setState({ ...state, candidate });
    } else if (state.step === 'error' && state.recovery === 'confirm') {
      setState({
        step: 'confirming',
        draft: state.draft,
        requestId: state.requestId,
        candidate,
      });
    } else if (state.step === 'error' && state.recovery === 'save') {
      setState({ ...state, candidate });
    }
  }

  async function saveCandidate(
    draft: TextMealDraft,
    requestId: string,
    candidate: EstimateConfirmationDraft,
  ): Promise<void> {
    if (saveLatch.current || closed.current) return;
    const failure = confirmationFailure(candidate);
    if (failure !== null) {
      confirmError(draft, requestId, candidate, failure);
      return;
    }
    const confirmed = fromEditorDraft(candidate);
    saveLatch.current = true;
    setState({ step: 'saving', draft, requestId, candidate });
    try {
      await onConfirm({
        operationId: requestId,
        date,
        slot,
        candidate: confirmed,
      });
      if (!active()) return;
      closed.current = true;
      onClose();
    } catch (cause) {
      if (active()) {
        saveError(draft, requestId, candidate, safeSaveMessage(cause));
      }
    } finally {
      saveLatch.current = false;
    }
  }

  useDialogFocusTrap(dialogRef, close);

  const hasCandidate =
    state.step === 'confirming' ||
    state.step === 'saving' ||
    (state.step === 'error' &&
      (state.recovery === 'confirm' || state.recovery === 'save'));
  const locked = state.step === 'estimating' || state.step === 'saving';
  const draft = state.step === 'checking-session' ? initialDraftRef.current : state.draft;
  const inputFieldError = state.step === 'error' && state.recovery === 'input'
    ? state
    : null;

  function renderDraftForm() {
    const amountUnit = draft.amount?.unit ?? 'g';
    const unitDisabled = locked || draft.amount === null;
    return (
      <div className="space-y-3">
        <label className="grid gap-1 text-xs text-mute">
          餐食描述
          <textarea
            ref={descriptionRef}
            aria-label="餐食描述"
            aria-invalid={inputFieldError?.field === 'description' ? 'true' : undefined}
            aria-describedby={
              inputFieldError?.field === 'description' ? FIELD_ERROR_ID : undefined
            }
            maxLength={500}
            className={`${CONTROL_CLASS} min-h-24 py-3`}
            value={draft.description}
            disabled={locked}
            onChange={(event) =>
              updateDraft({ ...draft, description: event.currentTarget.value })
            }
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-mute">
            大约重量（可选）
            <input
              ref={amountRef}
              type="number"
              min="0.01"
              max="100000"
              step="0.01"
              aria-label="大约重量"
              aria-invalid={inputFieldError?.field === 'amount' ? 'true' : undefined}
              aria-describedby={
                inputFieldError?.field === 'amount' ? FIELD_ERROR_ID : undefined
              }
              className={CONTROL_CLASS}
              value={numberValue(draft.amount?.value)}
              disabled={locked}
              onChange={(event) => {
                const raw = event.currentTarget.value;
                updateDraft({
                  ...draft,
                  amount: raw.trim().length === 0
                    ? null
                    : { value: Number(raw), unit: amountUnit },
                });
              }}
            />
          </label>
          <label className="grid gap-1 text-xs text-mute">
            重量单位
            <select
              ref={unitRef}
              aria-label="重量单位"
              aria-invalid={inputFieldError?.field === 'unit' ? 'true' : undefined}
              aria-describedby={
                inputFieldError?.field === 'unit' ? FIELD_ERROR_ID : undefined
              }
              aria-disabled={unitDisabled ? 'true' : 'false'}
              className={CONTROL_CLASS}
              value={amountUnit}
              disabled={unitDisabled}
              onChange={(event) => {
                if (draft.amount === null) return;
                updateDraft({
                  ...draft,
                  amount: {
                    ...draft.amount,
                    unit: event.currentTarget.value as 'g' | 'mL',
                  },
                });
              }}
            >
              <option value="g">g</option>
              <option value="mL">mL</option>
            </select>
          </label>
        </div>
      </div>
    );
  }

  function renderInputAction() {
    if (state.step === 'checking-session') {
      return <p role="status" className="py-6 text-center text-sm text-mute">正在检查估算权限…</p>;
    }
    if (state.step === 'estimating') {
      return (
        <Button fullWidth loading>开始估算</Button>
      );
    }
    if (state.step === 'input') {
      return <Button fullWidth onClick={() => void startEstimate(state.draft)}>开始估算</Button>;
    }
    if (
      state.step !== 'error' ||
      state.recovery === 'confirm' ||
      state.recovery === 'save'
    ) return null;
    if (state.recovery === 'login') {
      return <Button fullWidth onClick={() => login(state.draft)}>登录后继续</Button>;
    }
    if (state.recovery === 'estimate') {
      return <Button fullWidth onClick={() => void startEstimate(state.draft)}>重新估算</Button>;
    }
    if (state.recovery === 'input') {
      return <Button fullWidth onClick={() => void startEstimate(state.draft)}>开始估算</Button>;
    }
    return <Button fullWidth onClick={() => void checkSession(state.draft)}>重试检查</Button>;
  }

  function renderConfirmation() {
    if (
      state.step !== 'confirming' &&
      state.step !== 'saving' &&
      !(state.step === 'error' &&
        (state.recovery === 'confirm' || state.recovery === 'save'))
    ) return null;
    const { candidate, requestId } = state;
    return (
      <div className="space-y-4">
        <p className="rounded-xl border border-line bg-bg p-3 text-sm text-mute">
          {state.draft.description}
        </p>
        <div ref={confirmationRef}>
          <EstimateConfirmationEditor
            draft={candidate}
            nutrientMode="editable-point"
            disabled={state.step === 'saving'}
            onChange={updateCandidate}
          />
        </div>
        <Button
          fullWidth
          loading={state.step === 'saving'}
          onClick={() => void saveCandidate(state.draft, requestId, candidate)}
        >
          {state.step === 'error' && state.recovery === 'save'
            ? '重试保存'
            : `确认并加入${mealLabel}`}
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/70" aria-hidden={false}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="text-estimate-title"
        className="forged-surface max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border-x-0 border-b-0 p-5 text-ink transition motion-reduce:transition-none"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold tracking-[2px] text-amber">TEXT + AI</p>
            <h2 id="text-estimate-title" className="mt-1 text-lg font-extrabold">
              AI 估算{mealLabel}
            </h2>
          </div>
          <Button
            variant="tertiary"
            aria-label="关闭"
            onClick={close}
            disabled={state.step === 'saving'}
            className="size-11 p-0"
          >
            ×
          </Button>
        </div>
        <div className="etch" />
        <div className="space-y-4">
          {state.step === 'error' ? (
            <p
              id={
                state.recovery === 'input' || state.recovery === 'confirm'
                  ? FIELD_ERROR_ID
                  : undefined
              }
              role="alert"
              className="rounded-xl border border-amber/50 bg-bg p-3 text-sm text-amber"
            >
              {state.message}
            </p>
          ) : null}
          {hasCandidate ? renderConfirmation() : (
            <>
              {state.step === 'checking-session' ? null : renderDraftForm()}
              {renderInputAction()}
            </>
          )}
          <Button
            variant="secondary"
            fullWidth
            disabled={state.step === 'saving'}
            onClick={useManual}
          >
            改用手动记录
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '../../components/Button';
import {
  PHOTO_AI_LIMITS,
  PHOTO_AI_PROVIDER_POLICY_URL,
  PHOTO_AI_VERSIONS,
  photoAiErrorCopy,
  photoAiErrorToMealEstimateError,
  type PhotoAiErrorCode,
} from '../../lib/photoAiContract';
import type { PhotoAiClient } from '../../lib/photoAiClient';
import {
  PhotoPreparationError,
  preparePhoto,
  type PreparedPhoto,
} from '../../lib/photoAiImage';
import type { ConfirmedPhotoCandidate } from '../../lib/photoAiCandidate';
import { mealEstimateId, mealId } from '../../lib/nutritionIds';
import type {
  Food,
  MealEstimate,
  MealEstimateCandidate,
  MealEstimateConsentBinding,
  MealSlot,
} from '../../lib/nutritionTypes';
import type { ConfirmPhotoEstimateInput } from '../../repos/mealRepo';
import { MEAL_LABELS } from './MealSection';
import { useDialogFocusTrap } from './useDialogFocusTrap';

const CONTROL_CLASS =
  'min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink outline-none focus-visible:ring-2 focus-visible:ring-iron focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50';

export interface PhotoEstimateSheetProps {
  date: string;
  slot: MealSlot;
  foods: Food[];
  client: PhotoAiClient;
  onLogin(): void;
  onPutEstimate(estimate: MealEstimate): Promise<void>;
  onClearEstimate(mealId: string): Promise<void>;
  onConfirm(input: ConfirmPhotoEstimateInput): Promise<void>;
  onClose(): void;
}

interface EditableCandidate extends ConfirmedPhotoCandidate {
  enabled: boolean;
}

interface PreparedContext {
  prepared: PreparedPhoto;
  requestId: string;
  idempotencyKey: string;
}

type RecoverablePhotoFlowState =
  | { step: 'source' }
  | ({ step: 'consent' } & PreparedContext)
  | {
      step: 'confirming';
      prepared: PreparedPhoto;
      requestId: string;
      candidates: EditableCandidate[];
    };

type PhotoFlowState =
  | { step: 'checking-session' }
  | { step: 'source' }
  | { step: 'preprocessing' }
  | ({ step: 'consent' } & PreparedContext)
  | ({ step: 'uploading' } & PreparedContext)
  | {
      step: 'confirming';
      prepared: PreparedPhoto;
      requestId: string;
      candidates: EditableCandidate[];
    }
  | {
      step: 'saving';
      prepared: PreparedPhoto;
      requestId: string;
      candidates: EditableCandidate[];
    }
  | { step: 'error'; code: PhotoAiErrorCode; previous: RecoverablePhotoFlowState };

function safeMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? cause.message
    : fallback;
}

function midpoint(low: number, high: number): number {
  return Math.round(((low + high) / 2) * 100) / 100;
}

function editableCandidate(candidate: MealEstimateCandidate): EditableCandidate {
  return {
    candidate: {
      ...candidate,
      assumptions: [...candidate.assumptions],
    },
    confirmedAmount: midpoint(candidate.amountLow, candidate.amountHigh),
    confirmedUnit: candidate.unit,
    confirmedName: candidate.name,
    confirmedPreparation: candidate.preparation,
    confirmedAssumptions: [...candidate.assumptions],
    enabled: candidate.nutrientSource !== 'none',
  };
}

function statusRow(
  parentMealId: string,
  context: PreparedContext,
  status: MealEstimate['status'],
  updatedAt: number,
  options: {
    consent?: MealEstimateConsentBinding | null;
    requestFingerprint?: string | null;
    candidates?: MealEstimateCandidate[];
    error?: MealEstimate['error'];
  } = {},
): MealEstimate {
  return {
    id: mealEstimateId(parentMealId),
    mealId: parentMealId,
    status,
    requestId: context.requestId,
    requestFingerprint: options.requestFingerprint ?? null,
    candidates: (options.candidates ?? []).map((candidate) => ({
      ...candidate,
      assumptions: [...candidate.assumptions],
    })),
    consent: options.consent ?? null,
    error: options.error ?? null,
    updatedAt,
  };
}

function newRequestContext(prepared: PreparedPhoto): PreparedContext {
  const requestId = crypto.randomUUID();
  return {
    prepared,
    requestId,
    idempotencyKey: requestId.replaceAll('-', '').toLowerCase(),
  };
}

function idempotencyKeyFor(requestId: string): string {
  return requestId.replaceAll('-', '').toLowerCase();
}

export function PhotoEstimateSheet({
  date,
  slot,
  foods,
  client,
  onLogin,
  onPutEstimate,
  onClearEstimate,
  onConfirm,
  onClose,
}: PhotoEstimateSheetProps) {
  const [state, setState] = useState<PhotoFlowState>({ step: 'checking-session' });
  const [errorMessage, setErrorMessage] = useState('');
  const [logoutUrl, setLogoutUrl] = useState<'/cdn-cgi/access/logout'>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const initialSessionStarted = useRef(false);
  const sessionGeneration = useRef(0);
  const preparedRef = useRef<PreparedPhoto | null>(null);
  const disposedPrepared = useRef(new WeakSet<object>());
  const uploadLatch = useRef(false);
  const saveLatch = useRef(false);
  const transitionLatch = useRef(false);
  const closing = useRef(false);
  const persistedEstimate = useRef(false);
  const pendingEstimateWrite = useRef<Promise<void> | null>(null);
  const pendingEstimateClear = useRef<Promise<void> | null>(null);
  const timestamp = useRef(0);
  const parentMealId = mealId(date, slot);
  const mealLabel = MEAL_LABELS[slot];

  function nextTimestamp(): number {
    const value = Math.max(Date.now(), timestamp.current + 1);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('本地时间无效，请校准设备时间后重试');
    }
    timestamp.current = value;
    return value;
  }

  function keepPrepared(prepared: PreparedPhoto): void {
    if (preparedRef.current !== null && preparedRef.current !== prepared) {
      preparedRef.current.dispose();
    }
    preparedRef.current = prepared;
  }

  function releasePrepared(prepared?: PreparedPhoto): void {
    const current = prepared ?? preparedRef.current;
    if (current === null || current === undefined) return;
    if (preparedRef.current === current) preparedRef.current = null;
    if (disposedPrepared.current.has(current)) return;
    disposedPrepared.current.add(current);
    current.dispose();
  }

  async function persistEstimate(row: MealEstimate): Promise<void> {
    const write = onPutEstimate(row);
    pendingEstimateWrite.current = write;
    try {
      await write;
      persistedEstimate.current = true;
    } finally {
      if (pendingEstimateWrite.current === write) pendingEstimateWrite.current = null;
    }
  }

  async function clearPersistedEstimate(): Promise<void> {
    if (pendingEstimateClear.current !== null) return pendingEstimateClear.current;
    const clear = (async () => {
      try {
        await pendingEstimateWrite.current;
      } catch {
        // A failed write may still follow an earlier persisted state that must be cleared.
      }
      if (!persistedEstimate.current) return;
      await onClearEstimate(parentMealId);
      persistedEstimate.current = false;
    })();
    pendingEstimateClear.current = clear;
    try {
      await clear;
    } finally {
      if (pendingEstimateClear.current === clear) pendingEstimateClear.current = null;
    }
  }

  function close(): void {
    if (transitionLatch.current || saveLatch.current || closing.current) return;
    transitionLatch.current = true;
    closing.current = true;

    const finish = () => {
      releasePrepared();
      onClose();
    };
    if (!persistedEstimate.current && pendingEstimateWrite.current === null) {
      finish();
      return;
    }
    void clearPersistedEstimate()
      .then(() => {
        if (!mounted.current) return;
        finish();
      })
      .catch((cause: unknown) => {
        if (!mounted.current) return;
        closing.current = false;
        transitionLatch.current = false;
        showError(
          'invalid-estimate',
          { step: 'source' },
          safeMessage(cause, '无法清除这次识别，请重试'),
        );
      });
  }

  function showError(
    code: PhotoAiErrorCode,
    previous: RecoverablePhotoFlowState,
    message = photoAiErrorCopy(code),
  ): void {
    setErrorMessage(message);
    setState({ step: 'error', code, previous });
  }

  useDialogFocusTrap(dialogRef, close);

  async function checkSession(): Promise<void> {
    const generation = sessionGeneration.current + 1;
    sessionGeneration.current = generation;
    setState({ step: 'checking-session' });
    try {
      const response = await client.session();
      if (!mounted.current || sessionGeneration.current !== generation) return;
      if (!response.ok) {
        showError(response.code, { step: 'source' });
        return;
      }
      if (!response.enabled) {
        showError('service-disabled', { step: 'source' });
        return;
      }
      setState({ step: 'source' });
    } catch (cause) {
      if (!mounted.current || sessionGeneration.current !== generation) return;
      showError('offline', { step: 'source' }, safeMessage(cause, photoAiErrorCopy('offline')));
    }
  }

  useEffect(() => {
    mounted.current = true;
    closing.current = false;
    if (!initialSessionStarted.current) {
      initialSessionStarted.current = true;
      void checkSession();
    }
    return () => {
      mounted.current = false;
      closing.current = true;
      void clearPersistedEstimate().catch(() => undefined);
      releasePrepared();
    };
    // Session is checked once for this sheet instance. Retry is an explicit user action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined || state.step !== 'source') return;
    setState({ step: 'preprocessing' });
    try {
      const prepared = await preparePhoto(file);
      if (!mounted.current) {
        prepared.dispose();
        return;
      }
      keepPrepared(prepared);
      const context = newRequestContext(prepared);
      await persistEstimate(
        statusRow(parentMealId, context, 'awaiting-consent', nextTimestamp()),
      );
      if (!mounted.current || closing.current) {
        await clearPersistedEstimate();
        return;
      }
      setState({ ...context, step: 'consent' });
    } catch (cause) {
      if (!mounted.current) return;
      const code = cause instanceof PhotoPreparationError ? cause.code : 'decode-failed';
      releasePrepared();
      showError(code, { step: 'source' }, safeMessage(cause, photoAiErrorCopy(code)));
    }
  }

  async function cancelPrepared(context: PreparedContext): Promise<void> {
    if (uploadLatch.current || saveLatch.current || transitionLatch.current) return;
    transitionLatch.current = true;
    try {
      await clearPersistedEstimate();
      if (!mounted.current) return;
      releasePrepared(context.prepared);
      setState({ step: 'source' });
    } catch (cause) {
      if (!mounted.current) return;
      showError(
        'invalid-estimate',
        { ...context, step: 'consent' },
        safeMessage(cause, '无法清除这次识别，请重试'),
      );
    } finally {
      transitionLatch.current = false;
    }
  }

  async function upload(context: PreparedContext): Promise<void> {
    if (uploadLatch.current || transitionLatch.current || closing.current) return;
    uploadLatch.current = true;
    const consentedAt = nextTimestamp();
    const consent: MealEstimateConsentBinding = {
      uploadBlobSha256: context.prepared.uploadBlobSha256,
      requestId: context.requestId,
      providerPolicyVersion: PHOTO_AI_VERSIONS.providerPolicy,
      consentedAt,
      expiresAt: consentedAt + PHOTO_AI_LIMITS.consentMs,
    };
    let failureAttempted = false;

    async function persistFailure(code: PhotoAiErrorCode): Promise<void> {
      failureAttempted = true;
      await persistEstimate(
        statusRow(parentMealId, context, 'failed', nextTimestamp(), {
          consent,
          error: photoAiErrorToMealEstimateError(code),
        }),
      );
    }

    async function expireConsent(): Promise<void> {
      await clearPersistedEstimate();
      if (!mounted.current) return;
      showError('consent-expired', { ...context, step: 'consent' });
    }

    try {
      await persistEstimate(
        statusRow(parentMealId, context, 'uploading', nextTimestamp(), { consent }),
      );
      if (!mounted.current || closing.current) return;
      if (Date.now() >= consent.expiresAt) {
        await expireConsent();
        return;
      }
      setState({
        step: 'uploading',
        prepared: context.prepared,
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
      });
      await persistEstimate(
        statusRow(parentMealId, context, 'estimating', nextTimestamp(), { consent }),
      );
      if (!mounted.current || closing.current) return;
      if (Date.now() >= consent.expiresAt) {
        await expireConsent();
        return;
      }
      const response = await client.estimate({
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
        uploadBlobSha256: context.prepared.uploadBlobSha256,
        uploadBlob: context.prepared.uploadBlob,
      });
      if (!mounted.current || closing.current) return;
      if (!response.ok || response.status === 'in-flight') {
        const code = response.ok ? 'provider-timeout' : response.code;
        await persistFailure(code);
        if (!mounted.current) return;
        showError(code, { ...context, step: 'consent' });
        return;
      }
      if (Date.now() >= consent.expiresAt) {
        await expireConsent();
        return;
      }
      if (response.candidates.length < 1 || response.candidates.length > PHOTO_AI_LIMITS.candidates) {
        await persistFailure('invalid-estimate');
        if (!mounted.current) return;
        showError('invalid-estimate', { ...context, step: 'consent' });
        return;
      }
      await persistEstimate(
        statusRow(parentMealId, context, 'needs-confirmation', nextTimestamp(), {
          consent,
          requestFingerprint: response.requestFingerprint,
          candidates: response.candidates,
        }),
      );
      if (!mounted.current || closing.current) return;
      setState({
        step: 'confirming',
        prepared: context.prepared,
        requestId: context.requestId,
        candidates: response.candidates.map(editableCandidate),
      });
    } catch (cause) {
      if (!mounted.current || closing.current) return;
      if (!failureAttempted) {
        try {
          await persistFailure('provider-unavailable');
        } catch {
          // The original persistence/client failure remains the user-facing error.
        }
      }
      if (!mounted.current) return;
      showError(
        'provider-unavailable',
        { ...context, step: 'consent' },
        safeMessage(cause, photoAiErrorCopy('provider-unavailable')),
      );
    } finally {
      uploadLatch.current = false;
    }
  }

  async function restartAfterFailure(context: PreparedContext): Promise<void> {
    if (transitionLatch.current) return;
    transitionLatch.current = true;
    try {
      await clearPersistedEstimate();
      const next = newRequestContext(context.prepared);
      await persistEstimate(
        statusRow(parentMealId, next, 'awaiting-consent', nextTimestamp()),
      );
      if (!mounted.current) return;
      setState({ ...next, step: 'consent' });
    } catch (cause) {
      if (!mounted.current) return;
      showError(
        'invalid-estimate',
        { step: 'source' },
        safeMessage(cause, '无法重新开始识别，请改用手动记录'),
      );
    } finally {
      transitionLatch.current = false;
    }
  }

  function updateCandidates(
    context: Extract<PhotoFlowState, { step: 'confirming' }>,
    candidates: EditableCandidate[],
  ): void {
    setState({ ...context, candidates });
  }

  async function saveCandidates(
    context: Extract<PhotoFlowState, { step: 'confirming' }>,
  ): Promise<void> {
    if (saveLatch.current) return;
    const selected = context.candidates
      .filter((candidate) => candidate.enabled && candidate.candidate.nutrientSource !== 'none')
      .map((candidate) => ({
        ...candidate,
        confirmedName: candidate.confirmedName.trim(),
        confirmedPreparation: candidate.confirmedPreparation.trim(),
        confirmedAssumptions: candidate.confirmedAssumptions
          .map((assumption) => assumption.trim())
          .filter((assumption) => assumption.length > 0),
      }));
    if (selected.length === 0) {
      showError('invalid-estimate', context, '请至少保留一项可确认的食物');
      return;
    }
    if (
      selected.some(
        (candidate) =>
          candidate.confirmedName.length === 0 ||
          candidate.confirmedName.length > 120 ||
          candidate.confirmedPreparation.length > 120 ||
          candidate.confirmedAssumptions.length > 29 ||
          candidate.confirmedAssumptions.some((assumption) => assumption.length > 500) ||
          !Number.isFinite(candidate.confirmedAmount) ||
          candidate.confirmedAmount < 0.01 ||
          candidate.confirmedAmount > 100_000,
      )
    ) {
      showError('invalid-estimate', context, '请检查食物名称和实际数量');
      return;
    }
    saveLatch.current = true;
    setState({ ...context, step: 'saving' });
    try {
      await onConfirm({
        operationId: idempotencyKeyFor(context.requestId),
        date,
        slot,
        requestId: context.requestId,
        uploadBlobSha256: context.prepared.uploadBlobSha256,
        candidates: selected.map(({ enabled: _enabled, ...candidate }) => ({
          ...candidate,
          confirmedName: candidate.confirmedName,
          confirmedPreparation: candidate.confirmedPreparation,
          confirmedAssumptions: [...candidate.confirmedAssumptions],
        })),
        thumbnail: {
          blob: context.prepared.thumbnailBlob,
          width: context.prepared.thumbnailWidth,
          height: context.prepared.thumbnailHeight,
        },
      });
      if (!mounted.current) return;
      persistedEstimate.current = false;
      releasePrepared(context.prepared);
      onClose();
    } catch (cause) {
      if (!mounted.current) return;
      showError(
        'invalid-estimate',
        context,
        safeMessage(cause, '保存失败，请重试'),
      );
    } finally {
      saveLatch.current = false;
    }
  }

  async function logout(): Promise<void> {
    try {
      const response = await client.logout();
      if (!mounted.current) return;
      if (response.logoutUrl !== '/cdn-cgi/access/logout') {
        throw new Error('退出地址无效');
      }
      setLogoutUrl(response.logoutUrl);
      setState({ step: 'source' });
    } catch (cause) {
      if (!mounted.current) return;
      showError(
        'provider-unavailable',
        { step: 'source' },
        safeMessage(cause, '退出失败，请重试'),
      );
    }
  }

  function renderSource(logoutUrl?: '/cdn-cgi/access/logout') {
    return (
      <>
        <p className="rounded-2xl border border-line bg-bg p-4 text-sm leading-6 text-mute">
          请清晰拍摄整份食物，尽量保持光线均匀、餐盘完整，方便识别份量。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-raised px-4 py-2.5 text-sm font-bold text-ink focus-within:ring-2 focus-within:ring-iron">
            拍摄食物照片
            <input
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="拍摄食物照片"
              className="sr-only"
              onChange={chooseFile}
            />
          </label>
          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-raised px-4 py-2.5 text-sm font-bold text-ink focus-within:ring-2 focus-within:ring-iron">
            从相册选择
            <input
              type="file"
              accept="image/*"
              aria-label="从相册选择食物照片"
              className="sr-only"
              onChange={chooseFile}
            />
          </label>
        </div>
        <div className="grid gap-2">
          <Button variant="tertiary" fullWidth onClick={() => void logout()}>
            退出照片识别登录
          </Button>
          {logoutUrl === undefined ? null : (
            <a
              href={logoutUrl}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line text-sm font-bold text-ink"
            >
              继续退出照片识别登录
            </a>
          )}
          <Button variant="tertiary" fullWidth onClick={close}>
            改用手动记录
          </Button>
        </div>
      </>
    );
  }

  function renderConsent(context: PreparedContext) {
    return (
      <>
        <div className="rounded-2xl border border-line bg-bg p-4 text-sm leading-6 text-mute">
          <p>这张压缩图片会经 Cloudflare 转发到火山方舟，仅用于本次食物估算。</p>
          <p className="mt-2">铁证不会保存原始照片；上传授权在 {PHOTO_AI_LIMITS.consentMs / 60_000} 分钟后失效。</p>
          <p className="mt-2">第三方日志保留时间未知，请勿上传含人脸、证件或其他敏感信息的图片。</p>
          <a
            href={PHOTO_AI_PROVIDER_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-11 items-center font-bold text-amber underline underline-offset-4"
          >
            查看服务商隐私政策
          </a>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" fullWidth onClick={() => void cancelPrepared(context)}>
            取消这张照片
          </Button>
          <Button fullWidth onClick={() => void upload(context)} loading={uploadLatch.current}>
            同意并开始识别
          </Button>
        </div>
      </>
    );
  }

  function renderCandidates(
    context:
      | Extract<PhotoFlowState, { step: 'confirming' }>
      | Extract<PhotoFlowState, { step: 'saving' }>,
    localError?: string,
  ) {
    const locked = context.step === 'saving';
    const editableContext: Extract<PhotoFlowState, { step: 'confirming' }> = {
      ...context,
      step: 'confirming',
    };
    return (
      <>
        {localError ? (
          <p role="alert" className="rounded-xl border border-amber/50 bg-bg p-3 text-sm text-amber">
            {localError}
          </p>
        ) : null}
        <div className="space-y-3">
          {context.candidates.map((editable, index) => {
            const { candidate } = editable;
            const catalog =
              candidate.catalogFoodId === null
                ? undefined
                : foods.find((food) => food.id === candidate.catalogFoodId);
            const sourceCopy =
              candidate.nutrientSource === 'catalog'
                ? `本地食物目录 · ${catalog?.name ?? candidate.name}`
                : candidate.nutrientSource === 'model-range'
                  ? '模型区间估算 · 估算不确定性较高'
                  : '没有可靠营养数据，无法直接确认，请手动记录';
            return (
              <fieldset
                key={candidate.id}
                role="group"
                aria-label={`候选 ${candidate.name}`}
                disabled={locked}
                className="rounded-2xl border border-line bg-bg p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-ink">
                    <input
                      type="checkbox"
                      aria-label={`启用候选 ${index + 1}`}
                      checked={editable.enabled}
                      disabled={locked || candidate.nutrientSource === 'none'}
                      onChange={(event) => {
                        const candidates = context.candidates.map((row) =>
                          row.candidate.id === candidate.id
                            ? { ...row, enabled: event.target.checked }
                            : row,
                        );
                        updateCandidates(editableContext, candidates);
                      }}
                    />
                    {candidate.name}
                  </label>
                  <Button
                    variant="tertiary"
                    aria-label={`删除候选 ${candidate.name}`}
                    className="min-h-11 px-2"
                    disabled={locked}
                    onClick={() =>
                      updateCandidates(
                        editableContext,
                        context.candidates.filter((row) => row.candidate.id !== candidate.id),
                      )
                    }
                  >
                    删除
                  </Button>
                </div>
                <p className="mb-3 text-xs leading-5 text-mute">{sourceCopy}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs text-mute">
                    食物名称
                    <input
                      aria-label="食物名称"
                      maxLength={120}
                      className={CONTROL_CLASS}
                      value={editable.confirmedName}
                      onChange={(event) =>
                        updateCandidates(
                          editableContext,
                          context.candidates.map((row) =>
                            row.candidate.id === candidate.id
                              ? { ...row, confirmedName: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-mute">
                    处理方式
                    <input
                      aria-label="处理方式"
                      maxLength={120}
                      className={CONTROL_CLASS}
                      value={editable.confirmedPreparation}
                      onChange={(event) =>
                        updateCandidates(
                          editableContext,
                          context.candidates.map((row) =>
                            row.candidate.id === candidate.id
                              ? { ...row, confirmedPreparation: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-mute">
                    实际数量
                    <input
                      type="number"
                      min="0.01"
                      max="100000"
                      step="0.01"
                      aria-label="实际数量"
                      className={CONTROL_CLASS}
                      value={editable.confirmedAmount}
                      onChange={(event) =>
                        updateCandidates(
                          editableContext,
                          context.candidates.map((row) =>
                            row.candidate.id === candidate.id
                              ? { ...row, confirmedAmount: Number(event.target.value) }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-mute">
                    单位
                    <select
                      aria-label="单位"
                      className={CONTROL_CLASS}
                      value={editable.confirmedUnit}
                      onChange={(event) =>
                        updateCandidates(
                          editableContext,
                          context.candidates.map((row) =>
                            row.candidate.id === candidate.id
                              ? {
                                  ...row,
                                  confirmedUnit: event.target.value as 'g' | 'mL',
                                }
                              : row,
                          ),
                        )
                      }
                    >
                      <option value="g">g</option>
                      <option value="mL">mL</option>
                    </select>
                  </label>
                </div>
                <label className="mt-3 grid gap-1 text-xs text-mute">
                  确认说明
                  <textarea
                    aria-label="确认说明"
                    maxLength={500}
                    className={`${CONTROL_CLASS} min-h-20 py-3`}
                    value={editable.confirmedAssumptions.join('，')}
                    onChange={(event) =>
                      updateCandidates(
                        editableContext,
                        context.candidates.map((row) =>
                          row.candidate.id === candidate.id
                            ? { ...row, confirmedAssumptions: [event.target.value] }
                            : row,
                        ),
                      )
                    }
                  />
                </label>
              </fieldset>
            );
          })}
        </div>
        <Button
          fullWidth
          loading={locked}
          onClick={() => void saveCandidates(editableContext)}
        >
          {localError ? '重试保存' : `确认并加入${mealLabel}`}
        </Button>
      </>
    );
  }

  let title = `拍照识别${mealLabel}`;
  let body;
  if (state.step === 'checking-session') {
    body = <p role="status" className="py-8 text-center text-sm text-mute">正在检查识别权限…</p>;
  } else if (state.step === 'source') {
    body = renderSource(logoutUrl);
  } else if (state.step === 'preprocessing') {
    body = <p role="status" className="py-8 text-center text-sm text-mute">正在本机压缩照片…</p>;
  } else if (state.step === 'consent') {
    title = '确认单次上传';
    body = renderConsent(state);
  } else if (state.step === 'uploading') {
    body = <p role="status" className="py-8 text-center text-sm text-mute">正在识别食物，请稍候…</p>;
  } else if (state.step === 'confirming' || state.step === 'saving') {
    title = '确认识别结果';
    body = renderCandidates(state);
  } else if (state.previous.step === 'confirming') {
    title = '确认识别结果';
    body = renderCandidates(state.previous, errorMessage);
  } else {
    const retrySession = new Set<PhotoAiErrorCode>([
      'offline',
      'service-disabled',
      'quota-exceeded',
      'budget-exceeded',
      'rate-limited',
    ]).has(state.code);
    const previousConsent = state.previous.step === 'consent' ? state.previous : undefined;
    body = (
      <>
        <p role="alert" className="rounded-xl border border-amber/50 bg-bg p-3 text-sm text-amber">
          {errorMessage}
        </p>
        <div className="grid gap-2">
          {state.code === 'auth-required' || state.code === 'auth-expired' ? (
            <Button fullWidth onClick={onLogin}>登录后识别</Button>
          ) : previousConsent !== undefined ? (
            <Button fullWidth onClick={() => void restartAfterFailure(previousConsent)}>
              重新确认上传
            </Button>
          ) : retrySession ? (
            <Button fullWidth onClick={() => void checkSession()}>重试检查</Button>
          ) : (
            <Button fullWidth onClick={() => setState({ step: 'source' })}>
              重新选择照片
            </Button>
          )}
          <Button variant="tertiary" fullWidth onClick={close}>改用手动记录</Button>
        </div>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/70" aria-hidden={false}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-estimate-title"
        className="forged-surface max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border-x-0 border-b-0 p-5 text-ink transition motion-reduce:transition-none"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold tracking-[2px] text-amber">LOCAL + AI</p>
            <h2 id="photo-estimate-title" className="mt-1 text-lg font-extrabold">{title}</h2>
          </div>
          <Button
            variant="tertiary"
            aria-label="关闭照片识别"
            onClick={close}
            className="size-11 p-0"
          >
            ×
          </Button>
        </div>
        <div className="etch" />
        <div className="space-y-4">{body}</div>
      </div>
    </div>
  );
}

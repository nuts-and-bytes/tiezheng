import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../components/Button';
import { todayStr } from '../../lib/dates';
import { buildJsonExport, downloadText } from '../../lib/exportData';
import {
  BackupImportError,
  parseBackupFile,
  previewRestore,
  restoreBackup,
  type ModeRestorePreview,
  type RestoreCandidate,
  type RestoreMode,
} from '../../lib/importData';

interface Props {
  onRestored?: () => void;
}

function reloadAfterResult(): void {
  window.setTimeout(() => window.location.reload(), 800);
}

function errorMessage(error: unknown, fallback = '无法读取备份文件，请重试'): string {
  if (error instanceof BackupImportError) return error.message;
  return fallback;
}

function PreviewStat({ value, label }: { value: string; label: string }) {
  return (
    <span className="border-r border-line px-2 last:border-r-0">
      <b className="block text-lg font-extrabold leading-none text-ink tabular-nums">{value}</b>
      <span className="mt-1 block text-[10px] text-mute">{label}</span>
    </span>
  );
}

export function DataRestorePanel({ onRestored }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const entryButtonContainerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const fileRequestRef = useRef(0);
  const [candidate, setCandidate] = useState<RestoreCandidate | null>(null);
  const [candidateNonce, setCandidateNonce] = useState(0);
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [modePreview, setModePreview] = useState<ModeRestorePreview | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [photoDeleteConfirmed, setPhotoDeleteConfirmed] = useState(false);
  const [estimateDiscardConfirmed, setEstimateDiscardConfirmed] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function closePreview() {
    if (busyRef.current) return;
    setCandidate(null);
    setFileName('');
    setMode('merge');
    setModePreview(null);
    setPreviewFailed(false);
    setPhotoDeleteConfirmed(false);
    setEstimateDiscardConfirmed(false);
    setConfirmReplace(false);
    setBackupConfirmed(false);
  }

  function selectMode(nextMode: RestoreMode) {
    if (busyRef.current) return;
    setMode(nextMode);
    setModePreview(null);
    setPreviewFailed(false);
    setPhotoDeleteConfirmed(false);
    setEstimateDiscardConfirmed(false);
    setConfirmReplace(false);
    setBackupConfirmed(false);
    setError(null);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fileRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!candidate) return;
    const active = document.activeElement;
    const entryButton = entryButtonContainerRef.current?.querySelector('button') ?? null;
    previousFocusRef.current =
      active === inputRef.current
        ? entryButton
        : active instanceof HTMLElement
          ? active
          : entryButton;
    closeButtonRef.current?.focus();
    return () => previousFocusRef.current?.focus();
  }, [candidate]);

  useEffect(() => {
    if (busy && candidate) dialogRef.current?.focus();
  }, [busy, candidate]);

  useEffect(() => {
    if (!candidate) {
      setModePreview(null);
      setPreviewFailed(false);
      return;
    }
    let cancelled = false;
    setModePreview(null);
    setPreviewFailed(false);
    setPhotoDeleteConfirmed(false);
    setEstimateDiscardConfirmed(false);
    previewRestore(candidate, mode)
      .then((preview) => {
        if (!cancelled) setModePreview(preview);
      })
      .catch((cause) => {
        if (!cancelled) {
          setPreviewFailed(true);
          setError(errorMessage(cause, '无法计算恢复影响，请重试'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [candidate, candidateNonce, mode, previewNonce]);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) closePreview();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [
      ...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ];
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || busyRef.current) return;
    const requestId = ++fileRequestRef.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setCandidate(null);
    setModePreview(null);
    setPreviewFailed(false);
    setPhotoDeleteConfirmed(false);
    setEstimateDiscardConfirmed(false);
    setFileName('');
    setMode('merge');
    setConfirmReplace(false);
    setBackupConfirmed(false);
    try {
      const parsed = await parseBackupFile(file);
      if (!mountedRef.current || fileRequestRef.current !== requestId) return;
      setFileName(file.name);
      setCandidate(parsed);
      setCandidateNonce((value) => value + 1);
    } catch (cause) {
      if (mountedRef.current && fileRequestRef.current === requestId) {
        setError(errorMessage(cause));
      }
    } finally {
      if (fileRequestRef.current === requestId) {
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
        input.value = '';
      }
    }
  }

  async function submitRestore() {
    if (!candidate || !modePreview || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);

    if (mode === 'replace' && !confirmReplace) {
      try {
        const currentBackup = await buildJsonExport();
        downloadText(
          `tiezheng-before-restore-${todayStr()}.json`,
          currentBackup,
          'application/json',
        );
        if (mountedRef.current) {
          setConfirmReplace(true);
          setBackupConfirmed(false);
        }
      } catch {
        if (mountedRef.current) setError('无法保存当前数据，未执行覆盖');
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
      return;
    }

    try {
      const result = await restoreBackup(candidate, mode, {
        previewFingerprint: modePreview.fingerprint,
        allowPhotoDeletion: photoDeleteConfirmed,
        allowEstimateDiscard: estimateDiscardConfirmed,
      });
      if (mountedRef.current) {
        setCandidate(null);
        setSuccess(`已恢复 ${result.workoutDays} 天训练、${result.nutritionDays} 天饮食记录`);
        (onRestored ?? reloadAfterResult)();
      }
    } catch (cause) {
      if (mountedRef.current) {
        if (cause instanceof BackupImportError && cause.code === 'restore-preview-stale') {
          setModePreview(null);
          setPhotoDeleteConfirmed(false);
          setEstimateDiscardConfirmed(false);
          setConfirmReplace(false);
          setBackupConfirmed(false);
          setPreviewNonce((value) => value + 1);
        }
        setError(errorMessage(cause, '恢复失败，原数据未发生变化'));
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  const destructiveConfirmationMissing =
    !modePreview
    || (modePreview.mealPhotosToDelete > 0 && !photoDeleteConfirmed)
    || (modePreview.mealEstimatesToDiscard > 0 && !estimateDiscardConfirmed);

  const actionLabel =
    mode === 'merge' ? '开始安全合并' : confirmReplace ? '确认覆盖' : '准备完整覆盖';

  return (
    <div className="mt-2">
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleFile}
      />
      <div ref={entryButtonContainerRef}>
        <Button
          variant="tertiary"
          className="min-h-11 w-full"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy && !candidate ? '正在读取…' : '从 JSON 恢复'}
        </Button>
      </div>

      {error && !candidate && (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-iron">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-2 text-xs leading-relaxed text-amber">
          {success}
        </p>
      )}

      {candidate && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 px-3 pt-12 sm:items-center">
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-title"
            aria-busy={busy || undefined}
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
            className="mx-auto max-h-[calc(100dvh-3rem)] w-full max-w-md overflow-y-auto rounded-t-2xl border border-line bg-bg px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)] outline-none shadow-[0_-18px_60px_rgba(0,0,0,.45)] sm:rounded-2xl sm:pb-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold tracking-[2px] text-amber">JSON BACKUP</p>
                <h2 id="restore-title" className="mt-1 text-xl font-extrabold tracking-tight">
                  恢复数据
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                data-ui-control="restore-dialog-close"
                type="button"
                aria-label="关闭恢复面板"
                disabled={busy}
                onClick={closePreview}
                className="size-11 rounded-lg border border-line text-lg text-mute transition active:scale-95 focus-visible:ring-2 focus-visible:ring-iron disabled:opacity-40"
              >
                ×
              </button>
            </div>

            {error && (
              <p role="alert" className="mt-3 border-l-2 border-iron pl-3 text-xs leading-relaxed text-iron">
                {error}
              </p>
            )}

            <p className="mt-2 truncate text-xs font-semibold text-ink">{fileName}</p>
            <p className="mt-2 text-xs text-mute">
              备份于 {new Date(candidate.preview.exportedAt).toLocaleString('zh-CN')}
            </p>
            <div className="mt-4 grid grid-cols-4 border-y border-line py-3 text-center">
              <PreviewStat value={`${candidate.preview.workoutDays} 天`} label="训练" />
              <PreviewStat value={`${candidate.preview.exercises} 个`} label="动作" />
              <PreviewStat value={`${candidate.preview.sets} 组`} label="总组数" />
              <PreviewStat value={`${candidate.preview.weightLogs} 条`} label="体重" />
            </div>
            <div
              aria-label="饮食备份预览"
              className="mt-3 grid grid-cols-4 border-b border-line pb-3 text-center"
            >
              <PreviewStat value={`${candidate.preview.nutritionPlans} 份`} label="营养计划" />
              <PreviewStat value={`${candidate.preview.nutritionDays} 天`} label="饮食" />
              <PreviewStat value={`${candidate.preview.meals} 餐`} label="餐次" />
              <PreviewStat value={`${candidate.preview.mealItems} 项`} label="食物" />
            </div>

            <fieldset className="mt-5 space-y-2.5" disabled={busy || confirmReplace}>
              <legend className="mb-2 text-xs font-semibold text-mute">选择恢复方式</legend>
              <label
                className={`block min-h-24 cursor-pointer rounded-xl border p-4 transition active:scale-[.99] ${
                  mode === 'merge' ? 'border-amber bg-raised' : 'border-line bg-raised/45'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="restore-mode"
                    value="merge"
                    checked={mode === 'merge'}
                    onChange={() => selectMode('merge')}
                    className="accent-current"
                  />
                  <b className="text-sm">安全合并（推荐）</b>
                </span>
                <span className="mt-2 block pl-6 text-xs leading-relaxed text-mute">
                  保留当前记录，并加入备份数据。同一天发生冲突时，以备份记录为准。
                </span>
              </label>

              <label
                className={`block min-h-24 cursor-pointer rounded-xl border p-4 transition active:scale-[.99] ${
                  mode === 'replace' ? 'border-iron bg-raised' : 'border-line bg-raised/45'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="restore-mode"
                    value="replace"
                    checked={mode === 'replace'}
                    onChange={() => selectMode('replace')}
                    className="accent-current"
                  />
                  <b className={mode === 'replace' ? 'text-sm text-iron' : 'text-sm'}>完整覆盖</b>
                </span>
                <span className="mt-2 block pl-6 text-xs leading-relaxed text-mute">
                  用备份替换当前训练、动作、体重、个人设置、营养计划、餐次、食物条目和自定义食物。覆盖前会自动下载当前数据备份。
                </span>
              </label>
            </fieldset>

            <div className="mt-4 space-y-3 border-l-2 border-amber pl-3 text-xs leading-relaxed text-mute">
              <p>体型照不参与恢复，也不会被改动。餐食缩略图不在备份中。</p>
              {modePreview && modePreview.mealPhotosToDelete > 0 && (
                <label className="flex min-h-11 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label="我确认删除上述餐食缩略图"
                    disabled={busy}
                    checked={photoDeleteConfirmed}
                    onChange={(event) => setPhotoDeleteConfirmed(event.currentTarget.checked)}
                    className="size-4 shrink-0 accent-current focus-visible:ring-2 focus-visible:ring-iron"
                  />
                  <span>
                    将删除 {modePreview.mealPhotosToDelete} 张仅存本机的餐食缩略图
                    <span className="block">我确认删除上述餐食缩略图</span>
                  </span>
                </label>
              )}
              {modePreview && modePreview.mealEstimatesToDiscard > 0 && (
                <label className="flex min-h-11 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label="我确认丢弃上述未保存候选"
                    disabled={busy}
                    checked={estimateDiscardConfirmed}
                    onChange={(event) => setEstimateDiscardConfirmed(event.currentTarget.checked)}
                    className="size-4 shrink-0 accent-current focus-visible:ring-2 focus-visible:ring-iron"
                  />
                  <span>
                    将丢弃 {modePreview.mealEstimatesToDiscard} 份未保存的识别候选
                    <span className="block">我确认丢弃上述未保存候选</span>
                  </span>
                </label>
              )}
              {!modePreview && !previewFailed && (
                <p role="status">正在计算本机恢复影响…</p>
              )}
              {previewFailed && (
                <Button
                  variant="tertiary"
                  className="min-h-11 px-0"
                  onClick={() => {
                    setError(null);
                    setPreviewNonce((value) => value + 1);
                  }}
                >
                  重新计算恢复影响
                </Button>
              )}
            </div>

            {confirmReplace && (
              <div className="mt-4 rounded-lg border border-iron/60 px-3 py-3 text-xs leading-relaxed text-iron">
                <p>已发起当前数据备份下载。请确认文件已保存，再继续覆盖。</p>
                <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-ink">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={backupConfirmed}
                    onChange={(event) => setBackupConfirmed(event.currentTarget.checked)}
                    className="size-4 accent-current"
                  />
                  <span>我已确认当前备份文件已保存</span>
                </label>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <Button
                variant="tertiary"
                className="min-h-11 flex-1"
                disabled={busy}
                onClick={closePreview}
              >
                取消
              </Button>
              <Button
                variant={mode === 'replace' ? 'secondary' : 'primary'}
                className={`min-h-11 flex-[1.6] ${confirmReplace ? 'border-iron text-iron' : ''}`}
                disabled={busy || destructiveConfirmationMissing || (confirmReplace && !backupConfirmed)}
                onClick={submitRestore}
              >
                {busy ? '处理中…' : actionLabel}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

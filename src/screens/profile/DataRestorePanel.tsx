import { useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { todayStr } from '../../lib/dates';
import { buildJsonExport, downloadText } from '../../lib/exportData';
import {
  BackupImportError,
  parseBackupFile,
  restoreBackup,
  type RestoreCandidate,
  type RestoreMode,
} from '../../lib/importData';

interface Props {
  onRestored?: () => void;
}

function reloadAfterResult(): void {
  window.setTimeout(() => window.location.reload(), 800);
}

function errorMessage(error: unknown): string {
  if (error instanceof BackupImportError) return error.message;
  return '无法读取备份文件，请重试';
}

function PreviewStat({ value, label }: { value: string; label: string }) {
  return (
    <span className="border-r border-line px-2 last:border-r-0">
      <b className="block text-lg font-extrabold leading-none text-text tabular-nums">{value}</b>
      <span className="mt-1 block text-[10px] text-mute">{label}</span>
    </span>
  );
}

export function DataRestorePanel({ onRestored }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = useState<RestoreCandidate | null>(null);
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function closePreview() {
    if (busy) return;
    setCandidate(null);
    setMode('merge');
    setConfirmReplace(false);
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setCandidate(null);
    setMode('merge');
    setConfirmReplace(false);
    try {
      setCandidate(await parseBackupFile(file));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      input.value = '';
    }
  }

  async function submitRestore() {
    if (!candidate || busy) return;
    setError(null);

    if (mode === 'replace' && !confirmReplace) {
      setBusy(true);
      try {
        const currentBackup = await buildJsonExport();
        downloadText(
          `tiezheng-before-restore-${todayStr()}.json`,
          currentBackup,
          'application/json',
        );
        setConfirmReplace(true);
      } catch {
        setError('无法保存当前数据，未执行覆盖');
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const result = await restoreBackup(candidate, mode);
      setCandidate(null);
      setSuccess(`已恢复 ${result.workoutDays} 天训练记录`);
      (onRestored ?? reloadAfterResult)();
    } catch (cause) {
      setError(
        cause instanceof BackupImportError
          ? cause.message
          : '恢复失败，原数据未发生变化',
      );
    } finally {
      setBusy(false);
    }
  }

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
      <Button
        variant="tertiary"
        className="min-h-11 w-full"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy && !candidate ? '正在读取…' : '从 JSON 恢复'}
      </Button>

      {error && (
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-title"
            className="mx-auto max-h-[calc(100dvh-3rem)] w-full max-w-md overflow-y-auto rounded-t-2xl border border-line bg-base px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-[0_-18px_60px_rgba(0,0,0,.45)] sm:rounded-2xl sm:pb-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold tracking-[2px] text-amber">JSON BACKUP</p>
                <h2 id="restore-title" className="mt-1 text-xl font-extrabold tracking-tight">
                  恢复数据
                </h2>
              </div>
              <button
                type="button"
                aria-label="关闭恢复面板"
                disabled={busy}
                onClick={closePreview}
                className="size-11 rounded-lg border border-line text-lg text-mute transition active:scale-95 focus-visible:ring-2 focus-visible:ring-iron disabled:opacity-40"
              >
                ×
              </button>
            </div>

            <p className="mt-2 text-xs text-mute">
              备份于 {new Date(candidate.preview.exportedAt).toLocaleString('zh-CN')}
            </p>
            <div className="mt-4 grid grid-cols-4 border-y border-line py-3 text-center">
              <PreviewStat value={`${candidate.preview.workoutDays} 天`} label="训练" />
              <PreviewStat value={`${candidate.preview.exercises} 个`} label="动作" />
              <PreviewStat value={`${candidate.preview.sets} 组`} label="总组数" />
              <PreviewStat value={`${candidate.preview.weightLogs} 条`} label="体重" />
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
                    onChange={() => {
                      setMode('merge');
                      setConfirmReplace(false);
                    }}
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
                    onChange={() => {
                      setMode('replace');
                      setConfirmReplace(false);
                    }}
                    className="accent-current"
                  />
                  <b className={mode === 'replace' ? 'text-sm text-iron' : 'text-sm'}>完整覆盖</b>
                </span>
                <span className="mt-2 block pl-6 text-xs leading-relaxed text-mute">
                  用备份替换当前训练、动作、体重和个人设置。覆盖前会自动下载当前数据备份。
                </span>
              </label>
            </fieldset>

            <p className="mt-4 border-l-2 border-amber pl-3 text-xs leading-relaxed text-mute">
              照片不包含在备份中，本次恢复不会改动本机照片。
            </p>

            {confirmReplace && (
              <p className="mt-4 rounded-lg border border-iron/60 px-3 py-2.5 text-xs leading-relaxed text-iron">
                当前数据备份已下载。再次确认后，训练、动作、体重和个人设置将被替换。
              </p>
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
                disabled={busy}
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

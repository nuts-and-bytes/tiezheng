import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BODY_PARTS, bodyPartInfo } from '../data/bodyParts';
import { db } from '../lib/db';
import { loadModeOf, type BodyPart, type Exercise, type LoadMode } from '../lib/types';
import {
  addCustomExercise,
  listByPart,
  removeExercise,
  renameExercise,
  setExerciseLoadMode,
} from '../repos/exerciseRepo';
import { PartIcon } from './PartIcon';
import { Button } from './Button';

/** 「我的」页里的一行设置项：折叠时只是一条细线上的行，展开才长出管理面板 */
export function ExerciseManager() {
  const [open, setOpen] = useState(false);
  const [part, setPart] = useState<BodyPart>('chest');
  const [newName, setNewName] = useState('');
  const [newLoadMode, setNewLoadMode] = useState<LoadMode>('external');
  // 门闩：写库期间重入直接返回（ref 保证同 tick 连点也拦得住，LogFlow 判例）
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const list = useLiveQuery(() => listByPart(part), [part]);
  // 在库总数：exerciseRepo 没有 count helper，直接读表（软删行不算）
  const total = useLiveQuery(() => db.exercises.filter((e) => e.deletedAt === null).count(), []);
  const info = bodyPartInfo(part);

  async function create() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await addCustomExercise(newName, part, newLoadMode);
      setNewName('');
      setNewLoadMode('external');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function rename(ex: Exercise) {
    if (busyRef.current) return;
    const name = window.prompt('新名称', ex.name);
    if (!name || !name.trim()) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await renameExercise(ex.id, name);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function remove(ex: Exercise) {
    if (busyRef.current) return;
    if (!window.confirm(`删除「${ex.name}」？已有记录不受影响。`)) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await removeExercise(ex.id);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function changeLoadMode(ex: Exercise) {
    if (busyRef.current) return;
    const nextMode: LoadMode = loadModeOf(ex) === 'external' ? 'assistance' : 'external';
    const nextLabel = nextMode === 'external' ? '普通负重' : '辅助重量';
    if (!window.confirm(
      `将「${ex.name}」改为${nextLabel}？历史趋势与纪录会重新解释，原始组数据不变。`,
    )) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await setExerciseLoadMode(ex.id, nextMode);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line" aria-busy={busy}>
      <button
        data-ui-control="disclosure"
        type="button"
        onClick={() => setOpen(!open)}
        className="flex min-h-14 w-full items-center gap-3.5 rounded-xl py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-iron"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-raised">
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            className="text-mute"
            aria-hidden
          >
            <path d="M4 9v6M7 7.5v9M17 7.5v9M20 9v6M7 12h10" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[15px] font-semibold">动作库</b>
          <span className="mt-0.5 block text-xs text-mute">预置 + 你自己的动作</span>
        </span>
        <span className="text-sm font-semibold tabular-nums">{total ?? 0} 个</span>
        <span className="text-xs text-mute">{open ? '收起' : '展开'}</span>
      </button>

      {open && (
        <div className="pb-5">
          <div className="mb-1 flex flex-wrap gap-1.5">
            {BODY_PARTS.map((p) => (
              <button
                data-ui-control="segment"
                key={p.id}
                type="button"
                onClick={() => setPart(p.id)}
                className={`min-h-11 rounded-lg px-2.5 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-iron ${
                  part === p.id
                    ? 'bg-iron/15 font-semibold text-iron'
                    : 'border border-line bg-raised text-mute'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <ul className="flex flex-col">
            {list?.map((ex) => (
              <li
                key={ex.id}
                className="flex items-center gap-2.5 border-t border-line py-2.5 text-sm"
              >
                <PartIcon part={ex.bodyPart} size={16} />
                <span className="min-w-0 flex-1 truncate">{ex.name}</span>
                {ex.preset && (
                  <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-mute">
                    预置
                  </span>
                )}
                <span className="text-xs text-mute">
                  {loadModeOf(ex) === 'external' ? '普通负重' : '辅助重量'}
                </span>
                <Button
                  variant="tertiary"
                  onClick={() => changeLoadMode(ex)}
                  aria-label={`将${ex.name}改为${
                    loadModeOf(ex) === 'external' ? '辅助重量' : '普通负重'
                  }`}
                  disabled={busy}
                  className="min-h-9 px-1 text-xs"
                >
                  改类型
                </Button>
                {!ex.preset && (
                  <>
                    <Button
                      variant="tertiary"
                      onClick={() => rename(ex)}
                      disabled={busy}
                      className="min-h-9 px-1 text-xs"
                    >
                      改名
                    </Button>
                    <Button
                      variant="tertiary"
                      onClick={() => remove(ex)}
                      disabled={busy}
                      className="min-h-9 px-1 text-xs text-iron"
                    >
                      删除
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={busy}
              placeholder={`新建${info.name}动作…`}
              className="flex-1 rounded-xl border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-mute"
            />
            <select
              aria-label="重量类型"
              value={newLoadMode}
              onChange={(e) => setNewLoadMode(e.target.value as LoadMode)}
              disabled={busy}
              className="rounded-xl border border-line bg-raised px-3 py-2 text-sm text-ink"
            >
              <option value="external">普通负重</option>
              <option value="assistance">辅助重量</option>
            </select>
            <Button
              variant="secondary"
              disabled={newName.trim() === '' || busy}
              onClick={() => create()}
              className="px-3.5 text-iron"
            >
              新建
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

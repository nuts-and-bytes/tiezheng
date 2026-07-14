import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BODY_PARTS, bodyPartInfo } from '../data/bodyParts';
import { db } from '../lib/db';
import type { BodyPart, Exercise } from '../lib/types';
import { addCustomExercise, listByPart, removeExercise, renameExercise } from '../repos/exerciseRepo';
import { PartIcon } from './PartIcon';

/** 「我的」页里的一行设置项：折叠时只是一条细线上的行，展开才长出管理面板 */
export function ExerciseManager() {
  const [open, setOpen] = useState(false);
  const [part, setPart] = useState<BodyPart>('chest');
  const [newName, setNewName] = useState('');
  // 门闩：写库期间重入直接返回（ref 保证同 tick 连点也拦得住，LogFlow 判例）
  const busyRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const list = useLiveQuery(() => listByPart(part), [part]);
  // 在库总数：exerciseRepo 没有 count helper，直接读表（软删行不算）
  const total = useLiveQuery(() => db.exercises.filter((e) => e.deletedAt === null).count(), []);
  const info = bodyPartInfo(part);

  async function create() {
    if (busyRef.current) return;
    busyRef.current = true;
    setCreating(true);
    try {
      await addCustomExercise(newName, part);
      setNewName('');
    } finally {
      busyRef.current = false;
      setCreating(false);
    }
  }

  async function rename(ex: Exercise) {
    if (busyRef.current) return;
    const name = window.prompt('新名称', ex.name);
    if (!name || !name.trim()) return;
    busyRef.current = true;
    try {
      await renameExercise(ex.id, name);
    } finally {
      busyRef.current = false;
    }
  }

  async function remove(ex: Exercise) {
    if (busyRef.current) return;
    if (!window.confirm(`删除「${ex.name}」？已有记录不受影响。`)) return;
    busyRef.current = true;
    try {
      await removeExercise(ex.id);
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <div className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3.5 py-4 text-left"
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
                key={p.id}
                type="button"
                onClick={() => setPart(p.id)}
                className={`rounded-lg px-2.5 py-1 text-xs ${
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
                {!ex.preset && (
                  <>
                    <button
                      type="button"
                      onClick={() => rename(ex)}
                      className="px-1 text-xs text-mute active:scale-95"
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(ex)}
                      className="px-1 text-xs text-iron active:scale-95"
                    >
                      删除
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={`新建${info.name}动作…`}
              className="flex-1 rounded-xl border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-mute"
            />
            <button
              type="button"
              disabled={newName.trim() === '' || creating}
              onClick={() => create()}
              className="rounded-xl border border-iron/40 px-3.5 py-2 text-sm font-semibold text-iron disabled:opacity-30 active:scale-95"
            >
              新建
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

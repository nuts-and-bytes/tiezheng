import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BODY_PARTS, bodyPartInfo } from '../data/bodyParts';
import type { BodyPart } from '../lib/types';
import { addCustomExercise, listByPart, removeExercise, renameExercise } from '../repos/exerciseRepo';

export function ExerciseManager() {
  const [open, setOpen] = useState(false);
  const [part, setPart] = useState<BodyPart>('chest');
  const [newName, setNewName] = useState('');
  const list = useLiveQuery(() => listByPart(part), [part]);
  const info = bodyPartInfo(part);

  return (
    <div className="rounded-2xl bg-card p-5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between"
      >
        <h2 className="text-sm font-semibold text-mute">动作库管理</h2>
        <span className="text-sm text-iron">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {BODY_PARTS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPart(p.id)}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  part === p.id ? 'bg-iron/15 font-semibold text-iron' : 'bg-card2 text-mute'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <ul className="flex flex-col gap-2">
            {list?.map((ex) => (
              <li key={ex.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{ex.name}</span>
                {ex.preset && <span className="rounded bg-card2 px-1.5 py-0.5 text-[10px] text-mute">预置</span>}
                {!ex.preset && (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        const name = window.prompt('新名称', ex.name);
                        if (name && name.trim()) await renameExercise(ex.id, name);
                      }}
                      className="text-mute"
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (window.confirm(`删除「${ex.name}」？已有记录不受影响。`)) {
                          await removeExercise(ex.id);
                        }
                      }}
                      className="text-iron"
                    >
                      删除
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={`新建${info.name}动作…`}
              className="flex-1 rounded-lg bg-card2 px-3 py-2 text-sm text-ink placeholder:text-mute/60"
            />
            <button
              type="button"
              disabled={newName.trim() === ''}
              onClick={async () => {
                await addCustomExercise(newName, part);
                setNewName('');
              }}
              className="rounded-lg bg-card2 px-3 py-2 text-sm text-iron disabled:opacity-30"
            >
              新建
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

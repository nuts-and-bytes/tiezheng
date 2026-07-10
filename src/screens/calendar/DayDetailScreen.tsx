import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { SetRows } from '../../components/SetRows';
import { bodyPartInfo } from '../../data/bodyParts';
import { sanitizeSets } from '../../lib/validation';
import { getWeight } from '../../repos/weightRepo';
import { getDayItems, removeWorkoutItem, updateItemSets, type DayItem } from '../../repos/workoutRepo';

export function DayDetailScreen() {
  const { date = '' } = useParams();
  const nav = useNavigate();
  const items = useLiveQuery(() => getDayItems(date), [date]);
  const weight = useLiveQuery(() => getWeight(date), [date]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-8 pt-[max(env(safe-area-inset-top),16px)]">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => nav(-1)} className="py-2 pr-2 text-mute">
          返回
        </button>
        <h1 className="text-xl font-bold">{date}</h1>
      </header>

      {items && items.length === 0 && <p className="py-8 text-center text-mute">这天没有训练记录</p>}

      {items?.map((item) => (
        <ItemCard key={item.id} item={item} />
      ))}

      {weight && (
        <div className="flex items-center justify-between rounded-2xl bg-card p-4">
          <span className="text-sm text-mute">当日体重</span>
          <span className="text-xl font-bold">{weight.weightKg.toFixed(1)} kg</span>
        </div>
      )}
    </div>
  );
}

function ItemCard({ item }: { item: DayItem }) {
  const [editing, setEditing] = useState(false);
  const [sets, setSets] = useState(item.sets);
  const info = bodyPartInfo(item.exercise.bodyPart);

  const summary = item.sets
    .map((s) => (s.weight !== undefined && s.reps !== undefined ? `${s.weight}×${s.reps}` : null))
    .filter((s) => s !== null);

  return (
    <div className="rounded-2xl bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: info.color }} />
        <span className="flex-1 font-semibold">{item.exercise.name}</span>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setSets(item.sets);
              setEditing(true);
            }}
            className="text-sm text-iron"
          >
            编辑
          </button>
        )}
      </div>
      {!editing && (
        <p className="text-sm text-mute">
          {summary.length > 0 ? summary.join('  ') : `${item.sets.length} 组`}
        </p>
      )}
      {editing && (
        <div className="flex flex-col gap-3">
          <SetRows sets={sets} onChange={setSets} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                await updateItemSets(item.id, sanitizeSets(sets));
                setEditing(false);
              }}
              className="flex-1 rounded-lg bg-iron py-2 text-sm font-semibold text-white active:scale-95"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex-1 rounded-lg bg-card2 py-2 text-sm text-ink active:scale-95"
            >
              取消
            </button>
            <button
              type="button"
              onClick={async () => {
                if (window.confirm('删除这个动作记录？')) await removeWorkoutItem(item.id);
              }}
              className="flex-1 rounded-lg bg-card2 py-2 text-sm text-iron active:scale-95"
            >
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

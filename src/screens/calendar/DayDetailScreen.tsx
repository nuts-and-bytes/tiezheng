import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { PartIcon } from '../../components/PartIcon';
import { PhotoCard } from '../../components/PhotoCard';
import { SetRows } from '../../components/SetRows';
import { bodyPartInfo } from '../../data/bodyParts';
import { setLabels } from '../../lib/setLabel';
import { hasOutOfRange, sanitizeSets } from '../../lib/validation';
import { getWeight } from '../../repos/weightRepo';
import { getDayItems, removeWorkoutItem, updateItemSets, type DayItem } from '../../repos/workoutRepo';

export function DayDetailScreen() {
  const { date = '' } = useParams();
  const nav = useNavigate();
  const items = useLiveQuery(() => getDayItems(date), [date]);
  const weight = useLiveQuery(() => getWeight(date), [date]);

  const totalSets = items?.reduce((n, i) => n + i.sets.length, 0) ?? 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-[max(env(safe-area-inset-top),16px)]">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => nav(-1)}
          className="-ml-1 py-2 pr-2 text-sm text-mute active:scale-95"
        >
          返回
        </button>
      </header>

      <div className="mt-2 flex items-baseline justify-between">
        {/* Anton 无中文字形：这里只有数字和连字符，安全 */}
        <h1 className="display text-[34px] leading-none">{date}</h1>
        {totalSets > 0 && (
          <span className="text-[11px] text-mute">
            <span className="display text-sm text-ink">{totalSets}</span> 组
          </span>
        )}
      </div>

      <div className="etch" />

      {items && items.length === 0 && (
        <p className="py-10 text-center text-sm text-mute">这天没有训练记录</p>
      )}

      {items?.map((item, i) => (
        <div key={item.id}>
          {i > 0 && <div className="etch" />}
          <ItemRow item={item} />
        </div>
      ))}

      {weight && (
        <>
          <div className="etch" />
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-mute">当日体重</span>
            <span className="display text-xl text-ink">{weight.weightKg.toFixed(1)} kg</span>
          </div>
        </>
      )}

      <div className="etch" />

      <PhotoCard date={date} />
    </div>
  );
}

function ItemRow({ item }: { item: DayItem }) {
  const [editing, setEditing] = useState(false);
  const [sets, setSets] = useState(item.sets);
  const info = bodyPartInfo(item.exercise.bodyPart);

  const summary = setLabels(item.sets);

  return (
    <div className="py-1">
      <div className="flex items-center gap-2.5">
        <span data-part={info.id} className="flex shrink-0">
          <PartIcon part={info.id} size={18} />
        </span>
        <span className="flex-1 font-semibold text-ink">{item.exercise.name}</span>
        <span className="text-[11px] text-mute">{info.name}</span>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setSets(item.sets);
              setEditing(true);
            }}
            className="pl-2 text-sm text-mute active:scale-95"
          >
            编辑
          </button>
        )}
      </div>

      {!editing && (
        <p className="mt-1.5 pl-[30px] text-sm text-mute">
          {summary.length > 0 ? summary.join('  ') : `${item.sets.length} 组`}
        </p>
      )}

      {editing && (
        <div className="mt-3 flex flex-col gap-3">
          <SetRows sets={sets} onChange={setSets} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={hasOutOfRange(sets)}
              onClick={async () => {
                await updateItemSets(item.id, sanitizeSets(sets));
                setEditing(false);
              }}
              className="heat flex-[2] rounded-xl py-2.5 text-sm font-extrabold text-white shadow-[0_6px_20px_rgba(255,92,31,.3)] disabled:opacity-30 disabled:shadow-none active:scale-[.98]"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex-1 rounded-xl border border-line bg-raised py-2.5 text-sm text-ink active:scale-95"
            >
              取消
            </button>
          </div>
          {/* 破坏性操作压到最低视觉重量：不跟「取消」抢手感，误触靠 confirm 兜底 */}
          <button
            type="button"
            onClick={async () => {
              if (window.confirm('删除这个动作记录？')) await removeWorkoutItem(item.id);
            }}
            className="self-end py-1 text-xs text-mute underline underline-offset-4 active:scale-95"
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}

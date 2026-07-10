import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { bodyPartInfo } from '../../data/bodyParts';
import { monthGrid, shiftMonth, todayStr } from '../../lib/dates';
import type { BodyPart } from '../../lib/types';
import { getExercisesByIds } from '../../repos/exerciseRepo';
import { listPhotoDates } from '../../repos/photoRepo';
import { listItemsInRange } from '../../repos/workoutRepo';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function CalendarScreen() {
  const today = todayStr();
  const [ym, setYm] = useState(today.slice(0, 7));
  const grid = monthGrid(ym);
  const from = grid[0];
  const to = grid[41];

  const data = useLiveQuery(async () => {
    const [items, photos] = await Promise.all([listItemsInRange(from, to), listPhotoDates(from, to)]);
    const exMap = await getExercisesByIds([...new Set(items.map((i) => i.exerciseId))]);
    const parts = new Map<string, Set<BodyPart>>();
    for (const item of items) {
      const part = exMap.get(item.exerciseId)?.bodyPart;
      if (!part) continue;
      if (!parts.has(item.date)) parts.set(item.date, new Set());
      parts.get(item.date)!.add(part);
    }
    return { parts, photos };
  }, [from, to]);

  const [yyyy, mm] = ym.split('-');

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {yyyy}年{Number(mm)}月
        </h1>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="上个月"
            onClick={() => setYm(shiftMonth(ym, -1))}
            className="h-9 w-9 rounded-lg bg-card text-mute active:scale-95"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="下个月"
            onClick={() => setYm(shiftMonth(ym, 1))}
            className="h-9 w-9 rounded-lg bg-card text-mute active:scale-95"
          >
            ›
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-mute">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((date) => {
          const inMonth = date.startsWith(ym);
          const parts = data?.parts.get(date);
          const hasPhoto = data?.photos.has(date) ?? false;
          return (
            <Link
              key={date}
              to={`/day/${date}`}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm ${
                parts ? 'bg-card' : ''
              } ${inMonth ? 'text-ink' : 'text-mute/40'} ${
                date === today ? 'ring-1 ring-iron' : ''
              }`}
            >
              {hasPhoto && <span className="absolute right-0.5 top-0.5 text-[8px]">📷</span>}
              {Number(date.slice(8))}
              <span className="mt-0.5 flex h-1.5 gap-0.5">
                {parts &&
                  [...parts].slice(0, 4).map((p) => (
                    <span
                      key={p}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: bodyPartInfo(p).color }}
                    />
                  ))}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

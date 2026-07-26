import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { defaultRailDate, monthRailDays, summarizeRailDay } from '../../lib/calendar';
import { datesOfMonth, shiftMonth, todayStr } from '../../lib/dates';
import { longestStreak } from '../../lib/stats';
import { getExercisesByIds } from '../../repos/exerciseRepo';
import { listPhotoDates } from '../../repos/photoRepo';
import { listItemsInRange } from '../../repos/workoutRepo';
import { MonthRail } from './MonthRail';
import { SelectedDayCard } from './SelectedDayCard';

const CN_MONTHS = [
  '一月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月',
];

export function CalendarScreen() {
  const today = todayStr();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const dates = datesOfMonth(ym);
  const from = dates[0];
  const to = dates.at(-1)!;

  const data = useLiveQuery(async () => {
    const [items, photos] = await Promise.all([listItemsInRange(from, to), listPhotoDates(from, to)]);
    const exMap = await getExercisesByIds([...new Set(items.map((item) => item.exerciseId))]);
    const railDays = monthRailDays(ym, items, exMap);
    const workoutDates = railDays.filter((day) => day.trained).map((day) => day.date);

    return {
      items,
      photos,
      exMap,
      railDays,
      workoutDates,
      days: workoutDates.length,
      streak: longestStreak(workoutDates),
      sets: railDays.reduce((total, day) => total + day.sets, 0),
    };
  }, [from, to, ym]);

  const selectionStillExists = data?.workoutDates.includes(selectedDate ?? '') ?? false;
  const activeDate = selectionStillExists
    ? selectedDate
    : data
      ? defaultRailDate(ym, data.workoutDates, today)
      : null;
  const summary = activeDate && data
    ? summarizeRailDay(activeDate, data.items, data.exMap)
    : null;
  const [yyyy, mm] = ym.split('-');

  return (
    <div className="flex min-w-0 flex-col overflow-x-hidden px-5 pb-8 pt-6">
      <header className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <span data-testid="month-num" className="display heat-text text-[64px] leading-[0.8]">
            {mm}
          </span>
          <span className="truncate text-[13px] tracking-[3px] text-mute">
            {`${yyyy} ${CN_MONTHS[Number(mm) - 1]}`}
          </span>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            aria-label="上个月"
            onClick={() => setYm(shiftMonth(ym, -1))}
            className="flex size-10 items-center justify-center rounded-xl border border-line bg-raised text-xl text-mute transition active:scale-95"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="下个月"
            onClick={() => setYm(shiftMonth(ym, 1))}
            className="flex size-10 items-center justify-center rounded-xl border border-line bg-raised text-xl text-mute transition active:scale-95"
          >
            ›
          </button>
        </div>
      </header>

      <div className="mt-6 min-h-[48px]">
        {data && (data.days === 0 ? (
          <p data-testid="month-empty" className="text-[13px] leading-[1.7] text-mute">
            这个月还没有一条铁证。
            <br />
            练一次，这里就会落下第一枚钢印。
          </p>
        ) : (
          <div data-testid="month-stats" className="flex">
            <Stat value={data.days} label="本月打卡" />
            <Stat value={data.streak} label="本月最长连续" accent />
            <Stat value={data.sets} label="本月组数" last />
          </div>
        ))}
      </div>

      <div className="etch" />

      {data && (
        <section aria-labelledby="month-rail-title">
          <div className="mb-1 flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.18em] text-iron">MONTH TRACK</p>
              <h2 id="month-rail-title" className="mt-1 text-base font-bold text-ink">月度训练轨道</h2>
            </div>
            <p className="text-right text-[10px] leading-relaxed text-mute">柱高代表组数<br />颜色代表部位</p>
          </div>
          <MonthRail days={data.railDays} selectedDate={activeDate} onSelect={setSelectedDate} />
        </section>
      )}

      {summary && data && (
        <div className="mt-5">
          <SelectedDayCard
            summary={summary}
            today={today}
            hasPhoto={data.photos.has(summary.date)}
          />
        </div>
      )}
    </div>
  );
}

function Stat({
  value,
  label,
  accent,
  last,
}: {
  value: number;
  label: string;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`flex-1 ${last ? '' : 'border-r border-line'}`}>
      <div className={`display text-[26px] leading-none ${accent ? 'text-amber' : 'text-ink'}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-mute">{label}</div>
    </div>
  );
}

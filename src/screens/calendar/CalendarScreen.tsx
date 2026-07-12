import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { PartIcon } from '../../components/PartIcon';
import { BODY_PARTS, bodyPartInfo } from '../../data/bodyParts';
import { monthGrid, shiftMonth, todayStr } from '../../lib/dates';
import { EMPTY_HEAT, heatColor } from '../../lib/heat';
import { dailyPartLoad, longestStreak, percentile } from '../../lib/stats';
import type { BodyPart } from '../../lib/types';
import { getExercisesByIds } from '../../repos/exerciseRepo';
import { listPhotoDates } from '../../repos/photoRepo';
import { listItemsInRange } from '../../repos/workoutRepo';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
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

/** 格子里的数字/图标压在部位色上：亮到 amber 也得读得出。给暗投影，而不是换一套颜色。 */
const ON_HEAT_SHADOW = 'drop-shadow(0 1px 1.5px rgba(0,0,0,.55))';

function CameraGlyph({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.5 8.5h3.2l1.6-2.4h7.4l1.6 2.4h3.2v11H3.5z" />
      <circle cx="12" cy="13.4" r="3.3" />
    </svg>
  );
}

export function CalendarScreen() {
  const today = todayStr();
  const [ym, setYm] = useState(today.slice(0, 7));
  const grid = monthGrid(ym);
  const from = grid[0];
  const to = grid[41];

  const data = useLiveQuery(async () => {
    const [items, photos] = await Promise.all([listItemsInRange(from, to), listPhotoDates(from, to)]);
    const exMap = await getExercisesByIds([...new Set(items.map((i) => i.exerciseId))]);

    // 主练部位 + 当天总组数：日历格 / 年度热力图 / 海报 共用这一个函数
    const load = dailyPartLoad(items, exMap);

    // 归一化取 p90 而非 max——一天练爆不该把整月其余日子全冲淡成灰
    const maxSets = percentile(
      [...load.values()].map((v) => v.sets),
      90,
    );

    // 格子上的图标：主练部位打头，其余按 BODY_PARTS 顺序跟随
    const order = BODY_PARTS.map((p) => p.id);
    const parts = new Map<string, BodyPart[]>();
    for (const item of items) {
      const part = exMap.get(item.exerciseId)?.bodyPart;
      if (!part) continue;
      const list = parts.get(item.date) ?? [];
      if (!list.includes(part)) list.push(part);
      parts.set(item.date, list);
    }
    for (const [date, list] of parts) {
      const primary = load.get(date)?.part;
      list.sort((a, b) => {
        if (a === primary) return -1;
        if (b === primary) return 1;
        return order.indexOf(a) - order.indexOf(b);
      });
    }

    // 三项统计都按「当前浏览的这个月」算：翻到三月，看到的就该是三月的账
    const monthDates = [...load.keys()].filter((d) => d.startsWith(ym));
    const monthSets = monthDates.reduce((sum, d) => sum + (load.get(d)?.sets ?? 0), 0);

    return {
      load,
      parts,
      photos,
      maxSets,
      days: monthDates.length,
      streak: longestStreak(monthDates),
      sets: monthSets,
    };
  }, [from, to, ym]);

  const [yyyy, mm] = ym.split('-');

  return (
    <div className="flex flex-col px-5 pt-6">
      <header className="flex items-end justify-between">
        <div className="flex items-baseline gap-3">
          <span data-testid="month-num" className="display heat-text text-[64px] leading-[0.8]">
            {mm}
          </span>
          <span className="text-[13px] tracking-[3px] text-mute">
            {`${yyyy} ${CN_MONTHS[Number(mm) - 1]}`}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="上个月"
            onClick={() => setYm(shiftMonth(ym, -1))}
            className="h-9 w-9 rounded-lg text-lg text-mute active:scale-95"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="下个月"
            onClick={() => setYm(shiftMonth(ym, 1))}
            className="h-9 w-9 rounded-lg text-lg text-mute active:scale-95"
          >
            ›
          </button>
        </div>
      </header>

      <div data-testid="month-stats" className="mt-6 flex">
        <Stat value={data?.days ?? 0} label="本月打卡" />
        <Stat value={data?.streak ?? 0} label="最长连续" accent />
        <Stat value={data?.sets ?? 0} label="总组数" last />
      </div>

      <div className="etch" />

      <div className="grid grid-cols-7 gap-[5px] text-center text-[10px] text-mute">
        {WEEKDAYS.map((w) => (
          <span key={w} className="pb-2">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-[5px]">
        {grid.map((date) => {
          const inMonth = date.startsWith(ym);
          const day = data?.load.get(date);
          const icons = (data?.parts.get(date) ?? []).slice(0, 2);
          const hasPhoto = data?.photos.has(date) ?? false;
          const isToday = date === today;
          const dayNum = Number(date.slice(8));
          const label = `${Number(date.slice(5, 7))}月${dayNum}日`;

          return (
            <Link
              key={date}
              to={`/day/${date}`}
              data-testid={`day-${date}`}
              aria-current={isToday ? 'date' : undefined}
              aria-label={
                day
                  ? `${label} ${bodyPartInfo(day.part).name} ${day.sets}组`
                  : `${label} 未训练`
              }
              style={{
                backgroundColor: day ? heatColor(day.part, day.sets, data!.maxSets) : EMPTY_HEAT,
                opacity: inMonth ? 1 : 0.35,
              }}
              className={`relative flex aspect-square flex-col items-center justify-center gap-[3px] rounded-[11px] text-[11px] active:scale-95 ${
                day ? 'text-ink' : 'text-mute'
              } ${isToday ? 'ring-1 ring-iron' : ''}`}
            >
              {hasPhoto && (
                <span
                  data-photo
                  className="absolute right-1 top-1 text-mute"
                  style={
                    day ? { color: 'rgba(242,240,235,.9)', filter: ON_HEAT_SHADOW } : undefined
                  }
                >
                  <CameraGlyph size={9} />
                </span>
              )}
              <span
                className={isToday ? 'font-bold text-iron' : undefined}
                style={day && !isToday ? { filter: ON_HEAT_SHADOW } : undefined}
              >
                {dayNum}
              </span>
              {icons.length > 0 && (
                <span className="flex gap-[1px]" style={{ filter: ON_HEAT_SHADOW }}>
                  {icons.map((p) => (
                    // 底色已经是部位色，图标再上同一个色只会糊成一片——这里只留形状
                    <span key={p} data-part={p} className="flex">
                      <PartIcon part={p} size={11} color="rgba(242,240,235,.92)" />
                    </span>
                  ))}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="etch" />

      <div
        data-testid="part-legend"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-2 text-[11px] text-mute"
      >
        {BODY_PARTS.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1">
            <span data-part={p.id} className="flex">
              <PartIcon part={p.id} size={12} />
            </span>
            {p.name}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <CameraGlyph size={11} />
          有照片
        </span>
      </div>
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

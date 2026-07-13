import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { PartIcon } from '../../components/PartIcon';
import { BODY_PARTS, bodyPartInfo } from '../../data/bodyParts';
import { monthGrid, shiftMonth, todayStr } from '../../lib/dates';
import { EMPTY_HEAT, calendarHeatColor } from '../../lib/heat';
import { THEME } from '../../lib/theme';
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

/**
 * 日期数字的三档颜色。写成 style 而不是 Tailwind 类：它要按「练没练 / 是不是今天」
 * 逐格切换，而压在热力块上的字必须是确定的值，不能靠类名叠加去猜。
 */
const DAY_INK = THEME.ink;
const DAY_MUTE = THEME.mute;
const DAY_IRON = THEME.iron; // 今天且没练：空格子上唯一的热源

/** 溢出格的两档整格浓度。练过的那档要留够余量：0.7 × DAY_INK 的有效 alpha 仍有 0.7，读得出。 */
const OVERFLOW_TRAINED = 0.7;
const OVERFLOW_EMPTY = 0.35;

/** 热力块的浓淡被压到 0.6 封顶后色相会变弱——底部这条实色部位色把「练了哪个部位」钉回来。 */
function HueBar({ part }: { part: BodyPart }) {
  return (
    <span
      data-hue={part}
      aria-hidden
      className="absolute inset-x-0 bottom-0 h-[3px]"
      style={{ backgroundColor: bodyPartInfo(part).color }}
    />
  );
}

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

      {/* data 未回来时先空着：宁可留白，也不闪一排 0 —— 那等于告诉新用户「你什么都没有」 */}
      <div className="mt-6 min-h-[48px]">
        {data &&
          (data.days === 0 ? (
            <p data-testid="month-empty" className="text-[13px] leading-[1.7] text-mute">
              这个月还没有一条铁证。
              <br />
              练一次，这里就会落下第一枚钢印。
            </p>
          ) : (
            /* 三格算的都是「当前浏览的这个月」，名字就得把口径说出来。
               「最长连续」在首页 / 数据页 /「我的」页是**终身**纪录（一个不变的成就），
               这里的数却随手指往左划就变。同一个词两个数，用户没有线索知道哪个是真的。 */
            <div data-testid="month-stats" className="flex">
              <Stat value={data.days} label="本月打卡" />
              <Stat value={data.streak} label="本月最长连续" accent />
              <Stat value={data.sets} label="本月组数" last />
            </div>
          ))}
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

          // 溢出格要同时「读得出」和「看得出不是本月」，二元开关做不到——只能分两档浓度：
          //   本月 1 ／ 溢出但练过 .7（明显退后，色块和数字都还在）／ 溢出且空 .35（那格没东西要读）
          // 数字一律用满 DAY_INK：整格已经淡了，再叠一层 .72 会把有效 alpha 压到 0.5 以下。
          const cellOpacity = inMonth ? 1 : day ? OVERFLOW_TRAINED : OVERFLOW_EMPTY;
          const numColor = day ? DAY_INK : isToday ? DAY_IRON : DAY_MUTE;

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
                backgroundColor: day
                  ? calendarHeatColor(day.part, day.sets, data!.maxSets)
                  : EMPTY_HEAT,
                opacity: cellOpacity,
              }}
              className={`relative flex aspect-square flex-col items-center justify-center gap-[3px] overflow-hidden rounded-[11px] text-[11px] active:scale-95 ${
                isToday ? 'ring-1 ring-iron' : ''
              }`}
            >
              {day && <HueBar part={day.part} />}
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
                data-testid={`daynum-${date}`}
                className={isToday ? 'font-bold' : undefined}
                style={{ color: numColor, filter: day ? ON_HEAT_SHADOW : undefined }}
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

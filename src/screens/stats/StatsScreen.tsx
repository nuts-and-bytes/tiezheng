import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Line } from '../../components/charts';
import { PartIcon } from '../../components/PartIcon';
import { PhotoTimeline } from '../../components/PhotoTimeline';
import { Stamp } from '../../components/Stamp';
import { BODY_PARTS } from '../../data/bodyParts';
import { addDays, todayStr } from '../../lib/dates';
import { EMPTY_HEAT, heatColor } from '../../lib/heat';
import {
  PROGRESSION_POINTS, compare, currentStreak, dailyMovingAverage, dailyPartLoad, hasWeightData,
  heatMonthLabels, heatWeekStarts, lastTrainedByBodyPart, longestStreak, percentile, prevRangeOf,
  rangeOf, recentE1rmSeries, setsByBodyPart, topExerciseIds, yearsWithData,
} from '../../lib/stats';
import type { Delta, ExMap, LoadItem, Segment } from '../../lib/stats';
import { getExercisesByIds } from '../../repos/exerciseRepo';
import { listWeights } from '../../repos/weightRepo';
import { listAllItems, listAllWorkoutDates } from '../../repos/workoutRepo';

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: 'week', label: '周' },
  { id: 'month', label: '月' },
  { id: 'year', label: '年' },
  { id: 'all', label: '全部' },
];

/** 范围切换器管的是「周期汇总」（大数字、部位柱长）。副标题里报口径用它，别让用户猜柱长是哪段时间的 */
const SCOPE_LABEL: Record<Segment, string> = {
  week: '本周',
  month: '本月',
  year: '今年',
  all: '全部',
};

export function StatsScreen() {
  const today = todayStr();
  const [seg, setSeg] = useState<Segment>('week');
  const [exId, setExId] = useState('');
  const [year, setYear] = useState<number | null>(null);

  const data = useLiveQuery(async () => {
    const [items, dates, weights] = await Promise.all([
      listAllItems(),
      listAllWorkoutDates(),
      listWeights(addDays(today, -364), today),
    ]);
    const exMap = await getExercisesByIds([...new Set(items.map((i) => i.exerciseId))]);
    return { items, dates, weights, exMap };
  }, [today]);

  if (!data) return null;
  const { items, dates, weights, exMap } = data;

  // ---- 零数据：新用户不该看到一排 0 和几个空坐标轴 ----
  if (dates.length === 0) {
    return (
      <div className="px-5 pt-6">
        <h1 className="text-[22px] font-extrabold">数据</h1>
        <div className="flex flex-col items-center gap-4 pt-24 text-center">
          <Stamp size={64} />
          <p className="text-sm text-mute">
            还没有一条铁证。
            <br />
            练一次，这里就会长出你的曲线。
          </p>
          <Link
            to="/log"
            className="mt-2 rounded-xl bg-iron px-5 py-2.5 text-sm font-semibold text-bg"
          >
            去打卡
          </Link>
        </div>
      </div>
    );
  }

  const range = rangeOf(seg, today);
  const cmp = compare(items, dates, range, prevRangeOf(range));
  const scoped = items.filter((i) => i.date >= range.from && i.date <= range.to);
  const weighted = hasWeightData(scoped);

  return (
    <div className="px-5 pt-6 pb-4">
      <h1 className="text-[22px] font-extrabold">数据</h1>

      <div className="mt-3.5 mb-1 inline-flex rounded-[10px] border border-line bg-raised p-[3px] text-xs">
        {SEGMENTS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSeg(s.id)}
            className={`rounded-lg px-3.5 py-1.5 transition-colors ${
              seg === s.id ? 'bg-iron/15 font-semibold text-iron' : 'text-mute'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 我最近是不是在坚持？——三个大数字 + 环比。没有对比的数字没有意义 */}
      <div className="flex py-4 pt-4">
        <Hero testId="hero-days" label="打卡天数" value={cmp.days.cur} delta={cmp.days} seg={seg} hot />
        <Sep />
        <Hero testId="hero-sets" label="总组数" value={cmp.sets.cur} delta={cmp.sets} seg={seg} />
        <Sep />
        {weighted ? (
          <Volume kg={cmp.volumeKg.cur} />
        ) : (
          <Hero
            testId="hero-streak"
            label="当前连续"
            value={currentStreak(new Set(dates), today)}
            unit="天"
          />
        )}
      </div>
      <div className="etch" />

      <p className="mt-4 text-[11px] tracking-[1.5px] text-mute">
        当前连续 {currentStreak(new Set(dates), today)} 天 · 最长 {longestStreak(dates)} 天
      </p>

      {/* 进步曲线不吃 scoped：它回答「我变强了吗」，这跟用户当前选的是周还是月无关 */}
      <Strength items={items} exMap={exMap} exId={exId} onPick={setExId} />

      <Balance items={scoped} allItems={items} exMap={exMap} today={today} seg={seg} />

      <Heat items={items} exMap={exMap} dates={dates} year={year} onYear={setYear} today={today} />

      <Weight weights={weights} />

      <Link
        to="/poster"
        className="mt-6 flex items-center gap-3.5 rounded-[18px] border border-iron/35 bg-gradient-to-br from-iron/12 to-amber/5 px-4 py-4"
      >
        <Stamp size={44} />
        <span className="min-w-0">
          <b className="block text-[15px]">导出训练海报</b>
          <span className="mt-0.5 block text-xs text-mute">把汗水盖上钢印，保存到相册</span>
        </span>
        <span className="ml-auto text-xl text-iron">›</span>
      </Link>

      <div className="mt-6">
        <PhotoTimeline />
      </div>
    </div>
  );
}

function Sep() {
  return <div className="mx-4 my-1.5 w-px shrink-0 bg-line" />;
}

/** sub 是区块的口径说明。一个区块只要有两种时间语义并存，就必须把它们写在脸上 */
function Section({
  title, sub, right,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mt-6 mb-3 flex items-start justify-between gap-3">
      <span className="min-w-0">
        <p className="text-[11px] tracking-[2px] text-mute uppercase">{title}</p>
        {sub && <p className="mt-1 text-[10px] leading-snug text-mute/70">{sub}</p>}
      </span>
      {right}
    </div>
  );
}

/** 环比。pct 为 null 意味着上期是 0——绝不能除出 Infinity，更不能渲染 NaN% */
function DeltaTag({ delta, seg }: { delta: Delta; seg: Segment }) {
  if (seg === 'all') return <span className="text-[11px] text-mute">累计</span>;
  if (delta.pct === null) {
    if (delta.cur === 0) return <span className="text-[11px] text-mute">—</span>;
    return <span className="text-[11px] font-semibold text-iron">新增</span>;
  }
  if (delta.pct === 0) return <span className="text-[11px] text-mute">持平</span>;
  const up = delta.pct > 0;
  return (
    <span className={`text-[11px] font-semibold ${up ? 'text-iron' : 'text-mute'}`}>
      {up ? '↑' : '↓'} {Math.abs(delta.pct)}%
    </span>
  );
}

function Hero({
  testId, label, value, unit, delta, seg, hot,
}: {
  testId: string;
  label: string;
  value: number;
  unit?: string;
  delta?: Delta;
  seg?: Segment;
  hot?: boolean;
}) {
  return (
    <div className="flex-1" data-testid={testId}>
      <p className="flex items-baseline gap-1">
        <span className={`display text-[40px] leading-none ${hot ? 'heat-text' : 'text-ink'}`}>
          {value}
        </span>
        {unit && <span className="text-xs text-mute">{unit}</span>}
      </p>
      <p className="mt-1 flex items-center gap-1.5">
        <span className="text-[11px] text-mute">{label}</span>
        {delta && seg && <DeltaTag delta={delta} seg={seg} />}
      </p>
    </div>
  );
}

/**
 * 容量：上千用吨，否则 kg。整数不带小数点，别让 12000kg 显示成 12000.0。
 *
 * 没有环比：容量的周环比噪声远大于信号——上周撞上一个 30 组的怪物日，本周就变成「↓88%」，
 * 而用户什么也没做错。一个回答不了「我在变好还是变差」的指标，不该用红箭头吓人。
 * 打卡天数和总组数够稳，环比留着。
 */
function Volume({ kg }: { kg: number }) {
  const t = kg >= 1000;
  const shown = t ? (kg / 1000).toFixed(1) : String(Math.round(kg));
  return (
    <div className="flex-1" data-testid="hero-volume">
      <p className="flex items-baseline">
        <span className="display text-[40px] leading-none text-ink">{shown}</span>
        <span className="text-sm text-mute">{t ? 't' : 'kg'}</span>
      </p>
      <p className="mt-1 flex items-center gap-1.5">
        <span className="text-[11px] text-mute">总容量</span>
      </p>
    </div>
  );
}

/**
 * 我是不是在变强？e1RM 是「练了到底有没有用」的唯一客观答案。
 *
 * items 传的是全时段记录，不是 scoped——这个区块故意不接范围切换器。
 * 顶部三个大数字是「周期汇总」（本周练了 4 天，有意义）；进步曲线是「我的卧推从 60 涨到 90」，
 * 天然属于全时段。把两者绑在同一个切换器上，默认停在「周」的用户必然只剩 1 个点 → 一张空图。
 */
function Strength({
  items, exMap, exId, onPick,
}: {
  items: LoadItem[];
  exMap: ExMap;
  exId: string;
  onPick: (id: string) => void;
}) {
  const top = topExerciseIds(items, 5);
  const active = top.includes(exId) ? exId : top[0];

  if (!hasWeightData(items) || !active) {
    return (
      <>
        <Section title="力量趋势" />
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs leading-relaxed text-mute">
          记下重量和次数，这里就会画出你的力量曲线。
          <br />
          只记组数也没问题——上面的组数一样算数。
        </p>
      </>
    );
  }

  const series = recentE1rmSeries(items, active, PROGRESSION_POINTS);
  const picker = (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {top.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onPick(id)}
          className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
            id === active
              ? 'bg-iron/15 font-semibold text-iron'
              : 'border border-line bg-raised text-mute'
          }`}
        >
          {exMap.get(id)?.name ?? id}
        </button>
      ))}
    </div>
  );
  const head = (
    <Section
      title="力量趋势 · 估算 1RM"
      sub={`最近 ${PROGRESSION_POINTS} 次记录 · 不随上方范围变化`}
    />
  );

  // series 至少有 1 个点：active 只可能来自 topExerciseIds，而它与 e1rmSeries 同口径
  // （weighted：weight > 0 且有次数）。自重动作在那一层就被排除了，到不了这里。
  //
  // 只有一个点：画不出线，也就没有「趋势」可言。此时画个空壳图表是在骗人说「这里本该有东西」——
  // 不如把这一个数字亮出来，再告诉用户下一步做什么。
  if (series.length < 2) {
    const only = series[0];
    return (
      <>
        {head}
        {picker}
        <div
          data-testid="strength-single"
          className="rounded-xl border border-dashed border-line px-4 py-5 text-center"
        >
          <p className="flex items-baseline justify-center gap-1">
            <span className="display text-[32px] leading-none text-ink">{only.e1rm.toFixed(1)}</span>
            <span className="text-xs text-mute">kg</span>
          </p>
          <p className="mt-1.5 text-[11px] text-mute">{only.date.slice(5)} · 目前唯一一次记录</p>
          <p className="mt-2.5 text-xs text-mute">再练一次，这里就会长出曲线。</p>
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      {picker}
      <Line
        data={{
          labels: series.map((s) => s.date.slice(5)),
          datasets: [
            {
              data: series.map((s) => s.e1rm),
              borderColor: '#FF5C1F',
              backgroundColor: 'rgba(255,92,31,0.12)',
              borderWidth: 2.5,
              fill: true,
              tension: 0.35,
              // 恒显示圆点：series 由 recentE1rmSeries 截到最多 PROGRESSION_POINTS(12) 个，
              // 12 个点不会把线糊成毛毛虫，而每一个点都是用户真练过的一次，值得看得见。
              pointRadius: 3,
              pointHoverRadius: 4,
              pointBackgroundColor: '#FFB340',
            },
          ],
        }}
        options={{
          // 没有 chartjs-adapter-date-fns：x 轴走 category（日期索引），绝不能用 time scale
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 5, font: { size: 9 } } },
            y: {
              grid: { color: 'rgba(255,255,255,0.05)' },
              border: { display: false },
              ticks: { maxTicksLimit: 4, font: { size: 9 } },
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: (c) => (c.parsed.y == null ? '' : `${c.parsed.y.toFixed(1)} kg`),
              },
            },
          },
        }}
      />
    </>
  );
}

/** 我是不是练得均衡？「背：已 12 天没练」比一个雷达图有用得多 */
function Balance({
  items, allItems, exMap, today, seg,
}: {
  items: LoadItem[];
  allItems: LoadItem[];
  exMap: ExMap;
  today: string;
  seg: Segment;
}) {
  const sets = setsByBodyPart(items, exMap);
  const last = lastTrainedByBodyPart(allItems, exMap, today);
  const max = Math.max(...BODY_PARTS.map((p) => sets[p.id]), 1);

  return (
    <>
      {/* 一行里塞着两个时间语义：柱长是范围内的，「已 N 天没练」是全时段事实。
          删掉哪个都是损失，那就把口径写在脸上——并且跟着范围切换器改文案 */}
      <Section
        title="部位均衡"
        sub={`柱长 = ${SCOPE_LABEL[seg]}组数 · 右侧 = 距上次训练（全时段）`}
      />
      {BODY_PARTS.map((p) => {
        const n = sets[p.id];
        const days = last[p.id];
        return (
          <div key={p.id} className="mb-3 flex items-center gap-2.5" data-testid={`part-${p.id}`}>
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-lg"
              style={{ background: `${p.color}26` }}
            >
              <PartIcon part={p.id} size={16} color={p.color} />
            </span>
            <span className="w-8 shrink-0 text-[13px]">{p.name}</span>
            <span className="h-[9px] flex-1 overflow-hidden rounded-full bg-white/5">
              <span
                className="block h-full rounded-full"
                style={{ width: `${(n / max) * 100}%`, background: p.color }}
              />
            </span>
            {/* 组数是「练了多少」，久疏于练是「该练什么了」——后者才是行动信号，不能被前者吞掉 */}
            <span className="w-24 shrink-0 text-right leading-tight">
              <span className="block text-[11px] text-mute tabular-nums">
                {n > 0 ? `${n} 组` : '—'}
              </span>
              {(days === null || days >= 7) && (
                <span className="block text-[10px] text-amber">
                  {days === null ? '从未练过' : `已 ${days} 天没练`}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** 年度热力图：与日历页共用 heatColor —— 同一个训练日在两处必须长同一个颜色 */
function Heat({
  items, exMap, dates, year, onYear, today,
}: {
  items: LoadItem[];
  exMap: ExMap;
  dates: string[];
  year: number | null;
  onYear: (y: number) => void;
  today: string;
}) {
  const years = yearsWithData(dates);
  const y = year !== null && years.includes(year) ? year : (years[0] ?? Number(today.slice(0, 4)));
  const load = dailyPartLoad(items, exMap);

  const inYear = [...load.entries()].filter(([d]) => d.startsWith(String(y)));
  const maxSets = percentile(inYear.map(([, v]) => v.sets), 90);

  // 一列 = 一周（7 行）。月份标签与格子共用同一份列定义，才能真正对齐到列
  const weekStarts = heatWeekStarts(y);
  const months = heatMonthLabels(weekStarts, y);
  const cells = weekStarts.flatMap((d) => Array.from({ length: 7 }, (_, i) => addDays(d, i)));

  return (
    <>
      <Section
        title="年度热力"
        right={
          years.length > 1 ? (
            <span className="flex gap-1">
              {years.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onYear(n)}
                  className={`display rounded-md px-2 py-0.5 text-[11px] ${
                    n === y ? 'bg-iron/15 text-iron' : 'text-mute'
                  }`}
                >
                  {n}
                </button>
              ))}
            </span>
          ) : (
            <span className="display text-[11px] text-mute">{y}</span>
          )
        }
      />
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="min-w-max">
          {/* 月份轴：标签绝对定位，才不会把 9px 的列撑宽 —— 列宽必须和下面的格子严格相等 */}
          <div className="mb-1 grid grid-flow-col gap-[3px]" data-testid="heat-months">
            {months.map((m, i) => (
              <span key={weekStarts[i]} className="relative block h-3 w-[9px]">
                {m !== null && (
                  <span className="absolute top-0 left-0 text-[9px] leading-3 whitespace-nowrap text-mute">
                    {m}月
                  </span>
                )}
              </span>
            ))}
          </div>
          <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
            {cells.map((d) => {
              const hit = d.startsWith(String(y)) ? load.get(d) : undefined;
              return (
                <span
                  key={d}
                  data-testid={`heat-${d}`}
                  title={d}
                  className="size-[9px] rounded-[2px]"
                  style={{
                    backgroundColor: !d.startsWith(String(y))
                      ? 'transparent'
                      : hit
                        ? heatColor(hit.part, hit.sets, maxSets)
                        : EMPTY_HEAT,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* 图例：色块本身不自解释。日历页有，这里没有的话，同一套颜色就白共用了 */}
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5" data-testid="heat-legend">
        {BODY_PARTS.map((p) => (
          <span key={p.id} className="flex items-center gap-1">
            <span
              className="size-[7px] shrink-0 rounded-[2px]"
              style={{ background: p.color }}
              aria-hidden
            />
            <span className="text-[10px] text-mute">{p.name}</span>
          </span>
        ))}
      </div>
    </>
  );
}

function Weight({ weights }: { weights: { date: string; weightKg: number }[] }) {
  if (weights.length === 0) return null;
  // 按自然日开窗——隔了 30 天的两次称重不该被当成相邻点互相平滑
  const ma = dailyMovingAverage(
    weights.map((w) => ({ date: w.date, value: w.weightKg })),
    7,
  );
  return (
    <>
      <Section title="体重 · 7 日均线" />
      <Line
        data={{
          labels: weights.map((w) => w.date.slice(5)),
          datasets: [
            {
              data: ma.map((p) => p.value),
              borderColor: '#8B8B85',
              borderWidth: 2,
              tension: 0.35,
              pointRadius: 0,
            },
            {
              data: weights.map((w) => w.weightKg),
              borderColor: 'transparent',
              pointRadius: 2,
              pointBackgroundColor: 'rgba(255,92,31,0.5)',
            },
          ],
        }}
        options={{
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 5, font: { size: 9 } } },
            y: {
              grid: { color: 'rgba(255,255,255,0.05)' },
              border: { display: false },
              ticks: { maxTicksLimit: 4, font: { size: 9 } },
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: (c) => (c.parsed.y == null ? '' : `${c.parsed.y.toFixed(1)} kg`),
              },
            },
          },
        }}
      />
    </>
  );
}

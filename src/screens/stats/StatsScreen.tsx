import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { CHART_GRID, Line } from '../../components/charts';
import { PartIcon } from '../../components/PartIcon';
import { PhotoTimeline } from '../../components/PhotoTimeline';
import { Stamp } from '../../components/Stamp';
import { BODY_PARTS, bodyPartInfo } from '../../data/bodyParts';
import { addDays, todayStr } from '../../lib/dates';
import { EMPTY_HEAT, cellParts, heatBackground, heatColor } from '../../lib/heat';
import { vibrate } from '../../lib/platform';
import { THEME } from '../../lib/theme';
import {
  PROGRESSION_POINTS, compare, currentStreak, dailyMovingAverage, dailyPartBreakdown, hasWeightData, loadKind,
  heatMonthLabels, heatWeekStarts, lastTrainedByBodyPart, longestStreak, prevRangeOf,
  rangeOf, recentE1rmSeries, setsByBodyPart, topExerciseIds, yearsWithData,
} from '../../lib/stats';
import type { DayPartLoad, Delta, ExMap, LoadItem, Segment } from '../../lib/stats';
import type { BodyPart } from '../../lib/types';
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
  //
  // 门闩只看 dates —— 但它换掉的是**整页**，而体重是独立于打卡的另一条数据流：
  // TodayScreen 上可以只称重、不打卡（setWeight 跟 addWorkoutItem 没有任何耦合）。
  // 于是「先称了两天体重、还没练第一次」的用户，weights 明明已经从库里取回来了，
  // 却被这道门闩连页面一起没收。空态的职责是不画一排 0 和空坐标轴，
  // 不是把用户真有的数据也一并扣下——所以体重跟在空态块后面继续画。
  if (dates.length === 0) {
    return (
      <div className="px-5 pt-6 pb-4">
        <h1 className="text-[22px] font-extrabold">数据</h1>
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          {/* 插图。它要说的话，底下那句文案已经说了——读屏没必要念第二遍 */}
          <Stamp size={64} decorative />
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
        <Weight weights={weights} />
      </div>
    );
  }

  const range = rangeOf(seg, today);
  const cmp = compare(items, dates, range, prevRangeOf(seg, today));
  const scoped = items.filter((i) => i.date >= range.from && i.date <= range.to);
  // 全时段判断，不是 scoped：「你是不是一个搬铁的人」是这个人的属性，不是这三天的属性。
  // 用 scoped 会让一个举铁的人在「本周只练了自重」时整块容量口径消失、下周一又回来——
  // 页面结构随最近三天的偶然性漂移。而下面的「力量趋势」本来就吃全时段（见 :126），
  // 两处口径必须一致，否则会出现「曲线画着卧推，上面的大数字却当他没重量数据」。
  //
  // 同一条理由往下再走一级：「你记不记次数」也是这个人的属性。只记组数、连次数都不记的人
  // （sanitizeSets 明确允许）volumeKg 和 reps 双 0——降级到「总次数」还是个 0，
  // 旁边「总组数 5」正亮着，两个数字在同一排互相拆台。第三级给动作数（见 loadKind）。
  const kind = loadKind(items);

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
        {kind === 'volume' ? (
          <Volume kg={cmp.volumeKg.cur} />
        ) : kind === 'reps' ? (
          // 自重训练者的 volumeKg 恒为 0，但次数是真的——那才是他的负荷维度。
          // （这一格原本给了「当前连续」，而它下面 4px 处的小字里已经印过一遍。）
          <Hero testId="hero-reps" label="总次数" value={cmp.reps.cur} delta={cmp.reps} seg={seg} />
        ) : (
          // 连次数都不记的人：容量和次数双 0，动作数是他唯一还剩下的真数字。
          <Hero testId="hero-moves" label="动作数" value={cmp.moves.cur} delta={cmp.moves} seg={seg} />
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
        {/* 链接的无障碍名由子内容拼出来。钢印带着 aria-label="铁证" 站在第一位，
            读屏用户听到的第一个词就是品牌名——而他要判断的是「这链接干什么」。
            品牌感是给眼睛的，不该占用耳朵的第一秒。 */}
        <Stamp size={44} decorative />
        <span className="min-w-0">
          <b className="block text-[15px]">导出训练海报</b>
          <span className="mt-0.5 block text-xs text-mute">把汗水盖上钢印，保存到相册</span>
        </span>
        <span className="ml-auto text-xl text-iron">›</span>
      </Link>

      {/* 间距归 PhotoTimeline 自己（它现在自带蚀刻线开头），外面不再套壳 */}
      <PhotoTimeline />
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

  // cur = 0 先接管，不让它掉进百分比分支。
  //
  // 那里算出来的必然是 -100%，而「↓ 100%」在周期开头是**常态，不是新闻**：prevRangeOf 是
  // 同相位对照，所以周一早上只要你上周一练过，就必然 -100%。天天见的最大负值，用户三周
  // 就学会无视它——而那正是它本该报警的时候。代价说清楚：周期末尾真的一次没练时，它也只说
  // 「未开张」，不会喊「↓100%」；严厉程度被拉平，换来的是那个红灯不再叫狼来了。
  //
  // pct === null 是上期也为 0：没有可开张的对照，那就还是「—」。
  if (delta.cur === 0) {
    if (delta.pct === null) return <span className="text-[11px] text-mute">—</span>;
    return <span className="text-[11px] font-semibold text-iron">未开张</span>;
  }
  if (delta.pct === null) return <span className="text-[11px] font-semibold text-iron">新增</span>;
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
              borderColor: THEME.iron,
              backgroundColor: 'rgba(255,92,31,0.12)',
              borderWidth: 2.5,
              fill: true,
              tension: 0.35,
              // 恒显示圆点：series 由 recentE1rmSeries 截到最多 PROGRESSION_POINTS(12) 个，
              // 12 个点不会把线糊成毛毛虫，而每一个点都是用户真练过的一次，值得看得见。
              pointRadius: 3,
              pointHoverRadius: 4,
              pointBackgroundColor: THEME.amber,
            },
          ],
        }}
        options={{
          // 没有 chartjs-adapter-date-fns：x 轴走 category（日期索引），绝不能用 time scale
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 5, font: { size: 9 } } },
            y: {
              grid: { color: CHART_GRID },
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
          删掉哪个都是损失，那就把口径写在脸上——并且跟着范围切换器改文案。

          口径只能指颜色，不能指位置：右侧那一列是两行（组数永远在场，琥珀行只在 ≥7 天
          没练时才出现）。写「右侧 = 距上次训练」的话，对刚练过的部位，右侧唯一在场的
          恰恰是组数，而副标题声称的那行根本不显示——用位置指代条件渲染的东西必然说谎。 */}
      <Section
        title="部位均衡"
        sub={`柱长 / 数字 = ${SCOPE_LABEL[seg]}组数 · 琥珀 = 距上次训练（全时段）`}
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

/** 年度热力图：与日历页 / 海报共用 heatColor + cellParts —— 同一个训练日在三处必须长同一个样 */
const partName = (p: BodyPart) => bodyPartInfo(p).name;

/** 一个格子要画的东西：涂哪几块（主练在前）、多浓（当天总组数） */
interface HeatCell {
  parts: BodyPart[];
  sets: number;
}

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

  /**
   * 部位曾经**只**编码在色相里。9px 的格子、七个色相——红绿色盲（男性约 8%）看
   * chest #E8483F / cardio #8FAE9B / arm #2FD6C3 三者高度趋同，读到的信息量是零；
   * 而说实话，七个色相在 9px 上谁都分不清。所以颜色降级为冗余通道，真相走另外两条：
   *
   * 1. **每个格子说得出话**（title + 无障碍名）：「2026-07-03 · 腿 3 组 · 胸 1 组」。
   * 2. **图例能筛**：点「腿」，整张图退成单色的腿部贡献图——此时唯一的变量是浓淡，
   *    色觉障碍者也读得全。而「我腿练得少吗」本来就是个查询，不是个看：
   *    七色同屏时，谁都数不出这一年有几个紫格子。
   */
  const [pick, setPick] = useState<BodyPart | null>(null);

  const breakdown = dailyPartBreakdown(items, exMap);
  /**
   * 筛选态下，格子代表的是「这一天的这个部位」——单色，唯一的变量是浓淡。
   * 无筛选时代表「这一天练到的部位（主练在前）+ 总组数」：主练腿、顺带练胸的那天，
   * 只涂腿色就是在跟同一页的「部位分布」互相拆台。视觉上截到几块由 cellParts 一处裁决。
   */
  const shownOf = (rows: DayPartLoad[] | undefined): HeatCell | undefined => {
    if (!rows) return undefined;
    if (pick === null) {
      return { parts: rows.map((r) => r.part), sets: rows.reduce((s, r) => s + r.sets, 0) };
    }
    const hit = rows.find((r) => r.part === pick);
    return hit && { parts: [pick], sets: hit.sets };
  };

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
              const rows = d.startsWith(String(y)) ? breakdown.get(d) : undefined;
              const hit = shownOf(rows);
              // 标签报的是那天的全部真相（筛选只决定谁上色，不改写那天练了什么）
              const label = rows && `${d} · ${rows.map((r) => `${partName(r.part)} ${r.sets} 组`).join(' · ')}`;
              return (
                <span
                  key={d}
                  data-testid={`heat-${d}`}
                  // 没练的日子不进无障碍树：一年 365 声「未训练」是纯噪声。
                  // 有练的必须有 role——光挂 aria-label 在 <span> 上，屏幕阅读器不念。
                  {...(hit && label
                    ? { role: 'img', 'aria-label': label, title: label }
                    : { 'aria-hidden': true })}
                  className="size-[9px] rounded-[2px]"
                  style={{
                    // 混合日对角劈成两块（heatBackground），两块共用当天总组数算出的同一个 alpha：
                    // 格子的深浅答的是「这天练得狠不狠」，不是「这一块练了几组」
                    background: !d.startsWith(String(y))
                      ? 'transparent'
                      : hit
                        ? heatBackground(
                            cellParts(hit.parts).map((p) => heatColor(p)),
                          )
                        : EMPTY_HEAT,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* 图例即筛选器：色块本身不自解释，而七个色相在 9px 上谁都读不出来——
          它得能被点，把「这一年我练了几次腿」从一道找色题变成一次筛选 */}
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5" data-testid="heat-legend">
        {BODY_PARTS.map((p) => {
          const on = pick === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                vibrate(8);
                setPick(on ? null : p.id); // 再点一次取消，不然用户被自己锁死在一个部位里
              }}
              className={`flex items-center gap-1 rounded-md px-1 py-0.5 -mx-1 transition-opacity ${
                pick !== null && !on ? 'opacity-40' : ''
              }`}
            >
              <span
                className="size-[7px] shrink-0 rounded-[2px]"
                style={{ background: p.color }}
                aria-hidden
              />
              <span className={`text-[10px] ${on ? 'font-semibold text-iron' : 'text-mute'}`}>
                {p.name}
              </span>
            </button>
          );
        })}
      </div>
      {pick !== null && (
        <p className="mt-1.5 text-[10px] text-mute">
          只看{partName(pick)}——再点一次看全部
        </p>
      )}
    </>
  );
}

function Weight({ weights }: { weights: { date: string; weightKg: number }[] }) {
  if (weights.length === 0) return null;

  // 一个点画不出线，更画不出「7 日均线」——均线那条 dataset 的 pointRadius 是 0，
  // 单点上它一笔都不落。剩下的是一个空坐标轴框、一个 2px 的橙点，和一行标题在那儿
  // 宣称这是均线。力量趋势早就懂这件事（series.length < 2 → 亮数字 + 说下一步），
  // 体重却只挡了 length === 0：不是取舍，是漏了。这里跟上它。
  if (weights.length < 2) {
    const only = weights[0];
    return (
      <>
        <Section title="体重" />
        <div
          data-testid="weight-single"
          className="rounded-xl border border-dashed border-line px-4 py-5 text-center"
        >
          <p className="flex items-baseline justify-center gap-1">
            <span className="display text-[32px] leading-none text-ink">
              {only.weightKg.toFixed(1)}
            </span>
            <span className="text-xs text-mute">kg</span>
          </p>
          <p className="mt-1.5 text-[11px] text-mute">{only.date.slice(5)} · 目前唯一一次称重</p>
          <p className="mt-2.5 text-xs text-mute">再称一次，这里就会长出曲线。</p>
        </div>
      </>
    );
  }

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
              borderColor: THEME.mute,
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
              grid: { color: CHART_GRID },
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

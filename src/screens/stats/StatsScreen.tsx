import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { CHART_GRID, Line } from '../../components/charts';
import { PartIcon } from '../../components/PartIcon';
import { PhotoTimeline } from '../../components/PhotoTimeline';
import { Stamp } from '../../components/Stamp';
import { BODY_PARTS } from '../../data/bodyParts';
import { addDays, todayStr } from '../../lib/dates';
import { THEME } from '../../lib/theme';
import {
  compare, currentStreak, dailyMovingAverage, exerciseTrend, groupExerciseActivity,
  lastTrainedByBodyPart, loadKind, longestStreak, prevRangeOf, rangeOf,
  setsByBodyPart, weeklyRhythm,
} from '../../lib/stats';
import type { Delta, ExMap, LoadItem, Segment } from '../../lib/stats';
import { getExercisesByIds } from '../../repos/exerciseRepo';
import { listWeights } from '../../repos/weightRepo';
import { listAllItems, listAllWorkoutDates } from '../../repos/workoutRepo';
import { ExercisePicker } from './ExercisePicker';
import { ExerciseTrend } from './ExerciseTrend';
import { TrainingRhythm } from './TrainingRhythm';

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
  const cmp = compare(items, dates, range, prevRangeOf(seg, today), exMap);
  const scoped = items.filter((i) => i.date >= range.from && i.date <= range.to);
  // 全时段判断，不是 scoped：「你是不是一个搬铁的人」是这个人的属性，不是这三天的属性。
  // 用 scoped 会让一个举铁的人在「本周只练了自重」时整块容量口径消失、下周一又回来——
  // 页面结构随最近三天的偶然性漂移。而下面的「力量趋势」本来就吃全时段（见 :126），
  // 两处口径必须一致，否则会出现「曲线画着卧推，上面的大数字却当他没重量数据」。
  //
  // 同一条理由往下再走一级：「你记不记次数」也是这个人的属性。只记组数、连次数都不记的人
  // （sanitizeSets 明确允许）volumeKg 和 reps 双 0——降级到「总次数」还是个 0，
  // 旁边「总组数 5」正亮着，两个数字在同一排互相拆台。第三级给动作数（见 loadKind）。
  const kind = loadKind(items, exMap);
  const activityGroups = groupExerciseActivity(items, exMap, today);
  const activities = activityGroups.flatMap((group) => group.exercises);
  const defaultActivity = activities.find((activity) => activity.trainedToday)
    ?? [...activities].sort((a, b) => b.lastDate.localeCompare(a.lastDate))[0];
  const activeId = activities.some((activity) => activity.exercise.id === exId)
    ? exId
    : (defaultActivity?.exercise.id ?? '');
  const activeExercise = exMap.get(activeId);
  const rhythm = weeklyRhythm(items, dates, 12, today);

  return (
    <div className="px-5 pt-6 pb-4">
      <h1 className="text-[22px] font-extrabold">数据</h1>

      <div className="mt-3.5 mb-1 inline-flex rounded-[10px] border border-line bg-raised p-[3px] text-xs">
        {SEGMENTS.map((s) => (
          <button
            data-ui-control="range-segment"
            key={s.id}
            type="button"
            onClick={() => setSeg(s.id)}
            className={`min-h-9 rounded-lg px-3.5 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-iron ${
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

      <Section title="动作进步" sub="全历史动作 · 今日练过的动作优先" />
      <ExercisePicker groups={activityGroups} activeId={activeId} onPick={setExId} />

      <Section title="最近 12 周" sub="柱高 = 每周组数 · 每周训练天数可读" />
      <TrainingRhythm points={rhythm} />

      <div className="mt-7">
        {activeExercise && (
          <ExerciseTrend exercise={activeExercise} trend={exerciseTrend(items, activeExercise, 12)} />
        )}
      </div>

      <Balance items={scoped} allItems={items} exMap={exMap} today={today} seg={seg} />

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
        {sub && <p className="mt-1 text-[10px] leading-snug text-mute">{sub}</p>}
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
        aria-label={`体重 7 日均线：${weights.length} 条记录，从 ${weights[0].weightKg} 公斤到 ${weights[weights.length - 1].weightKg} 公斤`}
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

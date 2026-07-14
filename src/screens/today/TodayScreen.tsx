import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ForgeRing } from '../../components/ForgeRing';
import { NavGlyph, PartIcon } from '../../components/PartIcon';
import { PhotoCard } from '../../components/PhotoCard';
import { Stamp } from '../../components/Stamp';
import { bodyPartInfo } from '../../data/bodyParts';
import { formatToday, parseDate, todayStr } from '../../lib/dates';
import { currentStreak, longestStreak, weekProgress } from '../../lib/stats';
import type { BodyPart } from '../../lib/types';
import { validBodyWeight } from '../../lib/validation';
import { getProfile } from '../../repos/profileRepo';
import { getWeight, setWeight } from '../../repos/weightRepo';
import { getDayItems, listAllWorkoutDates, type DayItem } from '../../repos/workoutRepo';
import { useLogDraft } from '../../stores/logDraftStore';

interface PartGroup {
  part: BodyPart;
  sets: number;
  volume: number;
  names: string[];
}

/** 同部位的多个动作合并为一行：组数累加、容量累加、动作名去重。 */
function groupByPart(items: DayItem[]): PartGroup[] {
  const groups: PartGroup[] = [];
  for (const item of items) {
    const part = item.exercise.bodyPart;
    let group = groups.find((g) => g.part === part);
    if (!group) {
      group = { part, sets: 0, volume: 0, names: [] };
      groups.push(group);
    }
    group.sets += item.sets.length;
    group.volume += item.sets.reduce((sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0), 0);
    if (!group.names.includes(item.exercise.name)) group.names.push(item.exercise.name);
  }
  return groups;
}

export function TodayScreen() {
  const today = todayStr();
  const items = useLiveQuery(() => getDayItems(today), [today]);
  const data = useLiveQuery(async () => {
    const [profile, allDates] = await Promise.all([getProfile(), listAllWorkoutDates()]);
    return { profile, allDates };
  }, []);
  const hasDraft = useLogDraft((s) => s.active && (s.parts.length > 0 || s.items.length > 0));

  const goal = data?.profile.weeklyGoal ?? 4;
  const week = data ? weekProgress(data.allDates, today) : 0;
  const streak = data ? currentStreak(new Set(data.allDates), today) : 0;
  const best = data ? longestStreak(data.allDates) : 0;
  const total = data?.allDates.length ?? 0;

  const groups = groupByPart(items ?? []);
  const trained = groups.length > 0;
  const remain = Math.max(0, goal - week);

  return (
    <div className="px-6 pt-6">
      {/* 品牌落在第一屏：钢印 + wordmark */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Stamp size={26} decorative />
          <span className="leading-none">
            <b className="block text-base font-extrabold tracking-[1px] text-ink">铁证</b>
            <span className="mt-1 block text-[10px] tracking-[2px] text-mute">IRONPROOF</span>
          </span>
        </div>
        <span className="text-xs text-mute">{formatToday(parseDate(today))}</span>
      </header>

      {/* 主视觉：练了 → 钢印落下；没练 → 本周锻造环 */}
      <section className="flex items-center gap-6 pt-8 pb-6">
        {trained ? (
          <div
            role="img"
            aria-label="今日铁证"
            className="flex h-32 w-32 shrink-0 items-center justify-center"
          >
            <Stamp size={104} animate decorative />
          </div>
        ) : (
          <ForgeRing value={week} goal={goal} size={128} />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[11px] tracking-[2px] text-mute uppercase">
            {trained
              ? `本周已练 ${week} 天`
              : remain > 0
                ? `还差 ${remain} 练`
                : `本周目标已达成`}
          </p>
          <h1 className="mt-1.5 text-[28px] leading-[1.15] font-extrabold text-ink">
            {trained ? '今天，铁证已落。' : '今天，留证。'}
          </h1>
          {streak > 0 ? (
            <p className="mt-2.5 flex items-center gap-1.5 text-[13px] text-amber">
              <Flame />
              {/* 「个人纪录」这个词全站只归「我的」页的 e1RM 重量榜（个人纪录 · PR）。
                  这里说的是连续天数——它叫「最长连续」，和数据页、「我的」页同一个词、同一个数。
                  同名不同量，用户读到的不是「两个指标」，是「这 app 算错了」。 */}
              <span>
                连续 {streak} 天 · 最长连续 {best} 天
              </span>
            </p>
          ) : total > 0 ? (
            <p className="mt-2.5 text-[13px] text-mute">最长连续 {best} 天</p>
          ) : null}
        </div>
      </section>

      {/* 今日已练：etch 线分隔的清单，不是卡片堆 */}
      {trained && (
        <section>
          <div className="etch" />
          <p className="mb-1 text-[11px] tracking-[2px] text-mute uppercase">今日已练</p>
          <ul>
            {groups.map((group, i) => (
              <li
                key={group.part}
                className={`flex items-center gap-3 py-3.5 ${i > 0 ? 'border-t border-line' : ''}`}
              >
                <span
                  data-part={group.part}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]"
                  style={{ background: `${bodyPartInfo(group.part).color}26` }}
                >
                  <PartIcon part={group.part} size={20} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">
                    <span>{bodyPartInfo(group.part).name}</span>
                    <span className="text-mute"> · </span>
                    {group.names.map((name, j) => (
                      <Fragment key={name}>
                        {j > 0 && <span className="text-mute"> / </span>}
                        <span>{name}</span>
                      </Fragment>
                    ))}
                  </span>
                  {/* 组数是右栏大号数字的主场；meta 行只补它没说的（容量）。没得补就整行不渲染 */}
                  {group.volume > 0 && (
                    <span data-testid="today-meta" className="mt-0.5 block text-xs text-mute">
                      {Math.round(group.volume).toLocaleString('en-US')} kg 容量
                    </span>
                  )}
                </span>

                <span data-testid="today-sets" className="flex shrink-0 items-baseline gap-1">
                  <span className="display text-xl leading-none text-ink">{group.sets}</span>
                  <span className="text-[11px] text-mute">组</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 唯一的热区：铁橙渐变 CTA */}
      <Link
        to="/log"
        className="heat mt-6 flex items-center justify-center gap-2.5 rounded-[20px] py-[19px] text-lg font-extrabold text-white shadow-[0_8px_32px_rgba(255,92,31,.35)] transition-transform active:scale-[.98]"
      >
        <NavGlyph icon="today" size={22} />
        {hasDraft ? '继续未完成的记录' : trained ? '继续打卡' : '开始今日训练'}
      </Link>

      <div className="etch" />
      <WeightQuickEntry today={today} />

      <div className="etch" />
      <PhotoCard date={today} />

      <div className="h-8" />
    </div>
  );
}

function Flame() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c1 4-2 5-2 8a3 3 0 0 0 6 0c0-1-.4-2-.4-2 2 1.5 3.4 4 3.4 6a7 7 0 0 1-14 0c0-4 3-6 5-9 1-1.5 2-2.5 2-3z" />
    </svg>
  );
}

function WeightQuickEntry({ today }: { today: string }) {
  const existing = useLiveQuery(() => getWeight(today), [today]);
  const [raw, setRaw] = useState('');
  const [error, setError] = useState(false);

  async function save() {
    const kg = Number(raw);
    if (!validBodyWeight(kg)) {
      setError(true);
      return;
    }
    setError(false);
    await setWeight(today, kg);
    setRaw('');
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-[11px] tracking-[2px] text-mute uppercase">今日体重</p>
        {existing && (
          <p className="display text-2xl leading-none text-ink">
            {existing.weightKg.toFixed(1)} kg
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <input
          inputMode="decimal"
          placeholder={existing ? '修改…' : '体重 kg'}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            if (error) setError(false);
          }}
          className="min-w-0 flex-1 rounded-xl bg-raised px-4 py-3 text-ink placeholder:text-mute"
        />
        <button
          type="button"
          disabled={raw.trim() === ''}
          onClick={save}
          className="shrink-0 rounded-xl bg-raised px-5 py-3 font-semibold text-iron disabled:opacity-30 active:scale-95"
        >
          记录
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-iron">体重需在 20–300kg 之间</p>}
    </section>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ProgressRing } from '../../components/ProgressRing';
import { bodyPartInfo } from '../../data/bodyParts';
import { formatToday, parseDate, todayStr } from '../../lib/dates';
import { currentStreak, weekProgress } from '../../lib/stats';
import { validBodyWeight } from '../../lib/validation';
import { getProfile } from '../../repos/profileRepo';
import { getWeight, setWeight } from '../../repos/weightRepo';
import { getDayItems, listAllWorkoutDates } from '../../repos/workoutRepo';
import { useLogDraft } from '../../stores/logDraftStore';

export function TodayScreen() {
  const today = todayStr();
  const items = useLiveQuery(() => getDayItems(today), [today]);
  const data = useLiveQuery(async () => {
    const [profile, allDates] = await Promise.all([getProfile(), listAllWorkoutDates()]);
    return { profile, allDates };
  }, []);
  const draft = useLogDraft();
  const draftActive = draft.active && (draft.parts.length > 0 || draft.items.length > 0);

  const goal = data?.profile.weeklyGoal ?? 4;
  const week = data ? weekProgress(data.allDates, today) : 0;
  const streak = data ? currentStreak(new Set(data.allDates), today) : 0;

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <header>
        <p className="text-sm text-mute">{formatToday(parseDate(today))}</p>
        <h1 className="text-3xl font-bold">今天，留证。</h1>
      </header>

      <div className="flex items-center gap-6 rounded-2xl bg-card p-5">
        <ProgressRing value={week} max={goal}>
          <span className="text-2xl font-bold">
            {week}
            <span className="text-base text-mute">/{goal}</span>
          </span>
          <span className="text-[11px] text-mute">本周目标</span>
        </ProgressRing>
        <div className="flex flex-col gap-2 text-sm text-mute">
          <p>
            <span className="text-xl font-bold text-ink">{streak}</span> 天连续
          </p>
          <p>
            <span className="text-xl font-bold text-ink">{data?.allDates.length ?? 0}</span> 天累计
          </p>
        </div>
      </div>

      {items && items.length > 0 && (
        <div className="rounded-2xl bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-mute">今日已练</h2>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: bodyPartInfo(item.exercise.bodyPart).color }}
                />
                <span className="flex-1">{item.exercise.name}</span>
                <span className="text-sm text-mute">{item.sets.length} 组</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link
        to="/log"
        className="rounded-2xl bg-iron py-4 text-center text-lg font-bold text-white active:scale-[.98]"
      >
        {items && items.length > 0
          ? '+ 继续加练'
          : draftActive
            ? '继续未完成的记录'
            : '+ 开始今日训练'}
      </Link>

      <WeightQuickEntry today={today} />
    </div>
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
    <div className="rounded-2xl bg-card p-5">
      <h2 className="mb-3 text-sm font-semibold text-mute">今日体重</h2>
      {existing && <p className="mb-2 text-2xl font-bold">{existing.weightKg} kg</p>}
      <div className="flex gap-2">
        <input
          inputMode="decimal"
          placeholder={existing ? '修改…' : '体重 kg'}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="flex-1 rounded-lg bg-card2 px-3 py-2 text-ink placeholder:text-mute/60"
        />
        <button
          type="button"
          disabled={raw.trim() === ''}
          onClick={save}
          className="rounded-lg bg-card2 px-4 py-2 text-iron disabled:opacity-30 active:scale-95"
        >
          记录
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-iron">体重需在 20–300kg 之间</p>}
    </div>
  );
}

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Line, MixedChart, Radar } from '../../components/charts';
import { BODY_PARTS } from '../../data/bodyParts';
import { addDays, todayStr } from '../../lib/dates';
import {
  countByBodyPart, maxWeightSeries, movingAverage, totals, weeklyCounts,
} from '../../lib/stats';
import type { BodyPart } from '../../lib/types';
import { getExercisesByIds } from '../../repos/exerciseRepo';
import { getProfile } from '../../repos/profileRepo';
import { listWeights } from '../../repos/weightRepo';
import { listAllItems, listAllWorkoutDates } from '../../repos/workoutRepo';

const RANGES = [30, 90, 365] as const;

export function StatsScreen() {
  const today = todayStr();
  const [rangeDays, setRangeDays] = useState<(typeof RANGES)[number]>(30);
  const [strengthExId, setStrengthExId] = useState('');

  const data = useLiveQuery(async () => {
    const [items, dates, weights, profile] = await Promise.all([
      listAllItems(),
      listAllWorkoutDates(),
      listWeights(addDays(today, -364), today),
      getProfile(),
    ]);
    const exMap = await getExercisesByIds([...new Set(items.map((i) => i.exerciseId))]);
    return { items, dates, weights, profile, exMap };
  }, [today]);

  if (!data) return null;

  const { items, dates, weights, profile, exMap } = data;

  const rangeFrom = addDays(today, -(rangeDays - 1));
  const radarParts = items
    .filter((i) => i.date >= rangeFrom)
    .map((i) => exMap.get(i.exerciseId)?.bodyPart)
    .filter((p): p is BodyPart => p !== undefined);
  const radarCounts = countByBodyPart(radarParts);

  const weeks = weeklyCounts(dates, 12, today);
  const sums = totals(items, dates);

  const strengthOptions = [...exMap.values()].filter((ex) =>
    items.some((i) => i.exerciseId === ex.id && i.sets.some((s) => s.weight !== undefined)),
  );
  const strengthEx = strengthOptions.find((e) => e.id === strengthExId) ?? strengthOptions[0];
  const strength = strengthEx
    ? maxWeightSeries(items.filter((i) => i.exerciseId === strengthEx.id))
    : [];

  const weightValues = weights.map((w) => w.weightKg);
  const weightMa = movingAverage(weightValues, 7);

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <h1 className="text-2xl font-bold">数据</h1>

      <div className="grid grid-cols-3 gap-3">
        <BigNumber label="总打卡天数" value={sums.days} />
        <BigNumber label="总组数" value={sums.sets} />
        <BigNumber label="总容量 kg" value={Math.round(sums.volumeKg)} />
      </div>

      <section className="rounded-2xl bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-mute">部位频次</h2>
          <div className="flex gap-1">
            {RANGES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setRangeDays(d)}
                className={`rounded-md px-2 py-1 text-xs ${
                  rangeDays === d ? 'bg-iron/15 text-iron' : 'text-mute'
                }`}
              >
                {d}天
              </button>
            ))}
          </div>
        </div>
        <Radar
          data={{
            labels: BODY_PARTS.map((p) => p.name),
            datasets: [
              {
                data: BODY_PARTS.map((p) => radarCounts[p.id]),
                backgroundColor: 'rgba(255,92,31,0.25)',
                borderColor: '#FF5C1F',
                pointBackgroundColor: '#FF5C1F',
              },
            ],
          }}
          options={{ scales: { r: { ticks: { display: false }, beginAtZero: true } } }}
        />
      </section>

      <section className="rounded-2xl bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-mute">周训练频次 · 近 12 周</h2>
        <MixedChart
          type="bar"
          data={{
            labels: weeks.map((w) => w.weekStart.slice(5)),
            datasets: [
              {
                type: 'bar' as const,
                data: weeks.map((w) => w.count),
                backgroundColor: '#FF5C1F',
                borderRadius: 4,
              },
              {
                type: 'line' as const,
                data: weeks.map(() => profile.weeklyGoal),
                borderColor: '#8E8E93',
                borderDash: [6, 4],
                pointRadius: 0,
              },
            ],
          }}
          options={{ scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }}
        />
      </section>

      {weights.length > 0 && (
        <section className="rounded-2xl bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-mute">体重趋势 · 7 日均线</h2>
          <Line
            data={{
              labels: weights.map((w) => w.date.slice(5)),
              datasets: [
                {
                  data: weightValues,
                  borderColor: 'rgba(255,92,31,0.4)',
                  pointRadius: 2,
                  pointBackgroundColor: '#FF5C1F',
                },
                { data: weightMa, borderColor: '#FF8C42', pointRadius: 0, tension: 0.3 },
              ],
            }}
          />
        </section>
      )}

      {strengthEx && (
        <section className="rounded-2xl bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-mute">力量曲线 · 每日最大重量</h2>
            <select
              value={strengthEx.id}
              onChange={(e) => setStrengthExId(e.target.value)}
              className="rounded-md bg-card2 px-2 py-1 text-xs text-ink"
            >
              {strengthOptions.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
          </div>
          <Line
            data={{
              labels: strength.map((s) => s.date.slice(5)),
              datasets: [
                {
                  data: strength.map((s) => s.maxKg),
                  borderColor: '#FF5C1F',
                  pointBackgroundColor: '#FF5C1F',
                  tension: 0.2,
                },
              ],
            }}
          />
        </section>
      )}
    </div>
  );
}

function BigNumber({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-card p-3 text-center">
      <p className="text-2xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-[11px] text-mute">{label}</p>
    </div>
  );
}

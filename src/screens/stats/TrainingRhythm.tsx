import { percentile, type WeeklyRhythmPoint } from '../../lib/stats';

export function TrainingRhythm({ points }: { points: WeeklyRhythmPoint[] }) {
  const setCounts = points.map((point) => point.sets);
  const positive = setCounts.filter((sets) => sets > 0);
  const ceiling = positive.length === 0
    ? 0
    : Math.max(percentile(setCounts, 90), Math.min(...positive));

  return (
    <div>
      <div className="grid h-28 grid-cols-12 items-end gap-1.5" role="group" aria-label="最近 12 周训练节奏">
        {points.map((point, index) => {
          const height = ceiling > 0 ? Math.min(100, (point.sets / ceiling) * 100) : 0;
          const date = point.weekStart.slice(5);
          const label = `${point.current ? '本周' : `${date} 起`} · ${point.days} 天 · ${point.sets} 组`;
          return (
            <span
              key={point.weekStart}
              role="img"
              aria-label={label}
              className="flex h-full min-w-0 items-end rounded-md bg-white/[0.035] p-0.5"
              title={label}
            >
              <span
                data-testid={`rhythm-bar-${index}`}
                className={`block min-h-1 w-full rounded-[4px] transition-[height] duration-300 ${
                  point.current ? 'bg-iron' : 'bg-iron/35'
                }`}
                style={{ height: `${height}%` }}
                aria-hidden
              />
            </span>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-mute">
        <span>{points[0]?.weekStart.slice(5) ?? '—'}</span>
        <span className="font-semibold text-iron">本周</span>
      </div>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { buttonClassName } from '../../components/Button';
import { percentile, type WeeklyRhythmPoint } from '../../lib/stats';

export function TrainingRhythm({ points }: { points: WeeklyRhythmPoint[] }) {
  const setCounts = points.map((point) => point.sets);
  const positive = setCounts.filter((sets) => sets > 0);
  if (positive.length === 0) {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-4 py-5 text-center">
        <p className="text-sm text-mute">最近 12 周还没有训练</p>
        <Link to="/log" className={buttonClassName('secondary', false, 'px-4 text-iron')}>
          去打卡
        </Link>
      </div>
    );
  }
  const ceiling = Math.max(percentile(setCounts, 90), Math.min(...positive));

  return (
    <div>
      <div className="grid h-32 grid-cols-12 items-end gap-1.5" role="group" aria-label="最近 12 周训练节奏">
        {points.map((point, index) => {
          const height = ceiling > 0 ? Math.min(100, (point.sets / ceiling) * 100) : 0;
          const date = point.weekStart.slice(5);
          const label = `${point.current ? '本周' : `${date} 起`} · ${point.days} 天 · ${point.sets} 组`;
          return (
            <span
              key={point.weekStart}
              role="img"
              aria-label={label}
              className="relative flex h-full min-w-0 items-end pt-4"
              title={label}
            >
              {point.days > 0 && (
                <span
                  data-testid={`rhythm-days-${index}`}
                  className={`absolute top-0 w-full text-center text-[9px] font-semibold ${point.current ? 'text-iron' : 'text-mute'}`}
                  aria-hidden
                >
                  {point.days}
                </span>
              )}
              <span className="flex h-[calc(100%-1rem)] w-full items-end rounded-md bg-white/[0.035] p-0.5" aria-hidden>
                <span
                  data-testid={`rhythm-bar-${index}`}
                  className={`block min-h-1 w-full rounded-[4px] transition-[height] duration-300 ${
                    point.current ? 'bg-iron' : 'bg-iron/35'
                  }`}
                  style={{ height: `${height}%` }}
                />
              </span>
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

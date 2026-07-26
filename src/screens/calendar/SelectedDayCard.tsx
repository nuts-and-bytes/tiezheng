import { Link } from 'react-router-dom';
import { PartIcon } from '../../components/PartIcon';
import { bodyPartInfo } from '../../data/bodyParts';
import type { RailDaySummary } from '../../lib/calendar';
import { formatRelativeWorkoutDate, parseDate } from '../../lib/dates';

function formatFullDate(date: string): string {
  const value = parseDate(date);
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`;
}

export function SelectedDayCard({
  summary,
  today,
  hasPhoto = false,
}: {
  summary: RailDaySummary;
  today: string;
  hasPhoto?: boolean;
}) {
  return (
    <section className="forged-surface rounded-[18px] px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-ink">
            {formatRelativeWorkoutDate(summary.date, today)}
          </h2>
          <p className="mt-1 text-[11px] tracking-[0.08em] text-mute">
            {formatFullDate(summary.date)}{hasPhoto ? ' · 留有训练照' : ''}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5" aria-label="训练部位">
          {summary.parts.map((part) => {
            const info = bodyPartInfo(part);
            return (
              <span
                key={part}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-white/10 bg-bg/55 px-2.5 text-xs font-semibold"
                style={{ color: info.color }}
              >
                <PartIcon part={part} size={15} />
                {info.name}
              </span>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-y border-line/80 py-3 text-sm font-semibold tabular-nums text-ink">
        <span>{summary.moves} 个动作</span>
        <span>{summary.sets} 组</span>
        {summary.volumeKg !== null && <span>{summary.volumeKg.toLocaleString('en-US')} kg</span>}
      </div>

      <ul className="mt-3 space-y-2" aria-label="训练动作">
        {summary.exercises.map((exercise) => (
          <li key={exercise.exerciseId} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{exercise.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-mute">{exercise.sets} 组</span>
          </li>
        ))}
      </ul>

      <Link
        to={`/day/${summary.date}`}
        className="mt-4 inline-flex min-h-10 items-center text-sm font-semibold text-iron transition active:scale-[.98]"
      >
        查看完整记录
        <span aria-hidden className="ml-1">›</span>
      </Link>
    </section>
  );
}

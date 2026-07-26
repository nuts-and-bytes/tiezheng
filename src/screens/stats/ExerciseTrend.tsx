import { CHART_GRID, Line } from '../../components/charts';
import type { ExerciseTrend as ExerciseTrendData } from '../../lib/stats';
import { THEME } from '../../lib/theme';
import type { Exercise } from '../../lib/types';

const TREND_TITLE: Record<ExerciseTrendData['kind'], string> = {
  assistance: '辅助趋势',
  e1rm: '力量趋势 · 估算 1RM',
  reps: '次数趋势',
  sets: '组数趋势',
};

export function ExerciseTrend({ exercise, trend }: { exercise: Exercise; trend: ExerciseTrendData }) {
  const { points } = trend;
  return (
    <section aria-labelledby="exercise-trend-title">
      <div className="mb-3 flex items-end justify-between gap-3">
        <span>
          <h2 id="exercise-trend-title" className="text-[11px] tracking-[2px] text-mute uppercase">
            {TREND_TITLE[trend.kind]}
          </h2>
          <p className="mt-1 text-xs font-semibold text-ink">{exercise.name}</p>
        </span>
        <span className="text-[10px] text-mute">最近 12 次记录 · 不随上方范围变化</span>
      </div>

      {trend.kind === 'assistance' && (
        <p className="mb-3 text-[11px] text-amber">辅助越少，表现越强</p>
      )}

      {points.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-mute">
          再记一组有效数据，这里就会长出趋势。
        </p>
      ) : points.length === 1 ? (
        <div data-testid="strength-single" className="rounded-xl bg-raised px-4 py-5 text-center">
          <p className="flex items-baseline justify-center gap-1">
            <span className="display text-[34px] leading-none text-ink">{formatValue(points[0].value, trend.kind)}</span>
            <span className="text-xs text-mute">{trend.unit}</span>
          </p>
          <p className="mt-2 text-[11px] text-mute">{points[0].date.slice(5)} · 目前唯一一次记录</p>
        </div>
      ) : (
        <Line
          aria-label={`${TREND_TITLE[trend.kind]}：${exercise.name}，${points.length} 次记录，从 ${formatValue(points[0].value, trend.kind)} ${trend.unit} 到 ${formatValue(points[points.length - 1].value, trend.kind)} ${trend.unit}`}
          data={{
            labels: points.map((point) => point.date.slice(5)),
            datasets: [{
              data: points.map((point) => point.value),
              borderColor: THEME.iron,
              backgroundColor: 'rgba(255,92,31,0.10)',
              borderWidth: 2.5,
              fill: true,
              tension: 0.35,
              pointRadius: 3,
              pointHoverRadius: 4,
              pointBackgroundColor: THEME.amber,
            }],
          }}
          options={{
            scales: {
              x: { grid: { display: false }, ticks: { maxTicksLimit: 5, font: { size: 9 } } },
              y: {
                reverse: trend.inverse,
                grid: { color: CHART_GRID },
                border: { display: false },
                ticks: { maxTicksLimit: 4, font: { size: 9 } },
              },
            },
            plugins: {
              tooltip: {
                callbacks: {
                  label: (context) => context.parsed.y == null
                    ? ''
                    : `${formatValue(context.parsed.y)} ${trend.unit}`,
                },
              },
            },
          }}
        />
      )}
    </section>
  );
}

function formatValue(value: number, kind?: ExerciseTrendData['kind']): string {
  if (kind === 'e1rm') return value.toFixed(1);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

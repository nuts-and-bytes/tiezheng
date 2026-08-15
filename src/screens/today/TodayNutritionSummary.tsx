import { Link } from 'react-router-dom';
import { track } from '../../lib/analytics';

export function TodayNutritionSummary() {
  return (
    <section
      aria-labelledby="today-nutrition-title"
      className="mt-4 rounded-xl border border-line bg-raised px-4 py-4"
    >
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 id="today-nutrition-title" className="text-[11px] tracking-[2px] text-mute uppercase">
            今日饮食
          </h2>
          <p className="mt-1 text-sm font-semibold text-ink">记录今天吃了什么</p>
        </div>
        <Link
          to="/health"
          aria-label="进入健康"
          onClick={() => track('health_opened')}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-iron outline-none transition active:scale-[.98] focus-visible:ring-2 focus-visible:ring-iron motion-reduce:transition-none"
        >
          进入健康 <span aria-hidden="true">›</span>
        </Link>
      </div>
    </section>
  );
}

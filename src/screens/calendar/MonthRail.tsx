import { useEffect, useRef } from 'react';
import { bodyPartInfo } from '../../data/bodyParts';
import type { MonthRailDay } from '../../lib/calendar';
import { cellParts } from '../../lib/heat';

export function MonthRail({
  days,
  selectedDate,
  onSelect,
}: {
  days: MonthRailDay[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedDate]);

  return (
    <div className="-mx-5 overflow-x-auto px-5 pb-2" data-testid="month-rail">
      <div className="flex min-w-max items-end gap-2" role="group" aria-label="月度训练轨道">
        {days.map((day) => {
          const selected = day.date === selectedDate;
          const allParts = day.parts.map((part) => bodyPartInfo(part));
          const visibleParts = cellParts(day.parts).map((part) => bodyPartInfo(part));
          const label = `${Number(day.date.slice(0, 4))}年${Number(day.date.slice(5, 7))}月${day.day}日 · ${allParts.map((part) => part.name).join('、')} · ${day.sets} 组`;

          return (
            <span key={day.date} className="flex w-6 shrink-0 flex-col items-center" data-testid={`rail-day-${day.date}`}>
              {day.trained ? (
                <button
                  data-ui-control="rail-date-selection"
                  type="button"
                  aria-label={label}
                  aria-pressed={selected}
                  ref={selected ? selectedRef : undefined}
                  onClick={() => onSelect(day.date)}
                  className={`relative flex h-28 w-6 items-end justify-center rounded-md outline-none transition duration-200 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-iron focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
                    selected ? 'ring-2 ring-iron ring-offset-2 ring-offset-bg' : ''
                  }`}
                >
                  <span
                    className="flex w-full overflow-hidden rounded-[5px]"
                    style={{ height: `${day.heightPct}%` }}
                    aria-hidden
                  >
                    {visibleParts.map((part) => (
                      <span
                        key={part.id}
                        data-part-segment={part.id}
                        className="h-full flex-1"
                        style={{ backgroundColor: part.color }}
                      />
                    ))}
                  </span>
                  {selected && (
                    <span className="absolute bottom-1 text-[9px] font-extrabold leading-none text-bg" aria-hidden>
                      {day.day}
                    </span>
                  )}
                </button>
              ) : (
                <span className="flex h-28 w-6 items-end justify-center" aria-hidden>
                  <span
                    className="w-1 rounded-full bg-white/10"
                    style={{ height: `${day.heightPct}%` }}
                  />
                </span>
              )}
              <span className="mt-2 h-3 text-[9px] leading-3 text-mute" aria-hidden>
                {day.anchorLabel && <span data-testid="rail-anchor">{day.anchorLabel}</span>}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

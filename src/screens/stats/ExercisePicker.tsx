import { PartIcon } from '../../components/PartIcon';
import { bodyPartInfo } from '../../data/bodyParts';
import type { ExerciseActivityGroup } from '../../lib/stats';

export function ExercisePicker({
  groups,
  activeId,
  onPick,
}: {
  groups: ExerciseActivityGroup[];
  activeId: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="space-y-4" aria-label="按部位选择动作">
      {groups.map((group) => {
        const part = bodyPartInfo(group.bodyPart);
        return (
          <section key={group.bodyPart} aria-labelledby={`exercise-part-${group.bodyPart}`}>
            <h3
              id={`exercise-part-${group.bodyPart}`}
              className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-mute"
            >
              <span
                className="flex size-6 items-center justify-center rounded-md"
                style={{ backgroundColor: `${part.color}24` }}
                aria-hidden
              >
                <PartIcon part={group.bodyPart} size={14} color={part.color} />
              </span>
              {part.name}
            </h3>
            <div className="flex flex-wrap gap-2">
              {group.exercises.map(({ exercise, trainedToday }) => {
                const active = exercise.id === activeId;
                return (
                  <button
                    key={exercise.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onPick(exercise.id)}
                    className={`min-h-9 rounded-lg px-3 py-1.5 text-xs transition duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iron ${
                      active
                        ? 'font-semibold text-bg'
                        : 'border border-line bg-raised text-ink hover:border-white/20'
                    }`}
                    style={active ? { backgroundColor: part.color } : undefined}
                  >
                    <span>{exercise.name}</span>
                    {trainedToday && (
                      <span
                        className={`ml-1.5 text-[10px] ${active ? 'text-bg/75' : 'font-semibold'}`}
                        style={active ? undefined : { color: part.color }}
                      >
                        今日
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

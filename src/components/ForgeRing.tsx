import { ProgressRing } from './ProgressRing';
import { Stamp } from './Stamp';

interface Props {
  value: number;
  goal: number;
  size?: number;
}

/** 周进度锻造环。达标后环心落下钢印 */
export function ForgeRing({ value, goal, size = 160 }: Props) {
  const done = goal > 0 && value >= goal;
  return (
    <ProgressRing value={value} max={goal} size={size} stroke={12}>
      {done ? (
        <Stamp size={size * 0.44} animate decorative />
      ) : (
        <>
          <span className="display text-4xl leading-none text-ink">{value}</span>
          <span className="mt-1 text-xs text-mute">/ {goal} 练</span>
        </>
      )}
    </ProgressRing>
  );
}

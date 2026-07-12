import type { ReactNode } from 'react';
import { bodyPartInfo } from '../data/bodyParts';
import type { BodyPart } from '../lib/types';

/** 图形逐字取自 docs/design-cards/brand/icons.html（视觉真相源）。
    统一 viewBox 0 0 24 24 / fill none / stroke-width 1.8 / 圆头圆角 */
const SHAPES: Record<BodyPart, ReactNode> = {
  chest: (
    <>
      <path d="M5.5 4h13l1 5.5c0 4.5-3.2 8-7.5 8s-7.5-3.5-7.5-8L5.5 4Z" />
      <path d="M7.2 9.6c1.5 1.7 3 2.3 4.8 2.3s3.3-.6 4.8-2.3" />
      <path d="M12 5.2v6.6" />
    </>
  ),
  shoulder: (
    <>
      <circle cx="12" cy="5.3" r="2.2" />
      <path d="M4 18.5c0-4.8 3.6-8.6 8-8.6s8 3.8 8 8.6" />
      <path d="M4 18.5c0-3.2 1.1-5.2 2.9-6.5M20 18.5c0-3.2-1.1-5.2-2.9-6.5" />
    </>
  ),
  back: (
    <>
      <path d="M6 3.5l1.7 10L12 20l4.3-6.5 1.7-10" />
      <path d="M12 7.5V16" />
      <path d="M8.2 8.6c1.2 1 2.4 1.4 3.8 1.4s2.6-.4 3.8-1.4" />
    </>
  ),
  leg: (
    <>
      <path d="M9 3c-.3 3.4-1.9 5.4-1.9 8.4 0 3.4 1.5 5.6 2.7 8.6" />
      <path d="M15 3c.3 3.4 1.9 5.4 1.9 8.4 0 3.4-1.5 5.6-2.7 8.6" />
      <path d="M12 3v5.5" />
    </>
  ),
  arm: (
    <path d="M7 19.5c-1.8 0-3.2-1.4-3.2-3.2 0-1.5 1.1-2.9 2.7-3.3C9.8 12 11.8 10.4 11.8 7.4V4.2L16.4 6v5.2c0 4.6-3.7 8.3-8.3 8.3H7Z" />
  ),
  core: (
    <>
      <rect x="7.5" y="4" width="9" height="16" rx="3.6" />
      <path d="M12 4v16M7.5 9.5h9M7.5 14.5h9" />
    </>
  ),
  cardio: (
    <>
      <path d="M12 20s-7-4.4-7-9.8A4 4 0 0 1 12 7.6 4 4 0 0 1 19 10.2C19 15.6 12 20 12 20Z" />
      <path d="M5.6 11.2h2.9l1.4-2.3 2 4.2 1.5-2.6h5" />
    </>
  ),
};

interface Props {
  part: BodyPart;
  size?: number;
  /** 覆盖描边色。默认用部位色；TabBar 等场景传 'currentColor' */
  color?: string;
}

export function PartIcon({ part, size = 24, color }: Props) {
  const stroke = color ?? bodyPartInfo(part).color;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* stroke 同时落在 <g> 上：子图形独立于 <svg> 根也带色，便于内联/序列化复用 */}
      <g stroke={stroke}>{SHAPES[part]}</g>
    </svg>
  );
}

export type NavIcon = 'today' | 'calendar' | 'stats' | 'profile';

/** 底部导航 4 枚。「今日」= 倾斜的钢印锤落（与品牌隐喻同源） */
const NAV_SHAPES: Record<NavIcon, ReactNode> = {
  today: (
    <>
      <rect x="5" y="4" width="14" height="14" rx="3" transform="rotate(-6 12 11)" />
      <path d="M9.2 10.5l2 2 3.8-4" transform="rotate(-6 12 11)" />
      <path d="M7 21h10" />
    </>
  ),
  calendar: (
    <>
      <path d="M7 2v3m10-3v3M3.5 9h17M5 4.5h14A1.5 1.5 0 0 1 20.5 6v13a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Z" />
      <path d="M8 13h2.5v2.5H8z" fill="currentColor" stroke="none" />
    </>
  ),
  stats: <path d="M4 20V11m5.3 9V4m5.4 16v-6m5.3 6V8" />,
  profile: (
    <>
      <rect x="8" y="3" width="8" height="11" rx="4" />
      <path d="M12 14v3m-3.5 4a3.5 3.5 0 0 1 7 0" />
    </>
  ),
};

export function NavGlyph({ icon, size = 24 }: { icon: NavIcon; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {NAV_SHAPES[icon]}
    </svg>
  );
}

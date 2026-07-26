import type { ReactNode } from 'react';
import { bodyPartInfo } from '../data/bodyParts';
import type { BodyPart } from '../lib/types';

/* 参考 GPT 锻造徽记的“厚轮廓 + 单一锚点”重绘，不描摹生成图像素。
 * 12px 下线条图会糊成灰，因此七枚全部改为实心切角几何，最多保留两块负空间。 */
const SHAPES: Record<BodyPart, ReactNode> = {
  chest: (
    <>
      <path d="M2.5 8.2 5.8 5 11 6.3v6.3L8.8 15 4.6 13.8 2.5 11.2Z" />
      <path d="m21.5 8.2-3.3-3.2L13 6.3v6.3l2.2 2.4 4.2-1.2 2.1-2.6Z" />
      <path d="M4.8 15.2 9.5 17l2.5-2.1 2.5 2.1 4.7-1.8-1.3 3.8H6.1Z" opacity=".72" />
    </>
  ),
  shoulder: (
    <>
      <path d="M2.8 10.5 5.5 6l4.8-1.5.7 4.4-2.7 5.4-4.2 2.1Z" />
      <path d="m21.2 10.5-2.7-4.5-4.8-1.5-.7 4.4 2.7 5.4 4.2 2.1Z" />
    </>
  ),
  back: (
    <>
      <path d="M2.8 5.2 8.9 3l2.2 3.2v6.4L7.8 18 4.4 15l.9-5.3Z" />
      <path d="M21.2 5.2 15.1 3l-2.2 3.2v6.4l3.3 5.4 3.4-3-.9-5.3Z" />
      <path d="m8.9 19.2 3.1-4.8 3.1 4.8-3.1 2Z" opacity=".72" />
    </>
  ),
  leg: (
    <>
      <path d="M5.2 3h5.5l-.6 8-2 3.1-.5 6.9H3.8l.7-8.2Z" />
      <path d="M13.3 3h5.5l.7 9.8.7 8.2h-3.8l-.5-6.9-2-3.1Z" />
    </>
  ),
  arm: (
    <>
      <path d="M5.3 4.2 9 3l2.1 4.4-2.4 2.2 1.5 2.1c2-2.1 5.2-2.5 7.6-.8 2.1 1.5 2.7 4.2 1.5 6.5-1.6 3-5.1 4.4-8.4 3.2L5 18.5l-1-4.1 3-1.3-2.2-3.4Z" />
      <path d="m13.1 13.5 3.4-.4 1.2 2.1-1.6 2.2-3.7-.3-1.5-1.8Z" fill="var(--color-bg)" />
    </>
  ),
  core: (
    <>
      <path d="m7 3 5 1 5-1 2 4-1.2 14H6.2L5 7Z" />
      <path d="M10.8 7h2.4v4h-2.4zm0 6h2.4v4h-2.4z" fill="var(--color-bg)" />
    </>
  ),
  cardio: (
    <>
      <path d="M12 21 3.4 12.8A5.6 5.6 0 0 1 11.9 5a5.6 5.6 0 0 1 8.7 7.8Z" />
      <path d="m11.2 7.8-2 5h2.7l-.8 4.4 4.1-6h-2.7l1.2-3.4Z" fill="var(--color-bg)" />
    </>
  ),
};

interface Props {
  part: BodyPart;
  size?: number;
  /** 覆盖徽记颜色。默认用部位色；单色环境传 currentColor。 */
  color?: string;
}

export function PartIcon({ part, size = 24, color }: Props) {
  const iconColor = color ?? bodyPartInfo(part).color;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      color={iconColor}
      aria-hidden="true"
      focusable="false"
    >
      <g data-shape={part}>{SHAPES[part]}</g>
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

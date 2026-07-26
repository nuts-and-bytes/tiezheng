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

/** 底部导航 4 枚：统一实心切角与负空间，不借用通用线性图标库。 */
const NAV_SHAPES: Record<NavIcon, ReactNode> = {
  today: (
    <>
      <path d="m12 2 8 4.6v9.2L12 22l-8-6.2V6.6Zm0 4.2-4.4 2.5v5l4.4 3.4 4.4-3.4v-5Z" fillRule="evenodd" />
      <path d="m9.2 11.7 1.8 1.8 4-4-1.4-1.4-2.6 2.6-.4-.4Z" />
    </>
  ),
  calendar: (
    <>
      <path d="M4 4h3V2h2v2h6V2h2v2h3v18H4Zm3 6v3h3v-3Zm5 0v3h5v-3Zm-5 5v3h3v-3Zm5 0v3h5v-3Z" fillRule="evenodd" />
    </>
  ),
  stats: (
    <>
      <path d="M3 13.5 7.5 9v12H3Zm6.8-5.7L14.2 3v18H9.8Zm6.7 5.1L21 8.5V21h-4.5Z" />
      <path d="m3.5 10.3 5.2-5 4.2 2.4 6.4-5.2 1.3 1.6-7.5 6.1-4.1-2.4-4.1 4Z" opacity=".7" />
    </>
  ),
  profile: (
    <>
      <path d="m8 2 4-1 4 1 1 3-1.2 5-3.8 2-3.8-2L7 5Z" />
      <path d="m5 15 4-2 3 2 3-2 4 2 2 7H3Z" />
      <path d="m11 15 1 1.6 1-1.6v5h-2Z" fill="var(--color-raised)" />
    </>
  ),
};

export function NavGlyph({ icon, size = 24 }: { icon: NavIcon; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
    >
      <g data-nav-shape={icon}>{NAV_SHAPES[icon]}</g>
    </svg>
  );
}

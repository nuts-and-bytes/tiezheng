interface Props {
  size: number;
  /** 落章动画（打卡完成时） */
  animate?: boolean;
  /** 纯装饰时对读屏隐藏 */
  decorative?: boolean;
}

/** 品牌钢印。八角外框 + 向下落锤的 T 形切面，缩小后仍只有一个强轮廓。 */
export function Stamp({ size, animate = false, decorative = false }: Props) {
  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center ${animate ? 'animate-stamp-in' : ''}`}
      style={{
        width: size,
        height: size,
        transform: 'rotate(-6deg)',
        filter: `drop-shadow(0 0 ${Math.max(8, size * 0.28)}px rgba(255,92,31,.32))`,
      }}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : '铁证'}
      role={decorative ? undefined : 'img'}
    >
      <svg
        data-stamp-mark
        width={size}
        height={size}
        viewBox="0 0 96 96"
        fill="currentColor"
        className="text-iron"
        aria-hidden="true"
        focusable="false"
      >
        <path
          fillRule="evenodd"
          d="M25 4h46l21 21v46L71 92H25L4 71V25Zm3.7 9L13 28.7v38.6L28.7 83h38.6L83 67.3V28.7L67.3 13Z"
        />
        <path d="M23 27h50v13H56v17l10-7v15L48 78 30 65V50l10 7V40H23Z" />
        <path d="M42 44h12v22l-6 4.5-6-4.5Z" fill="var(--color-bg)" />
      </svg>
    </div>
  );
}

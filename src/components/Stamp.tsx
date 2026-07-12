interface Props {
  size: number;
  /** 落章动画（打卡完成时） */
  animate?: boolean;
  /** 纯装饰时对读屏隐藏 */
  decorative?: boolean;
}

/** 品牌钢印。打卡 = 盖钢印，这是整个产品的核心隐喻。
    尺寸取自 docs/design-cards/brand/tokens.html 的 .stamp（96px 基准），其余按比例缩放 */
export function Stamp({ size, animate = false, decorative = false }: Props) {
  const k = size / 96; // 96 是 design card 的基准尺寸
  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center ${animate ? 'animate-stamp-in' : ''}`}
      style={{
        width: size,
        height: size,
        border: `${3.5 * k}px solid var(--color-iron)`,
        borderRadius: 18 * k,
        transform: 'rotate(-6deg)',
        boxShadow: `0 0 ${34 * k}px rgba(255,92,31,.35), inset 0 0 ${18 * k}px rgba(255,92,31,.18)`,
      }}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : '铁证'}
      role={decorative ? undefined : 'img'}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          inset: 5 * k,
          border: `1px dashed rgba(255,92,31,.45)`,
          borderRadius: 12 * k,
        }}
      />
      <span className="leading-none font-black text-iron" style={{ fontSize: 52 * k }}>
        铁
      </span>
    </div>
  );
}

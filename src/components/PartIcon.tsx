import type { ReactNode } from 'react';
import { bodyPartInfo } from '../data/bodyParts';
import type { BodyPart } from '../lib/types';

/* 这七枚是记号，不是写生。
 *
 * 上一版逐字抄了 docs/design-cards/brand/icons.html：胸是一片盔甲加两条内曲线加一条中缝，
 * 四层细节全挤在 24 格里。可它真正出现的尺寸是 18–26px —— 24 格缩到 20px，相邻两笔的
 * 间距不足 1px，描边一粗就并成一坨墨。"丑"是这么来的，不是造型审美的问题：
 * 在 20px 上画写生，本来就画不下。
 *
 * 所以按尺寸倒推：20px 能承载的极限是三四笔、笔画间留白 ≥2px。每个部位只留一个
 * 最不可能认错的几何记号 —— 双拱（胸）/ 双同心圆顶（肩）/ 倒三角（背）/ 两条带膝的柱（腿）/
 * 哑铃（臂）/ 田字躯干（核心）/ 心电线（有氧）。
 *
 * 两条硬约束，都是被实测打出来的：
 * 一、七个形状两两不相似 —— 日历页上它们并排出现，认错一个就等于记错了练的部位。
 * 二、七个形状都不能撞上外部世界已有的强符号。第一版栽在这条上：肩画成"圆 + 斜柄"，
 *     渲染出来就是一枚放大镜；腿在髋上加了根出头的横梁，渲染出来就是希腊字母 π。
 *     我想画的是什么不重要，人一眼读出来的是什么才算数。
 *
 * 统一 viewBox 0 0 24 24 / fill none / stroke-width 2.1 / 圆头圆角
 */
const SHAPES: Record<BodyPart, ReactNode> = {
  // 两块胸肌并排：圆顶、平底、共用中缝（两条竖边叠在 x=12，正好画出胸沟）
  chest: (
    <>
      <path d="M3.6 19.4v-8.2a4.2 4.2 0 0 1 8.4 0v8.2Z" />
      <path d="M12 19.4v-8.2a4.2 4.2 0 0 1 8.4 0v8.2Z" />
    </>
  ),
  // 三角肌：两道同心的圆顶。
  // 上一版画的是"球 + 一条斜下去的手臂"，实测渲染出来就是一枚放大镜 —— 圆加一根斜柄
  // 在这个世界上只有一个含义，跟我想画的是什么无关。
  shoulder: (
    <>
      <path d="M3.4 18.6a8.6 8.6 0 0 1 17.2 0" />
      <path d="M8.6 18.6a3.4 3.4 0 0 1 6.8 0" />
    </>
  ),
  // 背阔肌的倒三角 + 脊柱
  back: (
    <>
      <path d="M3.8 4.8h16.4L12 20Z" />
      <path d="M12 5.6v6.2" />
    </>
  ),
  // 两条带膝的腿。上一版在顶上加了根髋横梁，两端一出头就成了希腊字母 π —— 拆掉
  leg: (
    <>
      <path d="M9.3 4v5.8L7.2 20" />
      <path d="M14.7 4v5.8L16.8 20" />
    </>
  ),
  // 七个部位里只有手臂没法用轮廓表达：它的特征是"弯起来"这个姿态，不是形状，
  // 而姿态在 20px 上画不出来 —— 上一版的屈臂线稿渲染出来是一枚认不出的勾。
  // 换掉锚点：哑铃。牺牲一点"全是身体部位"的同构，换回一眼认得出。
  arm: (
    <>
      <path d="M4 10.5v3M20 10.5v3" />
      <path d="M7.5 7.5v9M16.5 7.5v9" />
      <path d="M7.5 12h9" />
    </>
  ),
  // 田字躯干 —— 四格，不是六格：六格的横沟在 20px 下只剩不到 1px 的缝，必糊
  core: (
    <>
      <rect x="6.4" y="4" width="11.2" height="16" rx="2.4" />
      <path d="M12 4v16M6.4 12h11.2" />
    </>
  ),
  // 只留心电线 —— 上一版把它塞进一颗心里，两层线在 20px 下叠成一团
  cardio: <path d="M3 12.4h4l2.6-6.2 3.4 11 2.4-4.8h5.6" />,
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
      // 笔画少了就撑得起更粗的线。2.1 在 20px 上约合 1.75px —— 立得住，又没胖到吃掉留白
      strokeWidth={2.1}
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

/**
 * theme.css 的 token，转成 JS 能读的字符串。
 *
 * 为什么需要这个文件：Canvas（Chart.js、海报导出）和 SVG 的 stroke/fill 只认字符串，
 * 拿不到 CSS 类，也读不了编译期就被 Tailwind 消化掉的 @theme 变量。
 *
 * 为什么不是「各处自己抄一份」：抄过，抄错了，而且没人看得出来——
 * charts.tsx 一直用着 iOS 系统灰 #8e8e93，而 mute 是暖灰 #8b8b85。
 * 两个灰在暗底上肉眼几乎同色，「暖」这个基调就是从这种地方一点点漏光的。
 *
 * theme.css 仍是唯一真相源：src/lib/theme.test.ts 逐字比对两边，双向不许多也不许少。
 * 加 token 时先改 theme.css，再改这里——顺序反了测试会红。
 */
export const THEME = {
  bg: '#0a0a0b',
  raised: '#141416',
  card: '#1a1a1d',
  ink: '#f2f0eb',
  mute: '#8b8b85',
  iron: '#ff5c1f',
  amber: '#ffb340',
  line: 'rgba(255, 255, 255, 0.07)',
} as const;

export const FONT = {
  /** 只给纯数字用。Anton 的子集里没有中文字形，写中文会出豆腐块。 */
  display: "'Anton', 'Arial Narrow', 'Helvetica Neue Condensed', system-ui, sans-serif",
  body: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif",
} as const;

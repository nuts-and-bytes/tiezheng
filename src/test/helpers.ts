import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * 穿过 4 步首启引导，停在 `/log`。
 *
 * 引导页的四屏是**全部挂载 + translateX 位移**（不是条件渲染），非当前屏带 inert + aria-hidden。
 * Testing Library 的 getByRole 默认忽略 aria-hidden 子树，所以下面每一步拿到的都只会是当前屏的按钮。
 */
export async function completeOnboarding(user: UserEvent): Promise<void> {
  // 第 1 屏：品牌 —— 「开始」
  await user.click(await screen.findByRole('button', { name: '开始' }));
  // 第 2 屏：本地优先 —— 「继续」
  await user.click(await screen.findByRole('button', { name: '继续' }));
  // 第 3 屏：海报 —— 「继续」
  await user.click(await screen.findByRole('button', { name: '继续' }));
  // 第 4 屏：设周目标 —— 「开始第一次打卡」（这句文案必须保留，是 3 个 App 测试的锚点）
  await user.click(await screen.findByRole('button', { name: '开始第一次打卡' }));
}

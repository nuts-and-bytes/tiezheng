import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Onboarding } from './Onboarding';
import { db } from '../lib/db';
import { resetDb } from '../test/dbTestUtils';
import { completeOnboarding } from '../test/helpers';

beforeEach(async () => {
  await resetDb();
});

function renderOnboarding() {
  return render(
    <MemoryRouter>
      <Onboarding />
    </MemoryRouter>,
  );
}

/**
 * 四屏是「全部挂载 + translateX 位移」，非当前屏带 aria-hidden。
 * getByText 不理会 aria-hidden（隐藏屏的文字照样能拿到），所以下面一律用
 * **role 查询**（getByRole 默认跳过 aria-hidden 子树）来断言「当前屏是哪一屏」，
 * 否则断言会恒真、测试没有意义。
 * 当前屏是唯一可见的 role="group"，within(活动屏) 用来断言屏内的正文。
 */
function activeScreen(): HTMLElement {
  return screen.getByRole('group');
}

test('四屏能依次前进：品牌 → 怎么记 → 海报 → 周目标', async () => {
  const user = userEvent.setup();
  renderOnboarding();

  // 屏 1：品牌
  expect(screen.getByRole('heading', { name: '你练过的，都有铁证。' })).toBeInTheDocument();
  expect(activeScreen()).toHaveAccessibleName(expect.stringContaining('品牌'));

  // 屏 2：怎么记
  await user.click(screen.getByRole('button', { name: '开始' }));
  expect(screen.getByRole('heading', { name: '30 秒，盖下今天的印' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '你练过的，都有铁证。' })).not.toBeInTheDocument();

  // 屏 3：海报
  await user.click(screen.getByRole('button', { name: '继续' }));
  expect(screen.getByRole('heading', { name: '月底，领你的海报' })).toBeInTheDocument();

  // 屏 4：周目标
  await user.click(screen.getByRole('button', { name: '继续' }));
  expect(screen.getByRole('heading', { name: '每周想练几次？' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '开始第一次打卡' })).toBeInTheDocument();
});

test('屏 2 展示七个部位（各有图标）与三步打卡流程', async () => {
  const user = userEvent.setup();
  renderOnboarding();
  await user.click(screen.getByRole('button', { name: '开始' }));

  const s2 = activeScreen();
  for (const name of ['胸', '肩', '背', '腿', '手臂', '核心', '有氧']) {
    expect(within(s2).getByText(name)).toBeInTheDocument();
  }
  // 三步流程：选部位 → 记几组 → 盖钢印
  expect(within(s2).getByText('选部位')).toBeInTheDocument();
  expect(within(s2).getByText('记几组')).toBeInTheDocument();
  expect(within(s2).getByText('盖钢印')).toBeInTheDocument();
});

test('屏 3 介绍月度 / 年度海报导出，并声明全本地生成、照片不上传', async () => {
  const user = userEvent.setup();
  renderOnboarding();

  // 没走到屏 3 之前，海报这一屏不可访问（证明断言不是恒真的）
  expect(screen.queryByRole('heading', { name: '月底，领你的海报' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '开始' }));
  await user.click(screen.getByRole('button', { name: '继续' }));

  const s3 = activeScreen();
  expect(within(s3).getByRole('heading', { name: '月底，领你的海报' })).toBeInTheDocument();
  // 用户点名要的：月度 / 年度海报导出
  expect(within(s3).getByText(/月度/)).toBeInTheDocument();
  expect(within(s3).getByText(/年度/)).toBeInTheDocument();
  // 产品铁律 7：全本地、照片不上传
  expect(within(s3).getByText(/全本地生成/)).toBeInTheDocument();
  expect(within(s3).getByText(/照片不上传/)).toBeInTheDocument();
});

test('周目标默认是 4', async () => {
  const user = userEvent.setup();
  renderOnboarding();
  await user.click(screen.getByRole('button', { name: '开始' }));
  await user.click(screen.getByRole('button', { name: '继续' }));
  await user.click(screen.getByRole('button', { name: '继续' }));

  expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'false');
});

test('走完四屏落库 onboarded=true 与默认 weeklyGoal=4', async () => {
  const user = userEvent.setup();
  renderOnboarding();

  await completeOnboarding(user);

  const profile = await db.profile.get('me');
  expect(profile?.onboarded).toBe(true);
  expect(profile?.weeklyGoal).toBe(4);
});

test('改选周目标 5 后落库的是 5', async () => {
  const user = userEvent.setup();
  renderOnboarding();
  await user.click(screen.getByRole('button', { name: '开始' }));
  await user.click(screen.getByRole('button', { name: '继续' }));
  await user.click(screen.getByRole('button', { name: '继续' }));
  await user.click(screen.getByRole('button', { name: '5' }));
  await user.click(screen.getByRole('button', { name: '开始第一次打卡' }));

  const profile = await db.profile.get('me');
  expect(profile?.weeklyGoal).toBe(5);
  expect(profile?.onboarded).toBe(true);
});

test('「跳过」直接跳到最后一屏的周目标', async () => {
  const user = userEvent.setup();
  renderOnboarding();
  await user.click(screen.getByRole('button', { name: '开始' }));
  await user.click(screen.getByRole('button', { name: '跳过' }));

  expect(screen.getByRole('heading', { name: '每周想练几次？' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '开始第一次打卡' })).toBeInTheDocument();
});

test('可以回到上一屏', async () => {
  const user = userEvent.setup();
  renderOnboarding();
  await user.click(screen.getByRole('button', { name: '开始' }));
  expect(screen.getByRole('heading', { name: '30 秒，盖下今天的印' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '返回上一步' }));
  expect(screen.getByRole('heading', { name: '你练过的，都有铁证。' })).toBeInTheDocument();
});

test('连点 CTA 只落库一次（submittingRef 门闩）', async () => {
  const user = userEvent.setup();
  const spy = vi.spyOn(db.profile, 'put');
  renderOnboarding();
  await user.click(screen.getByRole('button', { name: '开始' }));
  await user.click(screen.getByRole('button', { name: '继续' }));
  await user.click(screen.getByRole('button', { name: '继续' }));

  const cta = screen.getByRole('button', { name: '开始第一次打卡' });
  await Promise.all([user.click(cta), user.click(cta), user.click(cta)]);

  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});

/* ── D10：垂直布局契约 ──────────────────────────────────────────────────
 * jsdom 不排版，量不出高度，所以断言的不是像素而是**能推导出布局的那条 class 链**。
 * 真机 390×844 上四屏内容全挤在顶部 1/4（屏 4 最空），根因是这条链断了一环：
 * 根容器只有 min-height → 高度「不确定」→ 中间 flex-1 区的高度也不确定 →
 * 轨道的 height:100% 解析成 auto → 四屏塌回内容高 → justify-center 无剩余空间可分 = 白写。
 * 下面每条断言各锁住链上的一环，缺一环就会退回「内容贴顶、下面一片空」。
 */

/** 根容器 = Onboarding 渲染出的第一个元素（MemoryRouter 不产生 DOM 节点）。 */
function rootEl(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement;
}

/** 轨道（做 translateX 的那层）与包着它的可伸缩视口。 */
function trackAndViewport() {
  const track = screen.getByRole('group').parentElement as HTMLElement;
  return { track, viewport: track.parentElement as HTMLElement };
}

test('D10 · 根容器把高度钉死在一个视口内（h-dvh，不是 min-h-dvh），并按列排布', () => {
  const { container } = renderOnboarding();
  const root = rootEl(container);

  // toHaveClass 按 class token 精确匹配：min-h-dvh 不满足它。别改成正则——
  // /(^|\s|-)h-dvh(\s|$)/ 这种写法会被开头的 `-` 放行 min-h-dvh，等于没约束。
  expect(root).toHaveClass('h-dvh', 'flex', 'flex-col');

  // min-height 让高度「不确定」，子层的 height:100% 会一路退化成 auto —— 这是 D10 的根因，
  // 也是最容易被「顺手改回来」的一行。钉死它。
  expect(root.classList.contains('min-h-dvh')).toBe(false);
});

test('D10 · 轨道区可伸缩可压缩，且轨道高度来自定位而非百分比继承', () => {
  renderOnboarding();
  const { track, viewport } = trackAndViewport();

  // flex-1 吃掉 header 与底栏之外的全部空间；min-h-0 允许它被压缩到内容高以下，
  // 否则内容一长，flex-1 区就被撑开、把底部 CTA 顶出安全区
  expect(viewport).toHaveClass('flex-1', 'min-h-0');

  // absolute inset-0：轨道高度由定位撑满 viewport，不依赖 height:100% 向上求解。
  // 父链上只要有一环高度不确定，height:100% 就退化成 auto —— 这正是 D10 的根因。
  expect(track).toHaveClass('absolute', 'inset-0');
});

/**
 * 「居中」和「可滚动」放在同一个盒子上会互相下毒，这是 flex 最阴的一个坑：
 * justify-content:center 在内容超高时把内容**两头都**推出滚动区，而 scrollTop 不能为负 ——
 * 顶部那截于是永久不可达。横屏 844×390 实测：屏 3（海报介绍，用户点名的那一屏）
 * 的标题落在 top:-60px，怎么滚都回不去。讽刺的是加 overflow-y-auto 之前，
 * 内容虽然被切在折叠下，但**滚一下就能看全**。
 *
 * safe center 就是为这个造的：内容装得下就居中，装不下就退回顶对齐（CSS Box Alignment §4.1）。
 * jsdom 没有排版引擎，量不出 scrollTop，所以这里锁 class 契约。
 */
test('D10 · 四屏撑满轨道并居中，但居中必须是 safe 的（死心的 justify-center 会让溢出内容顶部永久不可达）', () => {
  renderOnboarding();
  const { track } = trackAndViewport();
  const panels = Array.from(track.children) as HTMLElement[];

  expect(panels).toHaveLength(4);
  for (const panel of panels) {
    expect(panel).toHaveClass('h-full', 'flex-col');

    // 矮机型（横屏）上内容超高：改为屏内滚动，而不是被 h-dvh 硬切掉
    expect(panel).toHaveClass('overflow-y-auto');
    // …但正因为它是滚动容器，居中就必须是 safe 的
    expect(panel).toHaveClass('justify-center-safe');

    // classList 是精确 token 匹配。别写成 /\bjustify-center\b/ ——
    // `-` 是非单词字符，那个 \b 会在 justify-center-safe 里面成立，测试当场变瞎。
    expect(panel.classList.contains('justify-center')).toBe(false);
  }
});

test('D10 · 主 CTA 待在根容器最底部、不参与伸缩，底部安全区由根 padding 兜住', () => {
  const { container } = renderOnboarding();
  const root = rootEl(container);
  const bottomBar = screen.getByRole('button', { name: '开始' }).parentElement as HTMLElement;

  expect(bottomBar).toHaveClass('shrink-0');
  expect(root.lastElementChild).toBe(bottomBar); // 贴底：它是根容器的最后一个孩子
  expect(root.className).toContain('safe-area-inset-bottom');
});

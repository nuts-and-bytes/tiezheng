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

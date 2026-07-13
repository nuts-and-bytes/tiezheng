import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { savePhoto } from '../repos/photoRepo';
import { resetDb } from '../test/dbTestUtils';
import { PhotoTimeline } from './PhotoTimeline';

beforeEach(async () => {
  await resetDb();
});

function seed(date: string) {
  return savePhoto(date, new Blob(['x'], { type: 'image/jpeg' }));
}

function renderTimeline() {
  return render(
    <MemoryRouter>
      <PhotoTimeline />
    </MemoryRouter>,
  );
}

test('没有照片时整块不渲染（不留一个空壳区块）', async () => {
  const { container } = renderTimeline();
  expect(container).toBeEmptyDOMElement();
});

/**
 * 用户对整个 app 的原话是「一块一块的」。改版把全站的实心卡片换成了蚀刻线（.etch）+
 * 小字号区块标题，唯独这块漏了 —— 它是最后一个 `rounded-2xl bg-card`，孤零零地
 * 浮在数据页底部，像贴上去的补丁。
 *
 * 设计规则是明确的：**只有实物才配浮起**（照片、海报有 bg-raised 表面）。
 * 「体型时间轴」是一个区块，不是一件实物。区块靠蚀刻线划界。
 */
test('不是一块卡片：没有实心卡背景', async () => {
  await seed('2026-06-20');
  const { container } = renderTimeline();

  await screen.findByRole('img', { name: /2026-06-20/ });
  expect(container.querySelector('.bg-card')).toBeNull();
  expect(container.querySelector('.rounded-2xl')).toBeNull();
});

/** 区块标题全站一种写法（11px / 2px 字距 / uppercase），PhotoCard 也是这么写的 */
test('区块标题说全站同一种话', async () => {
  await seed('2026-06-20');
  renderTimeline();

  const h = await screen.findByText('体型时间轴');
  expect(h.className).toContain('tracking-[2px]');
  expect(h.className).toContain('uppercase');
});

/**
 * 照片时间轴的全部意义是**对比**——看到三个月前那张，第一反应就是点开看大图。
 * 原本缩略图是死的 <img>，点哪都没反应，整条时间轴到此为止。
 * 当天的大图和「重拍/删除」本来就都在日详情页（PhotoCard），直接把它当归宿。
 */
test('缩略图点得开：通往那天的日详情', async () => {
  await seed('2026-06-20');
  renderTimeline();

  // MemoryRouter 下 href 不带 # 前缀（那是线上 HashRouter 的事），这里断言的是路由路径本身
  const link = await screen.findByRole('link', { name: /2026-06-20/ });
  expect(link).toHaveAttribute('href', '/day/2026-06-20');
});

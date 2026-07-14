import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/* setNeedRefresh 必须真的驱动状态，否则「点关闭就消失」测的是假的：
   给个 vi.fn() 当 setter，组件永远不会重渲染，断言就成了自欺。 */
const h = vi.hoisted(() => ({
  updateServiceWorker: vi.fn(),
  initial: { needRefresh: true },
}));

vi.mock('virtual:pwa-register/react', async () => {
  const { useState } = await import('react');
  return {
    useRegisterSW: () => {
      const [needRefresh, setNeedRefresh] = useState(h.initial.needRefresh);
      return {
        needRefresh: [needRefresh, setNeedRefresh] as const,
        offlineReady: [false, () => {}] as const,
        updateServiceWorker: h.updateServiceWorker,
      };
    },
  };
});

const { UpdateToast } = await import('./UpdateToast');

beforeEach(() => {
  h.initial.needRefresh = true;
  h.updateServiceWorker.mockClear();
});

describe('UpdateToast', () => {
  test('没有新版本时不渲染', () => {
    h.initial.needRefresh = false;
    const { container } = render(<UpdateToast />);
    expect(container).toBeEmptyDOMElement();
  });

  test('点提示主体触发更新', async () => {
    render(<UpdateToast />);
    await userEvent.click(screen.getByRole('button', { name: /点击更新/ }));
    expect(h.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  /* 之前只解构了 needRefresh 的 [0]，setter 被丢掉，于是让这条提示消失的唯一办法
     是接受更新。更新有代价——重载页面，当前填了一半的组就没了。用户必须能拒绝。 */
  test('有关闭按钮，点了就消失，且不会顺手把版本更新了', async () => {
    const { container } = render(<UpdateToast />);
    await userEvent.click(screen.getByRole('button', { name: '关闭' }));

    expect(container).toBeEmptyDOMElement();
    expect(h.updateServiceWorker).not.toHaveBeenCalled();
  });

  /* 原本 fixed 在顶部居中（safe-area + 52px），本意是躲开各页 header，
     实际躲进了「顶部控件带」：数据页的周/月/年/全部、海报页的月度/年度都在那条带上，
     被胶囊盖住后根本点不到（本地验收时我只能靠 JS 才点到「年度」）。
     顶部没有安全落点，底部才有——TabBar 之上是空的。
     jsdom 量不出遮挡，只能钉住定位契约：不许再回顶部。 */
  test('浮在底部而不是顶部——顶部那条带上全是控件', () => {
    render(<UpdateToast />);
    const cls = screen.getByRole('status').className;
    expect(cls).toMatch(/\bbottom-\[/);
    expect(cls).not.toMatch(/\btop-\[/);
  });
});

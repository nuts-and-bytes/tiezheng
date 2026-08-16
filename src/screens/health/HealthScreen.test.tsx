import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation, useNavigationType } from 'react-router-dom';
import { db } from '../../lib/db';
import { resetDb } from '../../test/dbTestUtils';
import { nutritionPlanRow } from '../../test/nutritionFixtures';
import { HealthScreen } from './HealthScreen';

class TestRequest {
  url: string;
  signal: AbortSignal;
  method: string;
  headers: Headers;

  constructor(input: string | URL, init: RequestInit = {}) {
    this.url = String(input);
    this.signal = init.signal ?? new AbortController().signal;
    this.method = init.method ?? 'GET';
    this.headers = new Headers(init.headers);
  }
}

function RouteProbe() {
  const location = useLocation();
  const historyAction = useNavigationType();
  return <h1>{`今日页探针; ${location.pathname}; ${historyAction}`}</h1>;
}

beforeEach(async () => {
  vi.stubGlobal('Request', TestRequest);
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function renderHealth() {
  const router = createMemoryRouter(
    [
      { path: '/health', element: <HealthScreen /> },
      { path: '/', element: <RouteProbe /> },
    ],
    { initialEntries: ['/health'] },
  );

  render(<RouterProvider router={router} />);
  return { router };
}

test('健康计划位于全屏路由，保留 eyebrow/锻造表面且返回固定 replace 到今日页', async () => {
  const user = userEvent.setup();
  const { router } = renderHealth();

  expect(screen.getByRole('heading', { name: '健康' })).toBeInTheDocument();
  expect(screen.getByText('DAILY NUTRITION')).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: '健康计划' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '健康计划' }).closest('.forged-surface')).not.toBeNull();
  expect(document.querySelector('.etch')).not.toBeNull();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '返回今日页' }));

  expect(await screen.findByRole('heading', { name: '今日页探针; /; REPLACE' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');
  expect(router.state.historyAction).toBe('REPLACE');
});

test('计划 live query 加载时不闪现新计划提交表单', async () => {
  renderHealth();
  expect(screen.getByRole('status', { name: '正在读取健康计划' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存健康计划' })).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: '健康计划' })).toBeInTheDocument();
});

test('current kill switch 压过历史 active plan，整页只显示纯记录态', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  await db.nutritionPlans.put(nutritionPlanRow());
  renderHealth();

  expect(await screen.findByText('当前状态：仅记录饮食')).toBeInTheDocument();
  expect(screen.queryByText(/蛋白质建议：/)).not.toBeInTheDocument();
  expect(screen.queryByText(/热量建议：/)).not.toBeInTheDocument();
  expect(screen.queryByText(/当前目标按/)).not.toBeInTheDocument();
  expect(screen.queryByText(/ISSN/)).not.toBeInTheDocument();
  expect(screen.queryByText(/NASEM/)).not.toBeInTheDocument();
});

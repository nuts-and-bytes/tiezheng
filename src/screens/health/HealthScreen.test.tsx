import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation, useNavigationType } from 'react-router-dom';
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
  return <output>{`今日页探针; ${location.pathname}; ${historyAction}`}</output>;
}

beforeEach(() => {
  vi.stubGlobal('Request', TestRequest);
});

test('健康页没有底栏，返回时 replace 到今日页', async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter(
    [
      { path: '/health', element: <HealthScreen /> },
      { path: '/', element: <RouteProbe /> },
    ],
    { initialEntries: ['/health'] },
  );

  render(<RouterProvider router={router} />);

  expect(screen.getByRole('heading', { name: '健康' })).toBeInTheDocument();
  expect(screen.getByText('记录今天吃了什么')).toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '返回今日页' }));

  expect(await screen.findByText('今日页探针; /; REPLACE')).toBeInTheDocument();
});

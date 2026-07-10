import { NavLink } from 'react-router-dom';

const TABS = [
  {
    to: '/',
    label: '今日',
    d: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z',
  },
  {
    to: '/calendar',
    label: '日历',
    d: 'M7 2v3m10-3v3M3.5 9h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Z',
  },
  {
    to: '/stats',
    label: '数据',
    d: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  },
  {
    to: '/profile',
    label: '我的',
    d: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  },
];

export function TabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-md pb-[env(safe-area-inset-bottom)]">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                isActive ? 'text-iron' : 'text-mute'
              }`
            }
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={tab.d} />
            </svg>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

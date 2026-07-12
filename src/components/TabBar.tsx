import { NavLink } from 'react-router-dom';
import { NavGlyph, type NavIcon } from './PartIcon';

const TABS: { to: string; label: string; icon: NavIcon }[] = [
  { to: '/', label: '今日', icon: 'today' },
  { to: '/calendar', label: '日历', icon: 'calendar' },
  { to: '/stats', label: '数据', icon: 'stats' },
  { to: '/profile', label: '我的', icon: 'profile' },
];

/** 底部导航（tokens.html / icons.html）：26px 字形 + 11px 小字，选中态是全屏唯一的 iron 之一 */
export function TabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-raised/90 backdrop-blur">
      <div className="mx-auto flex max-w-md pb-[env(safe-area-inset-bottom)]">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-[3px] pt-3 pb-2 text-[11px] transition-colors ${
                isActive ? 'font-semibold text-iron' : 'text-mute'
              }`
            }
          >
            <NavGlyph icon={tab.icon} size={26} />
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

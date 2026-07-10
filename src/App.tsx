import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabBar } from './components/TabBar';
import { CalendarScreen } from './screens/calendar/CalendarScreen';
import { DayDetailScreen } from './screens/calendar/DayDetailScreen';
import { LogFlow } from './screens/log/LogFlow';
import { ProfileScreen } from './screens/profile/ProfileScreen';
import { StatsScreen } from './screens/stats/StatsScreen';
import { TodayScreen } from './screens/today/TodayScreen';
import { Onboarding } from './screens/Onboarding';
import { getProfile } from './repos/profileRepo';

function TabLayout() {
  return (
    <div className="mx-auto min-h-dvh max-w-md pb-24 pt-[env(safe-area-inset-top)]">
      <Outlet />
      <TabBar />
    </div>
  );
}

/** 引导门：置于 Routes 外统一生效，未引导时任何路由（含 /log、/day/:date）都进不去 */
function OnboardingGate() {
  const profile = useLiveQuery(() => getProfile(), []);
  if (!profile) return null;
  if (!profile.onboarded) return <Onboarding />;
  return (
    <Routes>
      <Route path="/log" element={<LogFlow />} />
      <Route path="/day/:date" element={<DayDetailScreen />} />
      <Route element={<TabLayout />}>
        <Route path="/" element={<TodayScreen />} />
        <Route path="/calendar" element={<CalendarScreen />} />
        <Route path="/stats" element={<StatsScreen />} />
        <Route path="/profile" element={<ProfileScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <OnboardingGate />
      </HashRouter>
    </ErrorBoundary>
  );
}

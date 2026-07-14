import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InstallHint } from './components/InstallHint';
import { UpdateToast } from './components/UpdateToast';
import { TabBar } from './components/TabBar';
import { CalendarScreen } from './screens/calendar/CalendarScreen';
import { DayDetailScreen } from './screens/calendar/DayDetailScreen';
import { LogFlow } from './screens/log/LogFlow';
import { PosterScreen } from './screens/poster/PosterScreen';
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

/**
 * 引导门：置于 Routes 外统一生效，未引导时任何路由（含 /log、/day/:date）都进不去。
 *
 * InstallHint 也归它管，而不是挂在 App 顶层无条件渲染 —— 那条 fixed / z-40 的浮条钉在
 * 底部安全区 +80px，正好压在引导页的 CTA 上：iPhone Safari 第一次打开，用户还没看懂
 * 这 app 是什么，就先被催「添加到主屏幕」。催安装的时机是他决定留下来之后。
 */
function OnboardingGate() {
  const profile = useLiveQuery(() => getProfile(), []);
  if (!profile) return null;
  if (!profile.onboarded) return <Onboarding />;
  return (
    <>
      <InstallHint />
      <Routes>
        <Route path="/log" element={<LogFlow />} />
        <Route path="/day/:date" element={<DayDetailScreen />} />
        <Route path="/poster" element={<PosterScreen />} />
        <Route element={<TabLayout />}>
          <Route path="/" element={<TodayScreen />} />
          <Route path="/calendar" element={<CalendarScreen />} />
          <Route path="/stats" element={<StatsScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      {/* 全屏噪点：锻造质感的来源，pointer-events:none 不挡交互 */}
      <div className="grain" aria-hidden />
      <UpdateToast />
      <HashRouter>
        <OnboardingGate />
      </HashRouter>
    </ErrorBoundary>
  );
}

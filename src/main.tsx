import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initAnalytics } from './lib/analytics';
import { log } from './lib/logger';
import { seedPresets } from './repos/exerciseRepo';
import { seedPresetFoods } from './repos/foodRepo';
import './styles/theme.css';

// 没配 VITE_UMAMI_WEBSITE_ID 就是个空操作 —— dev 和测试里零网络请求
initAnalytics();

window.addEventListener('error', (e) => log(`window.error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => log(`unhandledrejection: ${String(e.reason)}`));

Promise.all([seedPresets(), seedPresetFoods()]).catch((error) =>
  log(`seedPresets/seedPresetFoods: ${String(error)}`),
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { log } from './lib/logger';
import { seedPresets } from './repos/exerciseRepo';
import './styles/theme.css';

window.addEventListener('error', (e) => log(`window.error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => log(`unhandledrejection: ${String(e.reason)}`));

seedPresets().catch((e) => log(`seedPresets: ${String(e)}`));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

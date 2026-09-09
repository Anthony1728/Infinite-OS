import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { useUiTheme } from './theme/uiTheme';
import { initThemeStyles } from './theme/styles';

// Mount the active UI theme's stylesheet (classic or modern) before render.
initThemeStyles(useUiTheme.getState().theme);

// Hand off from the pre-React boot splash in index.html: fade it out on first
// paint so the logo moment flows straight into the app (same bg, same mark).
requestAnimationFrame(() => {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  splash.classList.add('done');
  setTimeout(() => splash.remove(), 400);
});

window.addEventListener('error', (e) => {
  console.error('[renderer] Uncaught error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] Unhandled promise rejection:', e.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

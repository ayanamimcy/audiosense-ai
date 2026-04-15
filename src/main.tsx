import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Recover from stale chunk loads (deploy skew, PWA cache mismatch, Workbox update).
// When a dynamic import fails, reloading the page fetches fresh HTML with the new
// chunk hashes. Guard against reload loops: if this fires again within a short
// window, the underlying issue is likely network/offline — let the route error
// boundary take over instead of spinning on reloads.
const RELOAD_FLAG_KEY = 'audiosense:chunk-reload-at';
const RELOAD_COOLDOWN_MS = 10_000;

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  try {
    const now = Date.now();
    const lastReload = Number(sessionStorage.getItem(RELOAD_FLAG_KEY) || '0');
    if (!Number.isFinite(lastReload) || now - lastReload > RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(RELOAD_FLAG_KEY, String(now));
      window.location.reload();
    }
  } catch {
    // sessionStorage may be unavailable (private mode, sandbox). Fall back
    // to a plain reload — worst case the ErrorBoundary below handles it.
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

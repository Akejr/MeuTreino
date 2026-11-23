import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initStorage } from './lib/storage';
import { initSync, onSynced } from './lib/sync';
import { autoPauseStale, ensureTraining } from './training/actions';
import './styles.css';

// Sem zoom: o iOS ignora user-scalable=no, então bloqueamos o gesto de pinça aqui.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

// Carrega/recupera os dados (localStorage + IndexedDB) antes de renderizar.
initStorage().finally(() => {
  ensureTraining();
  onSynced(() => ensureTraining());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && autoPauseStale());
  initSync();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
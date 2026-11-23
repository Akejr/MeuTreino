/**
 * Versão nova do app. O service worker baixa e ativa a versão nova sozinho, mas no iPhone o app aberto
 * pela tela de início continua rodando o código antigo até ser fechado de vez. Aqui o app procura
 * atualização ao abrir, ao voltar para ele, quando a internet volta e a cada 30 min, e troca de versão:
 * - sozinho, logo depois de abrir ou voltar ao app, ou quando sai dele, se não houver treino em andamento;
 * - durante o treino, só quando ele tocar em "Atualizar" (as séries confirmadas já estão salvas).
 */
import { useSyncExternalStore } from 'react';
import { activeSession } from '../training/schedule';
import { getData } from './storage';

let pronta = false;
let abertoEm = Date.now();
const listeners = new Set<() => void>();

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pronta,
  );
}

export const applyUpdate = () => window.location.reload();

const emTreino = () => !!activeSession(getData());
const ocupado = () => {
  const el = document.activeElement;
  return !!el?.matches('input, textarea, select') || !!document.querySelector('.sheet, .dialog');
};

function tentar() {
  if (!pronta || emTreino()) return;
  if (document.visibilityState === 'hidden') return applyUpdate();
  if (Date.now() - abertoEm < 10_000 && !ocupado()) applyUpdate();
}

function marcar() {
  if (pronta) return;
  pronta = true;
  listeners.forEach((l) => l());
  tentar();
}

export function initUpdates() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  let tinha = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Primeira instalação: o código da página já é o atual.
    if (!tinha) {
      tinha = true;
      return;
    }
    marcar();
  });

  const registrar = () =>
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Versão nova ativada (substituindo uma anterior): o código desta página ficou velho.
        reg.addEventListener('updatefound', () => {
          const nova = reg.installing;
          if (!nova || !reg.active) return;
          nova.addEventListener('statechange', () => nova.state === 'activated' && marcar());
        });
        const procurar = () => navigator.onLine && reg.update().catch(() => {});
        setInterval(procurar, 30 * 60 * 1000);
        window.addEventListener('online', procurar);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            abertoEm = Date.now();
            procurar();
          }
          tentar();
        });
      })
      .catch(() => {});
  if (document.readyState === 'complete') registrar();
  else window.addEventListener('load', registrar);
}

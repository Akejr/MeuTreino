/** Qual sessão de treino está na tela (fora o treino ativo, que sempre aparece). */
import { useSyncExternalStore } from 'react';

let viewing: string | null = null;
const listeners = new Set<() => void>();

export function showSession(id: string | null) {
  viewing = id;
  listeners.forEach((l) => l());
}

export function useViewingSession(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => viewing,
  );
}

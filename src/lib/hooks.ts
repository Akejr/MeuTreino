import { useEffect, useState } from 'react';

export function useOnline(): boolean {
  const [on, setOn] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return on;
}

/** Preferência de tela guardada só neste aparelho (ex.: cartão minimizado). Fica como ele deixou. */
export function useLocalFlag(key: string, initial = false): [boolean, (v: boolean) => void] {
  const k = `meutreino:ui:${key}`;
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(k);
      return s == null ? initial : s === '1';
    } catch {
      return initial;
    }
  });
  const set = (n: boolean) => {
    setV(n);
    try {
      localStorage.setItem(k, n ? '1' : '0');
    } catch {
      /* sem espaço: vale só nesta tela */
    }
  };
  return [v, set];
}

/** Re-renderiza a cada `ms` enquanto `active`. */
export function useNow(ms = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}

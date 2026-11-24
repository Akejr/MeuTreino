/**
 * Arrastar para reordenar uma lista vertical, com o dedo (eventos de ponteiro, funcionam no iPhone).
 * O item segue o dedo, os outros abrem espaço, e perto das bordas a tela rola sozinha.
 * Só a alça inicia o arrasto (touch-action: none nela), então rolar a tela continua normal.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';

const GAP = 8; // espaço entre os itens (igual ao CSS de .slot-list)
const BORDA = 90;

export interface Drag {
  id: string;
  from: number;
  target: number;
  dy: number;
  h: number;
}

interface Estado extends Drag {
  startY: number;
  startScroll: number;
  lastY: number;
  centers: number[];
  raf: number;
}

export function useDragReorder(ids: string[], onDrop: (ids: string[]) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const st = useRef<Estado | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const idsRef = useRef(ids);
  idsRef.current = ids;

  useEffect(
    () => () => {
      cancelAnimationFrame(st.current?.raf ?? 0);
      document.body.classList.remove('dragging-list');
    },
    [],
  );

  const publish = (s: Estado) => setDrag({ id: s.id, from: s.from, target: s.target, dy: s.dy, h: s.h });

  function compute(clientY: number) {
    const s = st.current;
    if (!s) return;
    s.dy = clientY + window.scrollY - (s.startY + s.startScroll);
    const centro = s.centers[s.from] + s.dy;
    s.target = s.centers.filter((c, i) => i !== s.from && c < centro).length;
    publish(s);
  }

  function tick() {
    const s = st.current;
    if (!s) return;
    const y = s.lastY;
    const baixo = window.innerHeight - BORDA;
    const v = y < BORDA ? -Math.ceil((BORDA - y) / 6) : y > baixo ? Math.ceil((y - baixo) / 6) : 0;
    if (v) {
      window.scrollBy(0, v);
      compute(y);
    }
    s.raf = requestAnimationFrame(tick);
  }

  function finish(commit: boolean) {
    const s = st.current;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    st.current = null;
    document.body.classList.remove('dragging-list');
    setDrag(null);
    if (commit && s.target !== s.from) {
      const lista = idsRef.current.filter((x) => x !== s.id);
      lista.splice(s.target, 0, s.id);
      onDrop(lista);
    }
  }

  function handleProps(id: string) {
    return {
      onPointerDown: (e: RPointerEvent<HTMLElement>) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const lista = idsRef.current;
        const from = lista.indexOf(id);
        const el = els.current.get(id);
        if (from < 0 || !el) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const centers = lista.map((x) => {
          const r = els.current.get(x)?.getBoundingClientRect();
          return r ? r.top + window.scrollY + r.height / 2 : 0;
        });
        const s: Estado = { id, from, target: from, dy: 0, h: el.getBoundingClientRect().height + GAP, startY: e.clientY, startScroll: window.scrollY, lastY: e.clientY, centers, raf: 0 };
        st.current = s;
        document.body.classList.add('dragging-list');
        navigator.vibrate?.(10);
        publish(s);
        s.raf = requestAnimationFrame(tick);
      },
      onPointerMove: (e: RPointerEvent<HTMLElement>) => {
        if (!st.current) return;
        st.current.lastY = e.clientY;
        compute(e.clientY);
      },
      onPointerUp: () => finish(true),
      onPointerCancel: () => finish(false),
    };
  }

  /** Deslocamento de cada item durante o arrasto. */
  function styleFor(id: string): CSSProperties | undefined {
    if (!drag) return undefined;
    if (id === drag.id) return { transform: `translateY(${drag.dy}px)` };
    const i = idsRef.current.indexOf(id);
    if (i < 0) return undefined;
    if (drag.from < drag.target && i > drag.from && i <= drag.target) return { transform: `translateY(${-drag.h}px)` };
    if (drag.target < drag.from && i >= drag.target && i < drag.from) return { transform: `translateY(${drag.h}px)` };
    return { transform: 'translateY(0)' };
  }

  const register = (id: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  };

  return { drag, register, handleProps, styleFor };
}

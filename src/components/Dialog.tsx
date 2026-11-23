/** Confirmações e avisos do próprio app (substituem confirm() e alert() do navegador). */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

interface Req {
  title: string;
  message?: string;
  confirm: string;
  cancel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

let current: Req | null = null;
let toastMsg: { text: string; id: number } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Pergunta com dois botões. Resolve true se confirmar. */
export function ask(opts: { title: string; message?: string; confirm?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    current?.resolve(false);
    current = { confirm: 'Confirmar', cancel: 'Cancelar', ...opts, resolve };
    emit();
  });
}

/** Aviso com um botão. */
export function notify(title: string, message?: string): Promise<void> {
  return new Promise((resolve) => {
    current?.resolve(false);
    current = { title, message, confirm: 'OK', resolve: () => resolve() };
    emit();
  });
}

/** Mensagem curta que some sozinha. */
export function toast(text: string) {
  toastMsg = { text, id: Date.now() };
  emit();
}

function close(ok: boolean) {
  const r = current;
  current = null;
  emit();
  r?.resolve(ok);
}

export function DialogHost() {
  const req = useSyncExternalStore(subscribe, () => current);
  const t = useSyncExternalStore(subscribe, () => toastMsg);
  const [visivel, setVisivel] = useState<typeof t>(null);

  useEffect(() => {
    if (!t) return;
    setVisivel(t);
    const h = setTimeout(() => setVisivel(null), 2600);
    return () => clearTimeout(h);
  }, [t]);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  return createPortal(
    <>
      {req && (
        <div className="dialog-backdrop" onClick={() => close(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">{req.title}</div>
            {req.message && <p className="dialog-msg">{req.message}</p>}
            <div className="dialog-actions">
              {req.cancel && (
                <button className="btn grow" onClick={() => close(false)}>
                  {req.cancel}
                </button>
              )}
              <button className={`btn primary grow ${req.danger ? 'danger-solid' : ''}`} onClick={() => close(true)} autoFocus>
                {req.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
      {visivel && (
        <div key={visivel.id} className="toast" role="status">
          {visivel.text}
        </div>
      )}
    </>,
    document.body,
  );
}

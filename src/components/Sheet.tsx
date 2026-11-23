import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from './Icons';

// Trava a página atrás do painel. No iOS só overflow:hidden não basta: ao abrir o teclado
// o Safari rola a página inteira. Fixar o body impede isso; um contador cobre painéis abertos juntos.
let locks = 0;
let savedY = 0;

function lockBody() {
  if (locks++ > 0) return;
  savedY = window.scrollY;
  const b = document.body.style;
  b.position = 'fixed';
  b.top = `-${savedY}px`;
  b.left = '0';
  b.right = '0';
  b.overflow = 'hidden';
}

function unlockBody() {
  if (--locks > 0) return;
  const b = document.body.style;
  b.position = '';
  b.top = '';
  b.left = '';
  b.right = '';
  b.overflow = '';
  window.scrollTo(0, savedY);
}

/**
 * Acompanha a área visível da tela (sem o teclado). O painel fica sempre dentro dela,
 * então o teclado não empurra o painel para fora da tela.
 */
function useVisualViewport(ref: RefObject<HTMLDivElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!active || !vv || !el) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.height = `${vv.height}px`;
        el.style.top = `${vv.offsetTop}px`;
        el.classList.toggle('kb', window.innerHeight - vv.height > 120);
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [ref, active]);
}

/** Painel que sobe de baixo (bottom sheet). */
export default function Sheet({
  open,
  onClose,
  title,
  children,
  full,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  full?: boolean;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  useVisualViewport(backdrop, open);

  useEffect(() => {
    if (!open) return;
    lockBody();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      unlockBody();
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div ref={backdrop} className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet ${full ? 'full' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sheet-grip" />
        {title !== undefined && (
          <div className="sheet-head">
            <div className="sheet-title">{title}</div>
            <button className="icon-btn soft" aria-label="Fechar" onClick={onClose}>
              <IconClose />
            </button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

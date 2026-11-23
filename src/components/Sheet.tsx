import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from './Icons';

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
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
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

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Dialog rendered in a portal on <body>, so it is positioned against the
 * viewport regardless of any animated / filtered ancestor, and the page
 * behind it cannot scroll while it is open.
 */
export default function Modal({ children, onClose, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body,
  );
}

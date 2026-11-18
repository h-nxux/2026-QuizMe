import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  // Feedback sheets in the player shouldn't close on backdrop taps.
  dismissible?: boolean;
  className?: string;
};

export function Sheet({ open, onClose, title, children, dismissible = true, className }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const focusable = panel.current?.querySelector<HTMLElement>('[data-autofocus], button, input, textarea, select');
    focusable?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('sheet-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, dismissible]);

  if (!open) return null;
  return createPortal(
    <div className="sheet-root">
      <div className="sheet-backdrop" onClick={dismissible ? onClose : undefined} />
      <div ref={panel} className={`sheet ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grip" aria-hidden="true" />
        {title && <h2 className="sheet-title">{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

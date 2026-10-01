import { type ReactNode, useEffect } from 'react';
import { useI18n } from '../../../lib/i18n';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title: string;
  children: ReactNode;
  /** Oculta el botón de cierre (usado cuando el modal no puede descartarse sin responder). */
  hideCloseButton?: boolean;
  /** Modal no descartable: sin botón de cierre ni cierre por Escape o click en el fondo. */
  dismissible?: boolean;
}

export function Modal({ open, onClose, title, children, hideCloseButton = false, dismissible = true }: Readonly<ModalProps>) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissible]);

  if (!open) return null;
  const showCloseButton = !hideCloseButton && dismissible;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={dismissible ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#fdfdfe] shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex items-start justify-between gap-4">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          )}
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

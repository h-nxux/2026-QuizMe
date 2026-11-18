import { useSyncExternalStore } from 'react';

type Toast = { id: number; text: string; tone: 'info' | 'error' | 'good'; action?: { label: string; run: () => void } };

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function toast(text: string, opts: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}) {
  const t: Toast = { id: (seq += 1), text, tone: opts.tone ?? 'info', action: opts.action };
  toasts = [...toasts.slice(-2), t];
  emit();
  setTimeout(() => dismiss(t.id), opts.ms ?? (opts.action ? 5000 : 2800));
}

function dismiss(id: number) {
  toasts = toasts.filter(t => t.id !== id);
  emit();
}

export function ToastHost() {
  const list = useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

import { useToasts, removeToast } from '../hooks/useNotifications';

const TYPE_STYLES = {
  info: 'bg-accent/20 border-accent/40 text-accent-light',
  success: 'bg-green/20 border-green/40 text-green',
  warning: 'bg-yellow/20 border-yellow/40 text-yellow',
  strong: 'bg-green/30 border-green text-green',
} as const;

export default function ToastContainer() {
  const toasts = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-96 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm ${TYPE_STYLES[t.type]} animate-slide-in-right`}
          style={{ animation: 'slideInRight 0.3s ease-out' }}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{t.title}</p>
              {t.body && <p className="text-xs opacity-80 mt-0.5">{t.body}</p>}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="text-current opacity-60 hover:opacity-100 cursor-pointer shrink-0"
              aria-label="Bezárás"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

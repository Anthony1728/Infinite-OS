import { useNotificationStore } from '../../stores/notifications';

export function ToastContainer() {
  const toasts = useNotificationStore((s) => s.toasts);
  const removeToast = useNotificationStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  const icons: Record<string, string> = {
    success: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    error: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z',
    info: 'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z',
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  };

  const colors: Record<string, string> = {
    success: 'border-brandGreen/30 bg-brandGreen/10',
    error: 'border-brandRed/30 bg-brandRed/10',
    info: 'border-indigo-500/30 bg-indigo-500/10',
    warning: 'border-brandOrange/30 bg-brandOrange/10',
  };

  const iconColors: Record<string, string> = {
    success: 'text-brandGreen',
    error: 'text-brandRed',
    info: 'text-indigo-400',
    warning: 'text-brandOrange',
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`animate-slide-left glass-panel rounded-xl p-3 border ${colors[toast.type]} shadow-2xl cursor-pointer`}
          onClick={() => removeToast(toast.id)}
        >
          <div className="flex items-start gap-3">
            <svg className={`w-4 h-4 mt-0.5 flex-shrink-0 ${iconColors[toast.type]}`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={icons[toast.type]} />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-textMain">{toast.title}</div>
              {toast.message && <div className="text-xs text-textMuted mt-0.5">{toast.message}</div>}
            </div>
            <button className="text-textMuted hover:text-textMain transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}


import { useLibrary } from '../state/library';

export function Toasts() {
  const { toasts, dismissToast } = useLibrary();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast toast--' + t.kind}>
          <span>{t.text}</span>
          <button type="button" className="icon-btn" aria-label="Fermer ce message" onClick={() => dismissToast(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

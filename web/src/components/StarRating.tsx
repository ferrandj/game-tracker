import { useRef } from 'react';
import { stars } from '../lib/games';

const fill = (rating: number | null, star: number) => Math.max(0, Math.min(2, (rating ?? 0) - (star - 1) * 2)) * 50;

/** 5 stars in half steps; stored as 1..10. Read-only display, or an accessible radio group (arrows, Home/End, Delete to clear). */
export function StarRating({ value, onChange, size = 'md', label = 'Note' }: { value: number | null; onChange?: (v: number | null) => void; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const group = useRef<HTMLDivElement>(null);
  const text = value === null ? 'pas encore noté' : stars(value) + ' étoiles sur 5';

  if (!onChange) {
    return (
      <span className={'stars stars--' + size} role="img" aria-label={`${label} : ${text}`}>
        {[1, 2, 3, 4, 5].map((n) => <span key={n} className="star" style={{ '--fill': fill(value, n) + '%' } as React.CSSProperties} aria-hidden="true" />)}
      </span>
    );
  }

  function move(v: number | null) {
    onChange!(v);
    if (v !== null) window.requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-v="${v}"]`)?.focus());
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const cur = value;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') move(Math.min(10, (cur ?? 0) + 1));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') move(Math.max(1, (cur ?? 2) - 1));
    else if (e.key === 'Home') move(1);
    else if (e.key === 'End') move(10);
    else if (e.key === 'Delete' || e.key === 'Backspace') onChange!(null);
    else return;
    e.preventDefault();
  }

  return (
    <div className="rating-edit">
      <div ref={group} className={'stars stars--' + size + ' stars--edit'} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className="star" style={{ '--fill': fill(value, n) + '%' } as React.CSSProperties}>
            {[n * 2 - 1, n * 2].map((v) => (
              <button
                key={v} type="button" role="radio" data-v={v}
                className={'star__half star__half--' + (v % 2 ? 'l' : 'r')}
                aria-checked={value === v}
                aria-label={`${stars(v)} étoile${v > 2 ? 's' : ''} sur 5`}
                tabIndex={value === v || (value === null && v === 1) ? 0 : -1}
                onClick={() => onChange(value === v ? null : v)}
              />
            ))}
          </span>
        ))}
      </div>
      <span className="rating-edit__value" aria-live="polite">{value === null ? 'Pas de note' : `${value}/10`}</span>
      {value !== null && <button type="button" className="link-btn" onClick={() => onChange(null)}>Effacer</button>}
    </div>
  );
}

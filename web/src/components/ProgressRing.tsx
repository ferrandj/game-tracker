/** Circular progress with the percentage inside. */
export function ProgressRing({ pct, size = 72, label }: { pct: number; size?: number; label?: string }) {
  const r = 15.9155; // circumference = 100
  return (
    <svg className={'ring' + (pct === 100 ? ' ring--full' : '')} width={size} height={size} viewBox="0 0 36 36" role="img" aria-label={label ?? `${pct} % complété`}>
      <circle className="ring__track" cx="18" cy="18" r={r} />
      {pct > 0 && <circle className="ring__bar" cx="18" cy="18" r={r} strokeDasharray={`${pct} ${100 - pct}`} />}
      <text className="ring__text" x="18" y="19.2" textAnchor="middle" dominantBaseline="middle">{pct}%</text>
    </svg>
  );
}

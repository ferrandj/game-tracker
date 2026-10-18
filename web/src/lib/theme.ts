export type Theme = 'auto' | 'dark' | 'light';
const KEY = 'gt-theme';

export function getTheme(): Theme {
  try { const v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : 'auto'; } catch { return 'auto'; }
}

export function applyTheme(t: Theme): void {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* private mode: the choice just is not remembered */ }
}

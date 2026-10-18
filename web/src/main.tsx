import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LibraryProvider } from './state/library';
import { applyTheme, getTheme } from './lib/theme';
import './styles/app.css';

applyTheme(getTheme());
createRoot(document.getElementById('root')!).render(<StrictMode><LibraryProvider><App /></LibraryProvider></StrictMode>);

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom does not implement scrolling
window.scrollTo = () => undefined;

afterEach(() => { cleanup(); localStorage.clear(); });

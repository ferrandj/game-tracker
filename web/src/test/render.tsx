import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { LibraryProvider } from '../state/library';

/** The whole app against the fake server, starting at the library (hash reset first). */
export function renderApp(hash = '') {
  location.hash = hash;
  const user = userEvent.setup();
  const view = render(<LibraryProvider><App /></LibraryProvider>);
  return { user, ...view };
}

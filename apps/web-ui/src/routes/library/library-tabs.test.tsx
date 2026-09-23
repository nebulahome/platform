/**
 * The switch in a library page's header shows the views of the group the page is in.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { LibraryTabs } from './library-tabs';

/**
 * Renders the switch at a given address.
 *
 * @param pathname - Where the person currently is.
 */
function renderAt(pathname: string): void {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <LibraryTabs />
    </MemoryRouter>,
  );
}

describe('LibraryTabs', () => {
  it('offers the automation views on an automation page', () => {
    renderAt('/scenes');

    expect(screen.getByRole('navigation', { name: 'Automation' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Automations' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Scenes' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Aliases' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Devices' })).toBeNull();
  });

  it('offers the configuration views on a configuration page', () => {
    renderAt('/areas');

    expect(screen.getByRole('navigation', { name: 'Configuration' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Devices' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tags' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Areas' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link', { name: 'Scenes' })).toBeNull();
  });
});

/**
 * The frame of a library page when there is nothing in it yet: an empty state in the middle of
 * the page carries the first step, so the header's search, filter and New give way to it.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { EmptyState } from '@nebulahome/ui';

import { LibraryPage } from './library-page';

/**
 * Renders a page of automations.
 *
 * @param count - How many there are.
 * @param isPending - Whether they are still being read.
 */
function renderPage(count: number, isPending = false): void {
  render(
    <MemoryRouter>
      <LibraryPage
        title="Automations"
        noun="automation"
        count={count}
        isPending={isPending}
        isEmpty={count === 0}
        tools={<button type="button">Filter</button>}
        action={<button type="button">New automation</button>}
        empty={
          <EmptyState
            icon={null}
            title="Create your first automation"
            description="An automation lets the house act on its own."
            learnMoreHref="#docs"
          />
        }
      >
        <p>The list</p>
      </LibraryPage>
    </MemoryRouter>,
  );
}

describe('LibraryPage with an empty state', () => {
  it('shows the empty state in place of the list, and nothing over it in the header', () => {
    renderPage(0);

    expect(screen.getByRole('heading', { name: 'Create your first automation' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Learn more/u }).getAttribute('href')).toBe('#docs');
    expect(screen.queryByRole('button', { name: 'Filter' })).toBeNull();
    expect(screen.queryByText(/0 automations/u)).toBeNull();
    expect(screen.queryByText('The list')).toBeNull();
  });

  it('says it is reading quietly, without the outline', () => {
    renderPage(0, true);

    expect(screen.getByText('Reading…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Create your first automation' })).toBeNull();
  });

  it('shows the list, the count and the header controls when there is something', () => {
    renderPage(3);

    expect(screen.getByText('The list')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy();
    expect(screen.getByText(/3 automations/u)).toBeTruthy();
  });
});

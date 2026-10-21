/**
 * A page's actions: drawn in the header's node inside the package's style scope, counted while
 * they are there, and nothing off a page.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PackagePageActions, PageActionsProvider } from '@/packages/page-actions';

describe('PackagePageActions', () => {
  it('draws in the header, in the package scope, and counts itself', () => {
    const target = document.createElement('div');
    const onChange = vi.fn();

    const { unmount } = render(
      <PageActionsProvider value={{ target, onChange }}>
        <PackagePageActions packageId="3d-home">
          <button type="button">Edit</button>
        </PackagePageActions>
      </PageActionsProvider>,
    );

    expect(target.querySelector('[data-nebula-package="3d-home"] button')?.textContent).toBe(
      'Edit',
    );
    expect(onChange).toHaveBeenLastCalledWith(1);

    unmount();

    expect(onChange).toHaveBeenLastCalledWith(-1);
  });

  it('draws nothing off a page', () => {
    const { container } = render(
      <PackagePageActions packageId="3d-home">
        <button type="button">Edit</button>
      </PackagePageActions>,
    );

    expect(container.innerHTML).toBe('');
  });
});

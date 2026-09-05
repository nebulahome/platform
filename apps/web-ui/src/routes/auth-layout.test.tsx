/**
 * The entrance.
 *
 * Written as assertions rather than checked by eye, because the state being tested is the one
 * nobody can see: on a local machine the session resolves in about ten milliseconds, so the
 * loading frame is on screen for less than a frame and a screenshot will never catch it. It is
 * still the frame every cold start passes through, and on a slow connection it is the first
 * thing anybody sees.
 *
 * What matters is that the mark is *the same element* in both states. That is the whole
 * mechanism: a node that survives the transition can move, and two nodes that swap can only
 * fade.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthLayout } from '@/routes/auth-layout';

describe('AuthLayout', () => {
  it('turns the mark while it is deciding what to show', () => {
    const { container } = render(<AuthLayout isLoading />);

    expect(container.querySelector('.animate-orbit')).not.toBeNull();
  });

  it('stops turning it once there is something to show', () => {
    const { container } = render(<AuthLayout title="Sign in" subtitle="Welcome back." />);

    expect(container.querySelector('.animate-orbit')).toBeNull();
  });

  it('collapses the card rather than removing it', () => {
    // Collapsed, not unmounted: a card that is not in the tree cannot animate open, and the
    // height it opens to is one nobody has measured.
    const { container } = render(
      <AuthLayout isLoading title="Sign in" subtitle="Welcome back.">
        <button type="button">Sign in</button>
      </AuthLayout>,
    );

    expect(container.querySelector('.grid-rows-\\[0fr\\]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('opens the card when it has something to say', () => {
    const { container } = render(
      <AuthLayout title="Sign in" subtitle="Welcome back.">
        <button type="button">Sign in</button>
      </AuthLayout>,
    );

    expect(container.querySelector('.grid-rows-\\[1fr\\]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('keeps the mark on screen in both states, so it can move between them', () => {
    const loading = render(<AuthLayout isLoading />);
    const loadingMark = loading.container.querySelector('svg[role="img"]');

    expect(loadingMark).not.toBeNull();
    loading.unmount();

    const settled = render(<AuthLayout title="Sign in" subtitle="Welcome back." />);

    expect(settled.container.querySelector('svg[role="img"]')).not.toBeNull();
  });

  it('collapses the wordmark to nothing while the mark is at its largest', () => {
    // Collapsed rather than merely transparent: a transparent word still takes its width, and
    // the row is centred, so the mark would sit left of the middle of an empty screen.
    const { container } = render(<AuthLayout isLoading />);
    const wordmark = [...container.querySelectorAll('span')].find(
      (node) => node.textContent === 'Nebula',
    );
    const column = wordmark?.closest('.grid');

    expect(column?.className).toContain('grid-cols-[0fr]');
    expect(column?.className).toContain('opacity-0');
  });

  it('puts the drifting lights behind everything, and hides them from a reader', () => {
    const { container } = render(<AuthLayout isLoading />);
    const aurora = container.querySelector('[aria-hidden="true"]');

    expect(aurora).not.toBeNull();
    expect(aurora?.querySelectorAll('div')).toHaveLength(3);
    expect(aurora?.className).toContain('pointer-events-none');
  });
});

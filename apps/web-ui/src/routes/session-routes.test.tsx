/**
 * The address and the screen, kept in step.
 *
 * The behaviour being pinned is the one that was wrong: being sent to the sign-in form while the
 * address bar still said `/devices`. Each case starts somewhere, sets a session status, and
 * asserts where the person ends up - including the destination they were headed for, which is
 * the whole reason the redirect carries a query string at all.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { useSession, type SessionStatus } from '@/auth/session-store';
import { SessionRoutes } from '@/routes/session-routes';

/**
 * Prints the current address, so a test can assert on it.
 *
 * @returns The address, as text.
 */
function Address() {
  const location = useLocation();

  return <span data-testid="address">{`${location.pathname}${location.search}`}</span>;
}

/**
 * Renders the application at an address, with the session in a given state.
 *
 * `initialise` is replaced with a no-op. The real one reaches for the network, and in this
 * environment that resolves to "signed out" - which would overwrite the status the case is
 * about, roughly one tick after it was set.
 *
 * @param at - Where the browser starts.
 * @param status - Where the session is.
 */
function renderAt(at: string, status: SessionStatus): void {
  useSession.setState({
    status,
    user: undefined,
    accessToken: null,
    challengeId: null,

    /**
     * Stands in for the real start-up, which would talk to the API.
     *
     * @returns Immediately.
     */
    initialise: async (): Promise<void> => Promise.resolve(),
  });

  render(
    <MemoryRouter initialEntries={[at]}>
      <Address />
      <SessionRoutes />
    </MemoryRouter>,
  );
}

/**
 * Reads the address the test ended up at.
 *
 * @returns The path and query.
 */
function address(): string {
  return screen.getByTestId('address').textContent;
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('the address follows the session', () => {
  it('sends a signed-out visitor to the sign-in screen', () => {
    renderAt('/devices', 'signed-out');

    expect(address()).toBe('/sign-in?returnTo=%2Fdevices');
  });

  it('remembers where they were going, so they land there and not on the dashboard', () => {
    renderAt('/settings?tab=account', 'signed-out');

    expect(address()).toBe('/sign-in?returnTo=%2Fsettings%3Ftab%3Daccount');
  });

  it('does not carry a destination when there is nothing to carry', () => {
    renderAt('/dashboards', 'signed-out');

    // The dashboard is where they would go anyway, so the query string would be noise.
    expect(address()).toBe('/sign-in');
  });

  it('leaves a signed-out visitor alone once they are on the sign-in screen', () => {
    renderAt('/sign-in?returnTo=%2Fdevices', 'signed-out');

    expect(address()).toBe('/sign-in?returnTo=%2Fdevices');
  });

  it('keeps the destination across the second factor', () => {
    renderAt('/sign-in?returnTo=%2Fdevices', 'awaiting-second-factor');

    expect(address()).toBe('/sign-in/two-factor?returnTo=%2Fdevices');
  });

  it('sends an installation with no accounts to the setup screen', () => {
    renderAt('/dashboards', 'setup-required');

    expect(address()).toBe('/setup');
  });

  it('will not let anyone reach the code screen by typing its address', () => {
    // There is no challenge to complete, so there is nothing that screen could do.
    renderAt('/sign-in/two-factor', 'signed-out');

    expect(address()).toBe('/sign-in');
  });

  it('sends a signed-in person back where they were headed', () => {
    renderAt('/sign-in?returnTo=%2Fdevices', 'signed-in');

    expect(address()).toBe('/devices');
  });

  it('refuses a destination that leaves this site', () => {
    renderAt('/sign-in?returnTo=https%3A%2F%2Fexample.invalid', 'signed-in');

    expect(address()).toBe('/dashboards');
  });

  it('leaves a signed-in person where they are', () => {
    renderAt('/devices', 'signed-in');

    expect(address()).toBe('/devices');
  });

  it('waits until it knows before sending anyone anywhere', () => {
    // Nothing has been decided yet. Correcting the address now would be a guess, and the guess
    // would be wrong for anyone whose session is about to be restored.
    renderAt('/devices', 'starting');

    expect(address()).toBe('/devices');
  });
});

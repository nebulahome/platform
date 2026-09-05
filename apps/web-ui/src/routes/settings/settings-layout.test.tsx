/**
 * What the settings rail shows, and to whom.
 *
 * The behaviour being pinned is a permission one, so the cases are about absence: a section
 * nobody may open should not be advertised, and the group heading above it should go with it
 * rather than sitting over nothing.
 *
 * Hiding is not the control. `RequiresPermission` guards each route and the API refuses each
 * request regardless, which is why the last case checks that typing the address gets a refusal
 * rather than a broken page.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { GrantedPermission } from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import { RequiresPermission } from '@/routes/settings/requires-permission';
import { SettingsLayout } from '@/routes/settings/settings-layout';

/**
 * Signs somebody in holding exactly these permissions.
 *
 * @param keys - What they hold, unscoped.
 */
function signedInWith(...keys: string[]): void {
  const permissions: GrantedPermission[] = keys.map((key) => ({
    key,
    scope: '*',
    effect: 'allow',
  }));

  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'member',
      permissions,
      locale: 'en',
      timezone: 'UTC',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });
}

/**
 * Renders the settings frame at an address.
 *
 * @param pathname - Where the person currently is.
 */
function renderAt(pathname: string): void {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/settings" element={<SettingsLayout />}>
          <Route path="account" element={<p>the account page</p>} />
          <Route
            path="data"
            element={
              <RequiresPermission permission="settings:read" section="Data and retention">
                <p>the server settings</p>
              </RequiresPermission>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('the settings rail', () => {
  it('always offers the sections that are about you', () => {
    signedInWith();
    renderAt('/settings/account');

    expect(screen.getByRole('link', { name: 'Account & security' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Interface' })).toBeTruthy();
  });

  it('does not advertise a server section the person cannot open', () => {
    signedInWith();
    renderAt('/settings/account');

    expect(screen.queryByRole('link', { name: 'Users & roles' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Data & retention' })).toBeNull();
  });

  it('drops the group heading when every section under it is out of reach', () => {
    signedInWith();
    renderAt('/settings/account');

    expect(screen.queryByText('Server')).toBeNull();
  });

  it('shows a server section as soon as one permission reaches it', () => {
    signedInWith('settings:read');
    renderAt('/settings/account');

    expect(screen.getByText('Server')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Data & retention' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Users & roles' })).toBeNull();
  });

  it('names the role that unlocked the server group', () => {
    signedInWith('settings:read');
    renderAt('/settings/account');

    expect(screen.getByText('member')).toBeTruthy();
  });
});

describe('a settings page behind a permission', () => {
  it('opens for somebody who holds it', () => {
    signedInWith('settings:read');
    renderAt('/settings/data');

    expect(screen.getByText('the server settings')).toBeTruthy();
  });

  it('refuses somebody who reaches it by typing the address', () => {
    signedInWith();
    renderAt('/settings/data');

    expect(screen.queryByText('the server settings')).toBeNull();
    expect(screen.getByText(/is not yours to open/)).toBeTruthy();
  });

  it('names the permission it wanted, so the refusal is actionable', () => {
    signedInWith();
    renderAt('/settings/data');

    expect(screen.getByText('settings:read')).toBeTruthy();
  });
});

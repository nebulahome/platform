/**
 * What the settings tree shows, and to whom.
 *
 * The behaviour being pinned is a permission one, so the cases are about absence: a section
 * nobody may open should not be advertised, and the group heading above it should go with it
 * rather than sitting over nothing.
 *
 * Hiding is not the control. `RequiresPermission` guards each route and the API refuses each
 * request regardless, which is why the last case checks that typing the address gets a refusal
 * rather than a broken page.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { GrantedPermission } from '@nebulahome/contracts';

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
      avatarUrl: null,
      locale: 'en',
      houseLocale: 'en',
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
            path="data/retention"
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

describe('the settings tree', () => {
  it('always offers the pages that are about you', () => {
    signedInWith();
    renderAt('/settings/account');

    expect(screen.getByRole('link', { name: 'Account & security' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Interface' })).toBeTruthy();
  });

  it('does not advertise a server group the person cannot open', () => {
    signedInWith();
    renderAt('/settings/account');

    expect(screen.queryByRole('button', { name: 'People' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Data' })).toBeNull();
  });

  it('drops the scope heading when every group under it is out of reach', () => {
    signedInWith();
    renderAt('/settings/account');

    expect(screen.queryByText('Server')).toBeNull();
  });

  it('shows a server group as soon as one permission reaches it', () => {
    signedInWith('settings:read');
    renderAt('/settings/account');

    expect(screen.getByText('Server')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Data' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'People' })).toBeNull();
  });

  it('opens the group of the current page, and another when pressed', () => {
    signedInWith('settings:read');
    renderAt('/settings/data/retention');

    expect(screen.getByRole('button', { name: 'Data' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Network' }).getAttribute('aria-expanded')).toBe(
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Network' }));

    expect(screen.getByRole('button', { name: 'Network' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('offers the monitor only to somebody who may read the system', () => {
    // It sits in the System group beside Backup, and still answers to its own permission: what
    // the machine is doing is not a setting.
    signedInWith('settings:read');
    renderAt('/settings/account');

    expect(screen.queryByRole('link', { name: 'Monitor' })).toBeNull();

    signedInWith('system:read');
    renderAt('/settings/account');

    expect(screen.getByRole('link', { name: 'Monitor' })).toBeTruthy();
  });
});

describe('a settings page behind a permission', () => {
  it('opens for somebody who holds it', () => {
    signedInWith('settings:read');
    renderAt('/settings/data/retention');

    expect(screen.getByText('the server settings')).toBeTruthy();
  });

  it('refuses somebody who reaches it by typing the address', () => {
    signedInWith();
    renderAt('/settings/data/retention');

    expect(screen.queryByText('the server settings')).toBeNull();
    expect(screen.getByText(/is not yours to open/)).toBeTruthy();
  });

  it('names the permission it wanted, so the refusal is actionable', () => {
    signedInWith();
    renderAt('/settings/data/retention');

    expect(screen.getByText('settings:read')).toBeTruthy();
  });
});

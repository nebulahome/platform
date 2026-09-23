/**
 * The rail, and the pure functions around it.
 *
 * The render cases check the things that are easy to get wrong and invisible when they are:
 * that a group opens because of where you are rather than because it was clicked, that each
 * entry sits in the group it belongs to, and that the current row is marked in a way something
 * other than a colour can perceive.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { isPermitted, useSession } from '@/auth/session-store';
import { Sidebar } from '@/components/sidebar';
import { toUsername } from '@/routes/first-run';

/**
 * Renders the rail at a given address, with somebody signed in.
 *
 * @param pathname - Where the person currently is.
 */
function renderAt(pathname: string): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: [],
      avatarUrl: null,
      locale: 'it',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('shows the top-level destinations and the two groups', () => {
    renderAt('/dashboards');

    expect(screen.getByRole('link', { name: 'Dashboards' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Automation/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Configuration/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Packages' })).toBeTruthy();
  });

  it('keeps both groups shut when you are not inside either', () => {
    renderAt('/dashboards');

    expect(screen.getByRole('button', { name: /Automation/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(
      screen.getByRole('button', { name: /Configuration/ }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.queryByRole('link', { name: 'Scenes' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Devices' })).toBeNull();
  });

  it('opens the group you are in because of where you are, not because it was clicked', () => {
    renderAt('/scenes');

    // What runs the house on its own is one group; what describes the house is the other.
    expect(screen.getByRole('button', { name: /Automation/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(
      screen.getByRole('button', { name: /Configuration/ }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.getByRole('link', { name: 'Automations' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Aliases' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Tags' })).toBeNull();
  });

  it('puts devices, tags and areas together, as the things that describe the house', () => {
    renderAt('/tags');

    expect(
      screen.getByRole('button', { name: /Configuration/ }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByRole('link', { name: 'Devices' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tags' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Areas' }).getAttribute('href')).toBe('/areas');
    expect(screen.queryByRole('link', { name: 'Automations' })).toBeNull();
  });

  it('marks the current row for something that cannot see a colour', () => {
    renderAt('/packages');

    expect(screen.getByRole('link', { name: 'Packages' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      screen.getByRole('link', { name: 'Dashboards' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('names the person and their role, and opens a menu rather than acting', () => {
    renderAt('/dashboards');

    const chip = screen.getByRole('button', { name: /Mattia Carli/ });

    expect(chip.getAttribute('aria-haspopup')).toBe('menu');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(within(chip).getByText('owner')).toBeTruthy();
    expect(within(chip).getByText('MC')).toBeTruthy();
  });

  it('draws nothing beside the person but their picture and their name', () => {
    renderAt('/dashboards');

    const chip = screen.getByRole('button', { name: /Mattia Carli/ });

    // The chip used to end in an "expand" glyph. The whole chip is the menu's trigger, so the
    // glyph said nothing the chip did not already say - and it read as a control of its own.
    expect(chip.querySelector('svg')).toBeNull();
  });
});

describe('toUsername', () => {
  it('suggests something the API will accept', () => {
    expect(toUsername('Mattia Carli')).toBe('mattia.carli');
  });

  it('strips accents rather than the letters under them', () => {
    expect(toUsername('Zoë Müller')).toBe('zoe.muller');
  });

  it('leaves nothing dangling at either end', () => {
    expect(toUsername('  !!Ada!!  ')).toBe('ada');
  });
});

describe('isPermitted', () => {
  it('lets a denial beat a wider allow, exactly as the server does', () => {
    const grants = [
      { key: 'entity:control', scope: '*', effect: 'allow' as const },
      { key: 'entity:control', scope: 'area.garage', effect: 'deny' as const },
    ];

    expect(isPermitted(grants, 'entity:control', ['area.hallway'])).toBe(true);
    expect(isPermitted(grants, 'entity:control', ['area.garage'])).toBe(false);
  });

  it('refuses what was never granted', () => {
    expect(isPermitted([], 'package:install')).toBe(false);
  });
});

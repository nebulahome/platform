/**
 * The rail, and the pure functions around it.
 *
 * The render cases check the things that are easy to get wrong and invisible when they are:
 * that a group opens because of where you are rather than because it was clicked, that each
 * entry sits in the group it belongs to, and that the current row is marked in a way something
 * other than a colour can perceive.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { ApiPackage, SceneView } from '@nebulahome/contracts';

import { isPermitted, useSession } from '@/auth/session-store';
import { Sidebar } from '@/components/sidebar';
import type * as ContainersApi from '@/containers/api';
import type * as LibraryApi from '@/library/api';
import { fetchScenes } from '@/library/api';
import type * as PackagesApi from '@/packages/api';
import { fetchPackages } from '@/packages/api';
import { toUsername } from '@/routes/first-run';
import { usePreferences } from '@/settings/preferences';
import { aPackage } from '@/testing/package-fixtures';

vi.mock('@/packages/api', async (original) => ({
  ...(await original<typeof PackagesApi>()),
  fetchPackages: vi.fn(async () => Promise.resolve([])),
}));

// The rail counts each list; the lists are empty unless a test fills one.
vi.mock('@/library/api', async (original) => ({
  ...(await original<typeof LibraryApi>()),
  fetchAutomations: vi.fn(async () => Promise.resolve([])),
  fetchScenes: vi.fn(async () => Promise.resolve([])),
  fetchAliases: vi.fn(async () => Promise.resolve([])),
  fetchDevices: vi.fn(async () => Promise.resolve([])),
  fetchAreas: vi.fn(async () => Promise.resolve([])),
  fetchTags: vi.fn(async () => Promise.resolve([])),
  fetchVendors: vi.fn(async () => Promise.resolve([])),
}));

vi.mock('@/containers/api', async (original) => ({
  ...(await original<typeof ContainersApi>()),
  fetchContainers: vi.fn(async () =>
    Promise.resolve({
      docker: { isAvailable: true },
      items: [],
      installs: [],
      composeOperations: [],
    }),
  ),
}));

/** Every list the rail can count, readable. */
const EVERYTHING = [
  'automation:read',
  'scene:read',
  'alias:read',
  'device:read',
  'area:read',
  'tag:read',
  'integration:read',
  'package:read',
  'container:read',
] as const;

/**
 * A scene, as the list returns it, with only its key telling it apart.
 *
 * @param key - Its key.
 * @returns The scene.
 */
function aScene(key: string): SceneView {
  return {
    id:
      key === 'a' ? '00000000-0000-4000-8000-00000000000a' : '00000000-0000-4000-8000-00000000000b',
    key,
    name: key,
    icon: null,
    areaKey: null,
    transitionMs: 0,
    rollbackOnPartialFailure: false,
    unresolvedMembers: [],
    members: [],
  };
}

/**
 * Renders the rail at a given address, with somebody signed in.
 *
 * @param pathname - Where the person currently is.
 * @param permissions - What they hold.
 */
function renderAt(pathname: string, permissions: readonly string[] = []): void {
  usePreferences.setState({ sidebar: 'expanded' });
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: permissions.map((key) => ({ key, scope: '*', effect: 'allow' as const })),
      avatarUrl: null,
      locale: 'it',
      houseLocale: 'en',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[pathname]}>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The fixture package's interface, with an entry in the sidebar.
 *
 * @param sidebar - What the entry says.
 * @param sidebar.label - Its label, when not the package's name.
 * @returns The interface.
 */
function withEntry(sidebar: { readonly label?: string }): ApiPackage['ui'] {
  const { ui } = aPackage();

  return ui === null ? null : { ...ui, sidebar };
}

describe('Sidebar', () => {
  it('lists the pages of the running packages that ask for an entry, under Packages', async () => {
    vi.mocked(fetchPackages).mockResolvedValueOnce([
      aPackage({ id: 'recorder', name: 'Recorder', ui: withEntry({}) }),
      aPackage({
        id: 'stopped',
        state: 'stopped',
        ui: withEntry({ label: 'Stopped' }),
      }),
      aPackage({ id: 'mqtt' }),
    ]);
    renderAt('/packages/recorder/app/clips', ['package:read']);

    const entry = await screen.findByRole('link', { name: 'Recorder' });

    expect(entry.getAttribute('href')).toBe('/packages/recorder/app');
    expect(entry.getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link', { name: 'Stopped' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'MQTT' })).toBeNull();
  });

  it('shows Dashboards and the three groups, Automate, House and System', () => {
    renderAt('/dashboards', EVERYTHING);

    expect(screen.getByRole('link', { name: 'Dashboards' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Automate/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /House/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /System/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
  });

  it('keeps every group shut when you are not inside one', () => {
    renderAt('/dashboards', EVERYTHING);

    for (const name of [/Automate/, /House/, /System/]) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-expanded')).toBe('false');
    }
    expect(screen.queryByRole('link', { name: 'Scenes' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Devices' })).toBeNull();
  });

  it('opens the group you are in because of where you are, not because it was clicked', () => {
    renderAt('/scenes', EVERYTHING);

    expect(screen.getByRole('button', { name: /Automate/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /House/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.getByRole('link', { name: 'Automations' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Aliases' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Tags' })).toBeNull();
  });

  it('puts devices, areas and tags together, then the setup of the dashboards', () => {
    renderAt('/tags', [...EVERYTHING, 'dashboard:manage']);

    const house = screen.getByRole('button', { name: /House/ });
    expect(house.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Devices' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Areas' }).getAttribute('href')).toBe('/areas');
    expect(screen.getByRole('link', { name: 'Dashboard setup' }).getAttribute('href')).toBe(
      '/configuration/dashboards',
    );
    expect(screen.queryByRole('link', { name: 'Automations' })).toBeNull();
  });

  it('puts brokers, integrations, packages and containers under System, in that order', () => {
    renderAt('/containers', EVERYTHING);

    expect(screen.getByRole('button', { name: /System/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    const system = ['Brokers', 'Integrations', 'Packages', 'Containers'];
    const order = screen
      .getAllByRole('link')
      .map((link) => link.textContent.replace(/\d+$/u, '').trim())
      .filter((name) => system.includes(name));

    expect(order).toEqual(system);
    expect(screen.getByRole('link', { name: 'Containers' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('shows only what the role may read, and no group left empty', () => {
    renderAt('/scenes', ['scene:read']);

    expect(screen.getByRole('link', { name: 'Scenes' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Automations' })).toBeNull();
    expect(screen.queryByRole('button', { name: /House/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /System/ })).toBeNull();
  });

  it('draws House only for someone who may read the devices', () => {
    renderAt('/tags', ['tag:read', 'area:read']);

    expect(screen.queryByRole('button', { name: /House/ })).toBeNull();
  });

  it('counts each list beside its entry', async () => {
    vi.mocked(fetchScenes).mockResolvedValueOnce([aScene('a'), aScene('b')]);
    renderAt('/scenes', EVERYTHING);

    const scenes = screen.getByRole('link', { name: /Scenes/ });
    expect(await within(scenes).findByText('2')).toBeTruthy();
  });

  it('lets the group you are in be closed by hand', () => {
    renderAt('/scenes', EVERYTHING);

    const automate = screen.getByRole('button', { name: /Automate/ });

    fireEvent.click(automate);

    expect(automate.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Scenes' })).toBeNull();
  });

  it('opens one group at a time', () => {
    renderAt('/scenes', EVERYTHING);

    fireEvent.click(screen.getByRole('button', { name: /House/ }));

    expect(screen.getByRole('button', { name: /House/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /Automate/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('forgets a group opened by hand once you move on, and follows where you are', () => {
    // The bug this guards: a group opened by hand stayed open on every page after, beside the
    // one the new page opened, until it happened to be clicked again from outside it.
    renderAt('/scenes', EVERYTHING);

    fireEvent.click(screen.getByRole('button', { name: /House/ }));
    fireEvent.click(screen.getByRole('link', { name: 'Tags' }));

    expect(screen.getByRole('button', { name: /House/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /Automate/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );

    fireEvent.click(screen.getByRole('link', { name: 'Dashboards' }));

    expect(screen.getByRole('button', { name: /House/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('opens House on the page of a device and of an entity', () => {
    renderAt('/devices/entities/light.kitchen', EVERYTHING);

    expect(screen.getByRole('button', { name: /House/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('collapses to glyphs named on hover, and remembers it', () => {
    renderAt('/scenes', EVERYTHING);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(usePreferences.getState().sidebar).toBe('collapsed');
    expect(screen.queryByRole('button', { name: /Automate/ })).toBeNull();
    const devices = screen.getByRole('link', { name: 'Devices' });
    expect(devices.getAttribute('title')).toBe('Devices');
    expect(screen.getByRole('link', { name: 'Scenes' }).getAttribute('aria-current')).toBe('page');

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(usePreferences.getState().sidebar).toBe('expanded');
    expect(screen.getByRole('button', { name: /Automate/ })).toBeTruthy();
  });

  it('keeps the width chosen on every page, the dashboard editor too', () => {
    renderAt('/configuration/dashboards/home/edit', [...EVERYTHING, 'dashboard:manage']);

    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /House/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('keeps the button that collapses and opens the rail as its last row at both widths', () => {
    renderAt('/scenes', EVERYTHING);

    const rail = screen.getByRole('navigation', { name: 'Main' });
    const lastButton = (): Element | null => {
      const buttons = rail.querySelectorAll('button');

      return buttons[buttons.length - 1] ?? null;
    };

    expect(lastButton()).toBe(screen.getByRole('button', { name: 'Collapse sidebar' }));

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(lastButton()).toBe(screen.getByRole('button', { name: 'Expand sidebar' }));
  });

  it('opens the account menu beside the narrow rail, outside the part that scrolls', () => {
    renderAt('/scenes', EVERYTHING);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: /Account menu/ }));

    const menu = screen.getByRole('menu');
    expect(menu.className).toContain('left-full');
    expect(menu.closest('.overflow-y-auto')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy();
  });

  it('marks the current row for something that cannot see a colour', () => {
    renderAt('/packages', EVERYTHING);

    expect(screen.getByRole('link', { name: /Packages/ }).getAttribute('aria-current')).toBe(
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
    expect(within(chip).getByText('Owner')).toBeTruthy();
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

/**
 * The sidebar, and the pure functions around it.
 *
 * The render cases check the things that are easy to get wrong and invisible when they are: that
 * one section stands open and follows the page, that each entry sits in the section it belongs to,
 * that a shut card still names every icon, that a narrow window shuts it without forgetting the
 * choice, and that the current row is marked in a way something other than a colour can perceive.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiPackage, SceneView } from '@nebulahome/contracts';

import { isPermitted, useSession } from '@/auth/session-store';
import { Sidebar } from '@/components/sidebar';
import type * as ContainersApi from '@/containers/api';
import type * as LibraryApi from '@/library/api';
import { fetchScenes, fetchVendors } from '@/library/api';
import type * as PackagesApi from '@/packages/api';
import { fetchAvailablePackages, fetchPackages } from '@/packages/api';
import { toUsername } from '@/routes/first-run';
import { usePreferences } from '@/settings/preferences';
import { aVendor } from '@/testing/fixtures';
import { anOffer, aPackage } from '@/testing/package-fixtures';

vi.mock('@/packages/api', async (original) => ({
  ...(await original<typeof PackagesApi>()),
  fetchPackages: vi.fn(async () => Promise.resolve([])),
  fetchAvailablePackages: vi.fn(async () =>
    Promise.resolve({ items: [], checkedAt: null, error: null }),
  ),
}));

// The sidebar counts each list; the lists are empty unless a test fills one.
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

/** Every list the sidebar can count, readable. */
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
    rollbackOnPartialFailure: false,
    unresolvedMembers: [],
    members: [],
  };
}

/**
 * Renders the sidebar at a given address, with somebody signed in.
 *
 * @param pathname - Where the person currently is.
 * @param permissions - What they hold.
 */
function renderAt(pathname: string, permissions: readonly string[] = []): void {
  usePreferences.setState({ sidebar: 'expanded', theme: 'system', foldedSections: [] });
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

/**
 * Makes the window narrower than 1100px for one test.
 */
function narrowWindow(): void {
  vi.spyOn(globalThis, 'matchMedia').mockImplementation((media) => ({
    media,
    matches: media === '(max-width: 1099.98px)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => false,
  }));
}

/**
 * The section of the sidebar with a name.
 *
 * @param name - Its name.
 * @returns The section.
 */
function section(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('folds the packages’ pages from Packages, keeping the one you are on, and remembers it', async () => {
    vi.mocked(fetchPackages).mockResolvedValueOnce([
      aPackage({ id: 'recorder', name: 'Recorder', ui: withEntry({}) }),
      aPackage({ id: 'music', name: 'Music', ui: withEntry({}) }),
    ]);
    renderAt('/packages/recorder/app', ['package:read']);
    await screen.findByRole('link', { name: 'Music' });

    const fold = screen.getByRole('button', { name: 'Package pages' });
    expect(fold.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(fold);

    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(usePreferences.getState().foldedSections).toContain('packages');
    expect(screen.queryByRole('link', { name: 'Music' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Recorder' })).toBeTruthy();

    // Shut, every icon shows and there is nothing to fold.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(screen.getByRole('link', { name: 'Music' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Package pages' })).toBeNull();
  });

  it('has nothing to fold under Packages when no package asks for a page', () => {
    renderAt('/packages', ['package:read']);

    expect(screen.getByRole('link', { name: /Packages/u })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Package pages' })).toBeNull();
  });

  it('shows Dashboards and the three sections, Automate, House and System', () => {
    renderAt('/dashboards', EVERYTHING);

    expect(screen.getByRole('link', { name: 'Dashboards' })).toBeTruthy();
    expect(section('Automate')).toBeTruthy();
    expect(section('House')).toBeTruthy();
    expect(section('System')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
  });

  it('opens only the first section on a page outside them', () => {
    renderAt('/dashboards', EVERYTHING);

    expect(screen.getByRole('link', { name: /Automations/u })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Devices/u })).toBeNull();
    expect(screen.queryByRole('link', { name: /Brokers/u })).toBeNull();
    expect(screen.getByRole('button', { name: 'Automate' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    for (const name of ['House', 'System']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('opens the section of the page you are on', () => {
    renderAt('/containers', EVERYTHING);

    expect(screen.getByRole('button', { name: 'System' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.queryByRole('link', { name: /Automations/u })).toBeNull();
  });

  it('swaps the open section for the one whose heading is pressed, and remembers it', () => {
    renderAt('/dashboards', EVERYTHING);

    const automate = screen.getByRole('button', { name: 'Automate' });
    const system = screen.getByRole('button', { name: 'System' });
    fireEvent.click(system);

    expect(system.getAttribute('aria-expanded')).toBe('true');
    expect(automate.getAttribute('aria-expanded')).toBe('false');
    expect(usePreferences.getState().foldedSections).toEqual(['automate', 'house']);
    expect(screen.getByRole('link', { name: /Brokers/u })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Automations/u })).toBeNull();

    // Pressing the open one keeps it open: one section always stands open.
    fireEvent.click(system);

    expect(system.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the page you are on in sight in a folded section', () => {
    renderAt('/devices/shelly-kitchen?entity=light.kitchen', EVERYTHING);

    fireEvent.click(screen.getByRole('button', { name: 'Automate' }));

    expect(screen.getByRole('link', { name: /Devices/u }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.queryByRole('link', { name: /Areas/u })).toBeNull();
    expect(screen.queryByRole('link', { name: /Tags/u })).toBeNull();
  });

  it('puts a dot on a folded heading when a page it hides has an update waiting', async () => {
    vi.mocked(fetchAvailablePackages).mockResolvedValue({
      items: [anOffer({ installedVersion: '1.3.0', hasUpdate: true })],
      checkedAt: null,
      error: null,
    });
    renderAt('/dashboards', EVERYTHING);
    fireEvent.click(screen.getByRole('button', { name: 'System' }));
    await within(screen.getByRole('link', { name: /Packages/u })).findByText('1 update');

    fireEvent.click(screen.getByRole('button', { name: 'Automate' }));

    expect(screen.getByRole('button', { name: 'System, 1 update' })).toBeTruthy();
  });

  it('shows every icon on the shut card, folded sections too, and folds nothing there', () => {
    renderAt('/dashboards', EVERYTHING);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(screen.getByRole('link', { name: 'Brokers' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Containers' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'System' })).toBeNull();
    expect(section('System')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));

    expect(screen.queryByRole('link', { name: /Brokers/u })).toBeNull();
  });

  it('puts devices, areas and tags together, then the setup of the dashboards', () => {
    renderAt('/tags', [...EVERYTHING, 'dashboard:manage']);

    const house = within(section('House'));
    expect(house.getByRole('link', { name: /Devices/u })).toBeTruthy();
    expect(house.getByRole('link', { name: /Areas/u }).getAttribute('href')).toBe('/areas');
    expect(house.getByRole('link', { name: 'Dashboard setup' }).getAttribute('href')).toBe(
      '/configuration/dashboards',
    );
    expect(house.queryByRole('link', { name: /Automations/u })).toBeNull();
  });

  it('puts brokers, integrations, packages and containers under System, in that order', () => {
    renderAt('/containers', EVERYTHING);

    const order = within(section('System'))
      .getAllByRole('link')
      .map((link) => link.textContent.replace(/\d+$/u, '').trim());

    expect(order).toEqual(['Brokers', 'Integrations', 'Packages', 'Containers']);
    expect(screen.getByRole('link', { name: /Containers/u }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('shows only what the role may read, and no section left empty', () => {
    renderAt('/scenes', ['scene:read']);

    expect(within(section('Automate')).getByRole('link', { name: /Scenes/u })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Automations/u })).toBeNull();
    expect(screen.queryByRole('group', { name: 'House' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'System' })).toBeNull();
  });

  it('draws House only for someone who may read the devices', () => {
    renderAt('/tags', ['tag:read', 'area:read']);

    expect(screen.queryByRole('group', { name: 'House' })).toBeNull();
  });

  it('counts each list beside its entry', async () => {
    vi.mocked(fetchScenes).mockResolvedValueOnce([aScene('a'), aScene('b')]);
    renderAt('/scenes', EVERYTHING);

    const scenes = screen.getByRole('link', { name: /Scenes/u });
    expect(await within(scenes).findByText('2')).toBeTruthy();
  });

  it('says what wants a look in place of the count, and names it on the shut card', async () => {
    vi.mocked(fetchVendors).mockResolvedValue([
      aVendor({ update: { latestVersion: '2.0.0', hasUpdate: true, hasNewBuild: false } }),
      aVendor({ id: 'hue', update: { latestVersion: null, hasUpdate: false, hasNewBuild: true } }),
      aVendor({ id: 'tuya', update: null }),
    ]);
    vi.mocked(fetchAvailablePackages).mockResolvedValue({
      items: [
        anOffer({ installedVersion: '1.3.0', hasUpdate: true }),
        anOffer({ id: 'music', installedVersion: '2.0.0' }),
      ],
      checkedAt: null,
      error: null,
    });
    renderAt('/brokers', EVERYTHING);

    const integrations = screen.getByRole('link', { name: /Integrations/u });
    expect(await within(integrations).findByText('2 updates')).toBeTruthy();
    const packages = screen.getByRole('link', { name: /Packages/u });
    expect(await within(packages).findByText('1 update')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(screen.getByRole('link', { name: 'Packages, 1 update' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Containers' })).toBeTruthy();
  });

  it('collapses to icons named beside the card on hover and focus, and remembers it', async () => {
    vi.mocked(fetchScenes).mockResolvedValue([aScene('a'), aScene('b')]);
    renderAt('/scenes', EVERYTHING);
    await within(screen.getByRole('link', { name: /Scenes/u })).findByText('2');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(usePreferences.getState().sidebar).toBe('collapsed');
    const scenes = screen.getByRole('link', { name: 'Scenes' });
    expect(scenes.getAttribute('title')).toBeNull();
    expect(scenes.getAttribute('aria-current')).toBe('page');
    expect(section('Automate')).toBeTruthy();

    // A pointer passing by names nothing; one that rests does.
    fireEvent.mouseEnter(scenes);
    expect(screen.queryByText('Scenes · 2')).toBeNull();
    expect(await screen.findByText('Scenes · 2')).toBeTruthy();
    fireEvent.mouseLeave(scenes);
    expect(screen.queryByText('Scenes · 2')).toBeNull();

    // The keyboard is named at once, and Escape takes the name away.
    const devices = screen.getByRole('link', { name: 'Devices' });
    act(() => {
      devices.focus();
    });
    expect(screen.getByText('Devices · 0')).toBeTruthy();
    fireEvent.keyDown(devices, { key: 'Escape' });
    expect(screen.queryByText('Devices · 0')).toBeNull();

    // Open, the names are on the rows, and nothing shows beside the card.
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(usePreferences.getState().sidebar).toBe('expanded');
    fireEvent.mouseEnter(screen.getByRole('link', { name: /Aliases/u }));
    await new Promise((done) => {
      globalThis.setTimeout(done, 200);
    });
    expect(screen.queryByText('Aliases · 0')).toBeNull();
  });

  it('keeps the width chosen on every page, the dashboard editor too', () => {
    renderAt('/configuration/dashboards/home/edit', [...EVERYTHING, 'dashboard:manage']);

    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Dashboard setup' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('starts shut on a narrow window, and opens there for the visit, not the saved choice', () => {
    narrowWindow();
    renderAt('/scenes', EVERYTHING);

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));

    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
    expect(usePreferences.getState().sidebar).toBe('expanded');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    expect(usePreferences.getState().sidebar).toBe('expanded');
  });

  it('keeps the button that opens and shuts the card as its last row at both widths', () => {
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

  it('opens the account menu beside the card at both widths, outside the part that scrolls', () => {
    renderAt('/scenes', EVERYTHING);

    for (const toggle of ['Collapse sidebar', 'Expand sidebar']) {
      fireEvent.click(screen.getByRole('button', { name: /Mattia Carli/u }));

      const menu = screen.getByRole('menu', { name: 'Account' });
      expect(menu.className).toContain('left-full');
      expect(menu.closest('.overflow-y-auto')).toBeNull();

      fireEvent.keyDown(menu, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: toggle }));
    }
  });

  it('says how the theme and the language stand, each a way to its setting', () => {
    renderAt('/dashboards');

    fireEvent.click(screen.getByRole('button', { name: /Mattia Carli/u }));

    const profile = screen.getByRole('menuitem', { name: 'Profile' });
    const theme = screen.getByRole('menuitem', { name: /Theme/u });
    const language = screen.getByRole('menuitem', { name: /Language/u });

    expect(profile.getAttribute('href')).toBe('/settings/account');
    expect(within(theme).getByText('System')).toBeTruthy();
    expect(theme.getAttribute('href')).toBe('/settings/interface?highlight=theme');
    expect(within(language).getByText('Italiano')).toBeTruthy();
    expect(language.getAttribute('href')).toBe('/settings/account?highlight=language');
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy();
  });

  it('moves through the account menu with the arrow keys, and gives the focus back on Escape', () => {
    renderAt('/dashboards');

    const chip = screen.getByRole('button', { name: /Mattia Carli/u });
    fireEvent.click(chip);
    const menu = screen.getByRole('menu', { name: 'Account' });

    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Profile' }));
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Sign out' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Profile' }));
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it('marks the current row for something that cannot see a colour', () => {
    renderAt('/packages', EVERYTHING);

    expect(screen.getByRole('link', { name: /Packages/u }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      screen.getByRole('link', { name: 'Dashboards' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('names the person and their role, and opens a menu rather than acting', () => {
    renderAt('/dashboards');

    const chip = screen.getByRole('button', { name: /Mattia Carli/u });

    expect(chip.getAttribute('aria-haspopup')).toBe('menu');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(within(chip).getByText('Owner')).toBeTruthy();
    expect(within(chip).getByText('MC')).toBeTruthy();
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

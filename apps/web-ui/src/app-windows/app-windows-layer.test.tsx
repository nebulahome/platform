/**
 * The app windows over the pages (docs: app windows): a container's page opens in a window, hides as
 * a tab with its page kept, says why there is no page, and a sixth asks which one to close.
 *
 * The browser lays nothing out here, so where the windows sit is `geometry.test.ts`'s; motion is
 * asked to be reduced, so nothing waits on an animation.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationVendorView } from '@nebulahome/contracts';

import { AppWindowsLayer } from '@/app-windows/app-windows-layer';
import { useAppWindows, type AppPage } from '@/app-windows/app-windows-store';
import { useSession } from '@/auth/session-store';
import { openIngressSession } from '@/containers/api';
import { fetchVendor } from '@/library/api';
import { FloatingLayer } from '@/packages/floating/floating-layer';

vi.mock('@/containers/api', async (original) => ({
  ...(await original<object>()),
  openIngressSession: vi.fn(() => Promise.resolve()),
  controlContainer: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/library/api', async (original) => ({
  ...(await original<object>()),
  fetchVendor: vi.fn(),
}));

/** The page Zigbee2MQTT serves through the platform. */
const PATH = '/api/ingress/nebulahome-zigbee2mqtt/';

/** Zigbee2MQTT's page, as its integration's Web page button opens it. */
const ZIGBEE: AppPage = {
  name: 'nebulahome-zigbee2mqtt',
  vendorId: 'zigbee2mqtt',
  title: 'Zigbee2MQTT',
  path: PATH,
};

/**
 * The integration, as far as a window reads it: its container's page and where it stands.
 *
 * @param state - Where the container stands.
 * @returns The integration.
 */
function vendorWith(state: string): IntegrationVendorView {
  return {
    name: 'Zigbee2MQTT',
    color: null,
    logoPadding: 0,
    containers: [
      {
        id: 'zigbee2mqtt',
        name: 'Zigbee2MQTT',
        image: 'koenkk/zigbee2mqtt',
        minVersion: '2.1.0',
        ingressPath: PATH,
      },
    ],
    containerStatuses: [{ state }],
  } as unknown as IntegrationVendorView;
}

/**
 * Renders the layer in a wide window that asks for less motion, signed in with some permissions.
 *
 * @param permissions - What the person may do, beside configuring integrations.
 */
function renderLayer(permissions: readonly string[] = []): void {
  vi.spyOn(globalThis, 'matchMedia').mockImplementation((media) => ({
    media,
    matches: media === '(min-width: 640px)' || media === '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => false,
  }));
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: ['integration:configure', ...permissions].map((key) => ({
        key,
        scope: '*',
        effect: 'allow' as const,
      })),
      avatarUrl: null,
      locale: 'en',
      houseLocale: 'en',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <FloatingLayer>
          <AppWindowsLayer />
        </FloatingLayer>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  useAppWindows.getState().clear();
  vi.mocked(fetchVendor).mockResolvedValue(vendorWith('running'));
});

describe('the app windows', () => {
  it('opens a page in a window once the cookie is laid', async () => {
    renderLayer();
    useAppWindows.getState().open(ZIGBEE);

    const page = await screen.findByTitle<HTMLIFrameElement>('Zigbee2MQTT');

    expect(page.getAttribute('src')).toBe(PATH);
    expect(openIngressSession).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reload Zigbee2MQTT' })).toBeTruthy();
  });

  it('hides a window as a tab with its page kept, and brings it back', async () => {
    renderLayer();
    useAppWindows.getState().open(ZIGBEE);

    const page = await screen.findByTitle('Zigbee2MQTT');

    fireEvent.click(screen.getByRole('button', { name: 'Hide Zigbee2MQTT' }));

    const tab = await screen.findByRole('button', { name: 'Show Zigbee2MQTT' });

    // Still the same iframe, in the page: hidden is only unseen.
    expect(screen.getByTitle('Zigbee2MQTT')).toBe(page);
    expect(page.closest('section')?.className).toContain('invisible');

    fireEvent.keyDown(tab, { key: 'ArrowLeft' });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Show Zigbee2MQTT' })).toBeNull();
    });
    expect(page.closest('section')?.className).not.toContain('invisible');
  });

  it('says the container is stopped, with Start only for who may start it', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(vendorWith('exited'));
    renderLayer();
    useAppWindows.getState().open(ZIGBEE);

    expect(await screen.findByText('Zigbee2MQTT is not running')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open container' })).toBeTruthy();
  });

  it('offers Start to who may control containers', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(vendorWith('exited'));
    renderLayer(['container:control']);
    useAppWindows.getState().open(ZIGBEE);

    expect(await screen.findByRole('button', { name: 'Start' })).toBeTruthy();
  });

  it('asks which page to close at the sixth, the oldest chosen', async () => {
    renderLayer();

    const { open } = useAppWindows.getState();

    for (let index = 1; index <= 6; index += 1) {
      open({
        name: `app-${String(index)}`,
        vendorId: 'zigbee2mqtt',
        title: `App ${String(index)}`,
        path: `/api/ingress/app-${String(index)}/`,
      });
    }

    const dialog = await screen.findByRole('dialog', { name: '5 pages are open' });

    expect(within(dialog).getByText('Close one to open App 6.')).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: /App 1/u }).checked).toBe(
      true,
    );

    fireEvent.click(within(dialog).getByRole('radio', { name: /App 3/u }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close and open' }));

    expect(useAppWindows.getState().windows.map((each) => each.name)).toEqual([
      'app-1',
      'app-2',
      'app-4',
      'app-5',
      'app-6',
    ]);
  });
});

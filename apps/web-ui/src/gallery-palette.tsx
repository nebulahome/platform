/**
 * The command palette with a sample house and every permission (docs: command palette, 13), to
 * check it without signing in: `pnpm preview:palette`, or `/palette.html` on the dev server.
 *
 * `?role=guest` drops the permissions to read-only, `?empty=1` starts with no recents, `?fail=1`
 * leaves the devices list failing. The palette is open on arrival; Ctrl+K closes and opens it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';

import type {
  ApiPackage,
  AutomationView,
  DashboardView,
  EntityView,
  SceneView,
} from '@nebulahome/contracts';
import { Toaster } from '@nebulahome/ui';

import '@/i18n/instance';

import { useSession } from '@/auth/session-store';
import { Sidebar } from '@/components/sidebar';
import { DASHBOARD_QUERY_KEYS } from '@/dashboard/api';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { PACKAGE_QUERY_KEYS } from '@/packages/api';
import { CommandPalette } from '@/palette/command-palette';
import { usePaletteStore } from '@/palette/palette-store';
import { usePaletteShortcut } from '@/palette/use-palette-shortcut';
import { SAMPLE_OWNER } from '@/testing/backup-samples';
import { aDevice, anArea, anEntity, aTag, aVendor } from '@/testing/fixtures';
import { aPackage } from '@/testing/package-fixtures';

import '@/styles/globals.css';

const params = new URLSearchParams(globalThis.location.search);

/** The sample house's entities. */
const ENTITIES: EntityView[] = [
  anEntity({
    entityId: 'light.light_strip',
    name: 'Light strip',
    source: 'tv-backlight',
    areaName: 'Living room',
    areaKey: 'living_room',
    capabilities: [
      { capability: 'on_off', params: {} },
      { capability: 'level', params: {} },
    ],
    state: { on_off: { isOn: true }, level: { level: 80 } },
  }),
  anEntity({
    entityId: 'light.island_lights',
    name: 'Island lights',
    source: 'kitchen-relay',
    areaName: 'Kitchen',
    areaKey: 'kitchen',
    capabilities: [
      { capability: 'on_off', params: {} },
      { capability: 'level', params: {} },
    ],
    state: { on_off: { isOn: true }, level: { level: 60 } },
  }),
  anEntity({
    entityId: 'sensor.light_level',
    name: 'Light level',
    source: 'hallway-motion',
    areaName: 'Hallway',
    areaKey: 'hallway',
    unitOfMeasurement: 'lx',
    deviceClass: 'illuminance',
    capabilities: [{ capability: 'sensor_numeric', params: {} }],
    state: { sensor_numeric: { value: 182 } },
  }),
  anEntity({
    entityId: 'light.hallway_light',
    name: 'Hallway light',
    source: 'hallway-dimmer',
    areaName: 'Hallway',
    areaKey: 'hallway',
    state: { on_off: { isOn: false } },
  }),
  anEntity({
    entityId: 'light.garden_lights',
    name: 'Garden lights',
    source: 'govee-garden',
    areaName: 'Garden',
    areaKey: 'garden',
    isAvailable: false,
  }),
  ...['Desk', 'Bedside', 'Porch', 'Stairs', 'Wardrobe', 'Mirror', 'Pantry'].map((name) =>
    anEntity({
      entityId: `light.${name.toLowerCase()}_light`,
      name: `${name} light`,
      source: 'hallway-dimmer',
      areaName: 'Hallway',
    }),
  ),
  anEntity({
    entityId: 'sensor.living_room_temperature',
    name: 'Living room temperature',
    source: 'tv-backlight',
    areaName: 'Living room',
    unitOfMeasurement: '°C',
    deviceClass: 'temperature',
    capabilities: [{ capability: 'sensor_numeric', params: {} }],
    state: { sensor_numeric: { value: 21.5 } },
  }),
];

const DEVICES = [
  ['tv-backlight', 'TV backlight', 'Govee', 'H6199', 'Living room'],
  ['kitchen-relay', 'Kitchen relay', 'Shelly', 'Plus 2PM', 'Kitchen'],
  ['hallway-motion', 'Hallway motion', 'Aqara', 'P1', 'Hallway'],
  ['hallway-dimmer', 'Hallway dimmer', 'Shelly', 'Dimmer 2', 'Hallway'],
  ['govee-garden', 'Govee H6008', 'Govee', 'H6008', 'Garden'],
].map(([id = '', name = '', manufacturer = '', model = '', areaName = '']) =>
  aDevice({ id, name, manufacturer, model, areaName, icon: null, entityIds: [] }),
);

const SCENES = [
  ['0193a5c2-7d1e-7b4a-9f3e-2c6d8a41b7e1', 'Evening lights', 'living_room', 6],
  ['0193a5c2-7d1e-7b4a-9f3e-2c6d8a41b7e2', 'All lights off', null, 14],
].map(
  ([id, name, areaKey, members]) =>
    ({
      id,
      key: String(name).toLowerCase().replaceAll(' ', '_'),
      name,
      icon: null,
      areaKey,
      rollbackOnPartialFailure: false,
      members: Array.from({ length: Number(members) }, () => ({})),
      unresolvedMembers: [],
    }) as unknown as SceneView,
);

const AUTOMATIONS = [
  ['0193a5c2-7d1e-7b4a-9f3e-2c6d8a41b7f1', 'Hallway light at sunset', true, []],
  ['0193a5c2-7d1e-7b4a-9f3e-2c6d8a41b7f2', 'Lights off at midnight', false, ['light.gone']],
].map(
  ([id, name, isEnabled, missingEntities]) =>
    ({
      id,
      key: String(name).toLowerCase(),
      name,
      description: '',
      isEnabled,
      missingEntities,
      lastTriggeredAt: null,
      lastRun: null,
    }) as unknown as AutomationView,
);

const DASHBOARDS = [
  { id: '0193a5c2-7d1e-7b4a-9f3e-2c6d8a41b7a1', name: 'Lights', icon: null },
] as unknown as DashboardView[];

const PACKAGES: ApiPackage[] = [
  aPackage({ id: 'energy', name: 'Energy', state: 'running', category: 'energy' }),
];

/**
 * A cache with the sample house in it, so nothing is fetched.
 *
 * @returns The cache.
 */
function sampleCache(): QueryClient {
  const cache = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });

  cache.setQueryData(LIBRARY_QUERY_KEYS.entities, ENTITIES);

  if (params.get('fail') !== '1') {
    cache.setQueryData(LIBRARY_QUERY_KEYS.devices, DEVICES);
  }

  cache.setQueryData(LIBRARY_QUERY_KEYS.areas, [
    anArea('living_room', 'room', null),
    anArea('kitchen', 'room', null),
    anArea('hallway', 'room', null),
  ]);
  cache.setQueryData(LIBRARY_QUERY_KEYS.tags, [
    aTag('outdoor', { name: 'Outdoor', icon: null, deviceCount: 6, entityCount: 14 }),
  ]);
  cache.setQueryData(LIBRARY_QUERY_KEYS.scenes, SCENES);
  cache.setQueryData(LIBRARY_QUERY_KEYS.automations, AUTOMATIONS);
  cache.setQueryData(LIBRARY_QUERY_KEYS.vendors, [
    aVendor({ deviceCount: 14, logo: undefined }),
    aVendor({ id: 'govee', name: 'Govee', deviceCount: 2, logo: undefined }),
  ]);
  cache.setQueryData(DASHBOARD_QUERY_KEYS.dashboards, DASHBOARDS);
  cache.setQueryData(PACKAGE_QUERY_KEYS.list, PACKAGES);

  return cache;
}

useSession.setState({
  user:
    params.get('role') === 'guest'
      ? {
          ...SAMPLE_OWNER,
          permissions: SAMPLE_OWNER.permissions.filter((grant) => grant.key.endsWith(':read')),
        }
      : SAMPLE_OWNER,
});

if (params.get('empty') !== '1') {
  try {
    globalThis.localStorage.setItem(
      `nebula.palette.recents.${SAMPLE_OWNER.id}`,
      JSON.stringify([
        'entities:light.island_lights',
        `scenes:${SCENES[0]?.id ?? ''}`,
        `automations:${AUTOMATIONS[0]?.id ?? ''}`,
        'integrations:shelly',
      ]),
    );
  } catch {
    // No storage: no recents.
  }
}

/**
 * Where the sample app is: a line at the foot, to see where a choice went.
 *
 * @returns The line.
 */
function Address() {
  const location = useLocation();

  return (
    <p className="font-mono text-caption text-foreground-subtle">
      {location.pathname}
      {location.search}
    </p>
  );
}

/**
 * The sample app: the sidebar, a page, and the palette.
 *
 * @returns The app.
 */
function PaletteGallery() {
  usePaletteShortcut();

  useEffect(() => {
    usePaletteStore.getState().open();
  }, []);

  return (
    <div className="relative flex h-screen overflow-hidden bg-canvas text-foreground">
      <Sidebar />
      <main className="flex grow flex-col gap-4 p-8">
        <h1 className="text-display font-medium">Devices</h1>
        <div className="grid grid-cols-3 gap-4">
          {DEVICES.map((device) => (
            <div key={device.id} className="h-28 rounded-card border border-border bg-surface p-4">
              {device.name}
            </div>
          ))}
        </div>
        <Address />
      </main>
      <CommandPalette />
    </div>
  );
}

const root = globalThis.document.getElementById('root');

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={sampleCache()}>
        <MemoryRouter initialEntries={['/devices']}>
          <PaletteGallery />
        </MemoryRouter>
      </QueryClientProvider>
      <Toaster />
    </StrictMode>,
  );
}

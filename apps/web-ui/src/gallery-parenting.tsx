/**
 * The gallery's samples of a device made of others: an inverter with its EPS output and dry
 * contact on the integration's Devices tab, the "Parent of" and
 * "Child of" sections of their pages, and the removal dialog as it takes the parts, as it takes a
 * device alone, and as an alias blocks it. Development only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';

import {
  discoveredDeviceSchema,
  parseEntityId,
  type DeviceRemoval,
  type DeviceView,
} from '@nebulahome/contracts';
import { Button } from '@nebulahome/ui';

import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { LINK_QUERY_KEYS } from '@/library/links-api';
import { FamilySection } from '@/routes/library/device/device-page';
import { DeviceRemovalDialog } from '@/routes/library/device-removal';
import { VendorDevicesTab } from '@/routes/library/vendor-devices-tab';
import { VendorFound } from '@/routes/library/vendor-found';
import { aDevice } from '@/testing/fixtures';
import { VENDORS } from '@/testing/printer-fixtures';

const [SOLAX] = VENDORS.map((vendor) => ({ ...vendor, id: 'solax', name: 'SolaX Power' }));

/**
 * A SolaX device.
 *
 * @param fields - Its id, name, model and what else to set.
 * @returns The device.
 */
function solax(fields: Partial<DeviceView> & Pick<DeviceView, 'id' | 'name'>): DeviceView {
  return aDevice({
    kind: 'solax/inverter',
    vendorId: 'solax',
    icon: null,
    state: 'running',
    lastError: null,
    lastUpdatedAt: new Date(Date.now() - 2000),
    areaName: 'Garage',
    ...fields,
  });
}

const INVERTER = solax({
  id: 'inverter-garage',
  name: 'Inverter garage',
  model: 'X1-Hybrid G4',
  childIds: ['inverter-garage-eps', 'inverter-garage-dry'],
});
const EPS = solax({
  id: 'inverter-garage-eps',
  name: 'X1-Hybrid G4 EPS',
  model: 'EPS · G4, 1 phase',
  parentId: INVERTER.id,
});
const DRY = solax({
  id: 'inverter-garage-dry',
  name: 'X1-Hybrid G4 Dry contact',
  model: 'Dry contact',
  parentId: INVERTER.id,
});
const DEVICES = [
  solax({ id: 'balcony-panels', name: 'Balcony panels', model: 'X1-Micro 2in1' }),
  INVERTER,
  EPS,
  DRY,
  solax({ id: 'wallbox', name: 'Wallbox', model: 'X1-HAC 7 kW' }),
];

/**
 * A SolaX inverter found on the network.
 *
 * @param fields - Its id, model and address, and when it was set aside, if it was.
 * @param fields.id - Its id.
 * @param fields.model - Its model.
 * @param fields.address - Where it answered.
 * @param fields.dismissedAt - When it was set aside.
 * @returns The candidate.
 */
function found(fields: { id: string; model: string; address: string; dismissedAt?: Date }) {
  return discoveredDeviceSchema.parse({
    id: fields.id,
    vendorId: 'solax',
    driverId: 'inverter',
    kind: 'solax/inverter',
    source: 'modbus',
    address: fields.address,
    externalId: `${fields.model.replaceAll(' ', '')}0451`,
    name: null,
    model: fields.model,
    modelChoices: [fields.model],
    modelCode: null,
    swVersion: null,
    transportConfig: {},
    isDismissed: fields.dismissedAt !== undefined,
    dismissedAt: fields.dismissedAt ?? null,
    firstSeenAt: new Date(Date.now() - 600_000),
    lastSeenAt: new Date(Date.now() - 240_000),
  });
}

/** What removing the inverter, the wallbox or the inverter read by an alias would do. */
const REMOVALS: Readonly<Record<string, DeviceRemoval>> = {
  [INVERTER.id]: {
    devices: [
      {
        id: INVERTER.id,
        name: INVERTER.name,
        model: INVERTER.model,
        entities: 112,
        parentId: null,
      },
      { id: EPS.id, name: EPS.name, model: 'EPS', entities: 8, parentId: INVERTER.id },
      { id: DRY.id, name: DRY.name, model: 'Dry contact', entities: 10, parentId: INVERTER.id },
    ],
    usedBy: {
      automations: [
        { id: 'battery-night-charge', name: 'Battery night charge' },
        { id: 'export-cap', name: 'Export cap at noon' },
      ],
      scenes: [{ id: 'away', name: 'Away' }],
      dashboards: [
        { id: 'home', name: 'Home' },
        { id: 'energy', name: 'Energy' },
      ],
      aliases: [],
    },
    blockedBy: { aliases: [] },
  },
  wallbox: {
    devices: [
      { id: 'wallbox', name: 'Wallbox', model: 'X1-HAC 7 kW', entities: 4, parentId: null },
    ],
    usedBy: {
      automations: [{ id: 'charge-at-night', name: 'Charge at night' }],
      scenes: [],
      dashboards: [{ id: 'garage', name: 'Garage' }],
      aliases: [],
    },
    blockedBy: { aliases: [] },
  },
  blocked: {
    devices: [
      { id: 'blocked', name: INVERTER.name, model: INVERTER.model, entities: 112, parentId: null },
      { id: EPS.id, name: EPS.name, model: 'EPS', entities: 8, parentId: 'blocked' },
    ],
    usedBy: { automations: [], scenes: [], dashboards: [], aliases: [] },
    blockedBy: {
      aliases: [
        {
          id: 'house-battery',
          name: 'House battery',
          reads: [
            {
              entityId: parseEntityId('sensor.inverter_garage_battery_level'),
              name: 'Battery level',
              deviceName: INVERTER.name,
            },
            {
              entityId: parseEntityId('sensor.inverter_garage_eps_power'),
              name: 'EPS power',
              deviceName: EPS.name,
            },
          ],
        },
      ],
    },
  },
};

/**
 * A cache holding the devices and each removal's answer, so nothing is asked of a server.
 *
 * @returns The cache.
 */
function parentingCache(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });

  client.setQueryData(LIBRARY_QUERY_KEYS.devices, DEVICES);
  client.setQueryData(
    [...LINK_QUERY_KEYS.found, 'solax'],
    [
      found({ id: 'aaaaaaaaaaaaaaa1', model: 'X3-Mic G2', address: '192.168.1.64' }),
      found({
        id: 'aaaaaaaaaaaaaaa2',
        model: 'X1-Mini G4',
        address: '192.168.1.71',
        dismissedAt: new Date('2026-11-12T10:00:00Z'),
      }),
    ],
  );

  for (const [id, removal] of Object.entries(REMOVALS)) {
    client.setQueryData([...LIBRARY_QUERY_KEYS.devices, 'removal', id], removal);
  }

  return client;
}

/**
 * The samples.
 *
 * @returns The Devices tab, the two sections, and three ways to open the removal dialog.
 */
export function DeviceParentingSamples() {
  const [cache] = useState(parentingCache);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  return (
    <QueryClientProvider client={cache}>
      <div className="flex w-full flex-col gap-6">
        <MemoryRouter initialEntries={['/integrations/solax']}>
          {SOLAX === undefined ? null : (
            <VendorDevicesTab vendor={SOLAX} devices={DEVICES} onConfigure={() => undefined} />
          )}
        </MemoryRouter>
        <MemoryRouter>
          {SOLAX === undefined ? null : (
            <VendorFound
              vendor={SOLAX}
              canAdopt
              onOpenDevices={() => undefined}
              onAdopt={() => undefined}
            />
          )}
        </MemoryRouter>
        <MemoryRouter>
          <FamilySection parent={undefined} parts={[EPS, DRY]} icons={new Map()} />
          <FamilySection parent={INVERTER} parts={[]} icons={new Map()} />
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { id: INVERTER.id, name: INVERTER.name, label: 'Remove the inverter' },
              { id: 'wallbox', name: 'Wallbox', label: 'Remove the wallbox' },
              { id: 'blocked', name: INVERTER.name, label: 'Remove one an alias reads' },
            ].map((sample) => (
              <Button
                key={sample.id}
                variant="ghost"
                onClick={() => {
                  setRemoving({ id: sample.id, name: sample.name });
                }}
              >
                {sample.label}
              </Button>
            ))}
          </div>
          <DeviceRemovalDialog
            device={removing}
            isBusy={false}
            onCancel={() => {
              setRemoving(null);
            }}
            onConfirm={() => {
              setRemoving(null);
            }}
          />
        </MemoryRouter>
      </div>
    </QueryClientProvider>
  );
}

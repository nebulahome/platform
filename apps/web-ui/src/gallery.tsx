/**
 * Every shared component, every variant, both themes, on one page.
 *
 * Served by `gallery.html` in development and absent from the build. It is not a route: the
 * application's router is about a home, and a page about the design system is not part of it.
 *
 * What it is for is the thing a design system otherwise has no answer to - somebody changes the
 * badge, and the six settings panels that use it are not open. Here they all are, next to each
 * other, in both themes, so the change is looked at before it lands.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';

import {
  composeEntityId,
  TAG_COLORS,
  type IntegrationKind,
  type IntegrationVendorView,
  type TagColor,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Badge,
  DetailHero,
  FactGrid,
  FilterChips,
  HealthCard,
  HealthStrip,
  HERO_BACK,
  HeroFact,
  HeroMark,
  HoldButton,
  ListRow,
  MenuButton,
  Note,
  OverflowMenu,
  RadioGroup,
  RowList,
  ROW_LIST_MORE,
  Section as KitSection,
  TableFooter,
  Tabs,
  type BadgeTone,
  Button,
  ColorSwatches,
  IconButton,
  Modal,
  Panel,
  PanelNote,
  PanelRow,
  Pill,
  Segmented,
  SetupSteps,
  SelectField,
  Slider,
  Stepper,
  Switch,
  TagChip,
  TextField,
  toast,
  Toaster,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { CatalogueChip, CatalogueItem, CatalogueStat } from '@/components/catalogue/catalogue-item';
import { CatalogueRow, Installs, Stars } from '@/components/catalogue/catalogue-row';
import { ListingLogo } from '@/components/catalogue/listing-logo';
import { CheckIcon, CopyIcon, WarningIcon } from '@/components/icons';
import { LogViewer } from '@/components/log-viewer';
import { PasswordField } from '@/components/password-field';
import { Sidebar } from '@/components/sidebar';
import { CONTAINER_QUERY_KEYS } from '@/containers/api';
import { BrokerGallery } from '@/gallery-brokers';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { capabilityStateOf } from '@/library/entity-control';
import { readingOf } from '@/library/entity-reading';
import { AuthLayout } from '@/routes/auth-layout';
import { EnergyCard } from '@/routes/dashboard/cards/energy/energy-card';
import {
  FIRST_RUN_STEP_COUNT,
  firstRunHeading,
  firstRunSteps,
  FirstRunForm,
  useFirstRunStep,
} from '@/routes/first-run';
import { AliasFormulaField } from '@/routes/library/alias-formula-field';
import { AutomationEditor } from '@/routes/library/automation-editor';
import { rowsOf } from '@/routes/library/broker-matter/matter-rows';
import { JoinAnimation } from '@/routes/library/broker-matter/matter-steps';
import { NetworkGraph } from '@/routes/library/broker-matter/network-graph';
import { ModbusTemplatePage } from '@/routes/library/broker-modbus/template-editor/template-page';
import { ModbusBrokerPage } from '@/routes/library/broker-modbus-page';
import { DeviceDialog } from '@/routes/library/device-dialog';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { ControlPanel } from '@/routes/library/entity/controls/control-panel';
import { EntityField } from '@/routes/library/entity-field';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { WaysTag } from '@/routes/library/transport-marks';
import { ListenerCallout, PassedOverPanel } from '@/routes/library/vendor-hearing';
import { PairingButton, PairingPanel, type PairingState } from '@/routes/library/vendor-pairing';
import { BackupSettings } from '@/routes/settings/backup-settings';
import { MaintenanceSettings } from '@/routes/settings/maintenance-settings';
import { backupSampleCache, SAMPLE_OWNER } from '@/testing/backup-samples';
import { energySample, energySampleCache } from '@/testing/energy-samples';
import { aDevice, anArea, anEntity } from '@/testing/fixtures';
import { maintenanceSampleCache } from '@/testing/maintenance-samples';
import {
  matterSampleCache,
  MATTER_SAMPLE_DEVICES,
  MATTER_SAMPLE_NETWORK,
  MATTER_SAMPLE_NODES,
} from '@/testing/matter-samples';
import { MODBUS_SAMPLE_RELAY_ID, modbusSampleCache } from '@/testing/modbus-samples';

import {
  AliasEditorSample,
  AutomationEditorSample,
  AutomationsListSample,
  EmptyLibrarySample,
  ScenePageSample,
} from './gallery-automations';

import './styles/globals.css';

/**
 * One of every kind of entity the contract describes, for the controls section: the bundles in
 * the repository ship only some of them, and a control nobody can open is a control nobody checks.
 */
const CONTROL_SPECIMENS = [
  anEntity({
    entityId: 'light.strip',
    name: 'Colour strip',
    capabilities: [
      { capability: 'on_off', params: {} },
      { capability: 'level', params: { hasTransition: true } },
      { capability: 'color_hs', params: {} },
      { capability: 'color_temp', params: { minMireds: 153, maxMireds: 500 } },
    ],
    state: {
      on_off: { isOn: true },
      level: { level: 70 },
      color_hs: { hue: 275, saturation: 80 },
      color_temp: { mireds: 300 },
    },
  }),
  anEntity({
    entityId: 'cover.study_blind',
    name: 'Study blind',
    capabilities: [{ capability: 'cover', params: { hasPosition: true, hasTilt: true } }],
    state: { cover: { position: 40, tilt: 20, motion: 'opening' } },
  }),
  anEntity({
    entityId: 'lock.front_door',
    name: 'Front door',
    capabilities: [{ capability: 'lock', params: { hasCode: true } }],
    state: { lock: { lockState: 'jammed' } },
  }),
  anEntity({
    entityId: 'climate.hall',
    name: 'Hall thermostat',
    capabilities: [
      {
        capability: 'thermostat',
        params: {
          supportedModes: ['off', 'heat', 'cool', 'auto'],
          minTemperature: 7,
          maxTemperature: 30,
          temperatureStep: 0.5,
        },
      },
    ],
    state: {
      thermostat: {
        currentTemperature: 19.4,
        targetTemperature: 21,
        mode: 'heat',
        action: 'heating',
        humidity: 48,
      },
    },
  }),
  anEntity({
    entityId: 'media_player.lounge',
    name: 'Lounge speaker',
    capabilities: [
      {
        capability: 'media_player',
        params: { supportedSources: ['Radio', 'Line in'], hasSeek: true, hasVolume: true },
      },
    ],
    state: {
      media_player: {
        playback: 'playing',
        volume: 35,
        isMuted: false,
        source: 'Radio',
        mediaTitle: 'Morning news',
        mediaArtist: 'Radio 3',
        mediaDurationSeconds: 1800,
        mediaPositionSeconds: 420,
      },
    },
  }),
  anEntity({
    entityId: 'camera.porch',
    name: 'Porch camera',
    capabilities: [
      { capability: 'camera', params: { hasSnapshot: true, hasStream: true, hasRecording: true } },
    ],
    state: { camera: { isStreamAvailable: true, isRecording: false } },
  }),
  anEntity({
    entityId: 'sensor.plug_power',
    name: 'Plug power',
    deviceClass: 'power',
    unitOfMeasurement: 'W',
    capabilities: [{ capability: 'sensor_numeric', params: {} }],
    state: { sensor_numeric: { value: 42.5 } },
  }),
];

/**
 * A house to pick from, for the picker section: two floors, three rooms, a device with many
 * entities and one with few, an alias and something in no room. Laid into a query cache that
 * never goes stale, so the picker reads it without a session.
 *
 * @returns The cache, filled.
 */
function housePickerCache(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const meter = aDevice({ id: 'shelly-em', name: 'Energy meter' });
  const lamp = aDevice({ id: 'govee-desk', name: 'Desk lamp' });
  const entities = [
    ...['Power', 'Voltage', 'Current', 'Energy', 'Frequency', 'Power factor'].map((name) =>
      anEntity({
        entityId: `sensor.em_${name.toLowerCase().replaceAll(' ', '_')}`,
        name,
        source: 'shelly-em',
        areaKey: 'kitchen',
        areaName: 'Kitchen',
        deviceClass: name.toLowerCase().replaceAll(' ', '_'),
        capabilities: [{ capability: 'sensor_numeric', params: {} }],
        state: { sensor_numeric: { value: 230 } },
      }),
    ),
    anEntity({
      entityId: 'light.desk',
      name: 'Desk lamp',
      source: 'govee-desk',
      areaKey: 'study',
      areaName: 'Study',
      capabilities: [
        { capability: 'on_off', params: {} },
        { capability: 'level', params: {} },
      ],
      state: { on_off: { isOn: true }, level: { level: 60 } },
    }),
    anEntity({
      entityId: 'alias.average_temperature',
      name: 'Average temperature',
      source: 'derived',
      areaKey: 'hall',
      areaName: 'Hall',
      deviceClass: 'temperature',
      capabilities: [{ capability: 'sensor_numeric', params: {} }],
      state: { sensor_numeric: { value: 21.4 } },
    }),
    anEntity({ entityId: 'switch.garage_relay', name: 'Garage relay' }),
  ];

  client.setQueryData(LIBRARY_QUERY_KEYS.entities, entities);
  client.setQueryData(LIBRARY_QUERY_KEYS.devices, [meter, lamp, aDevice()]);
  client.setQueryData(LIBRARY_QUERY_KEYS.areas, [
    anArea('home', 'house', null),
    anArea('ground_floor', 'floor', 'home', { sortOrder: 1 }),
    anArea('first_floor', 'floor', 'home', { sortOrder: 2 }),
    anArea('kitchen', 'room', 'ground_floor'),
    anArea('hall', 'room', 'ground_floor'),
    anArea('study', 'room', 'first_floor'),
  ]);

  return client;
}

/** What a Shelly driver asks: the address, and a password when the device has one. */
const SHELLY_SETUP: IntegrationKind['setup'] = {
  transport: {
    constants: {},
    fields: [
      { key: 'host', type: 'text', label: 'Address', isRequired: true, maxLength: 256 },
      { key: 'password', type: 'secret', label: 'Password', isRequired: false, maxLength: 512 },
    ],
  },
  options: { constants: {}, fields: [] },
};

/**
 * A driver of the sample vendor.
 *
 * @param driverId - Its id.
 * @param name - Its name.
 * @param models - The models it drives.
 * @returns The driver, as the catalogue lists it.
 */
function shellyDriver(driverId: string, name: string, models: string[]): IntegrationKind {
  return {
    id: `shelly/${driverId}`,
    vendorId: 'shelly',
    driverId,
    name,
    transport: 'shelly/rpc',
    models,
    defaultIcon: 'relay',
    setup: SHELLY_SETUP,
    webPagePort: 80,
  };
}

/** A vendor with enough models, over enough drivers, that the add dialog lists and searches. */
const SAMPLE_VENDOR: IntegrationVendorView = {
  id: 'shelly',
  version: '1.0.0',
  name: 'Shelly',
  color: '#3B9DFF',
  origin: 'development',
  install: null,
  hasCode: false,
  logoPadding: 0,
  internetRequired: false,
  transports: ['shelly/rpc'],
  wires: ['http'],
  discoverySources: ['mdns'],
  adoption: 'owner',
  twins: [],
  pairing: null,
  listener: null,
  passedOver: [],
  requires: { packages: {}, services: [] },
  packageProblems: [],
  account: null,
  accounts: [],
  needsAccount: false,
  needsPackage: false,
  update: null,
  containers: [],
  containerStatuses: [],
  setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
  drivers: [
    shellyDriver('switch', 'Relay', ['1 Gen3', '1 Mini Gen3', '1 Gen4', '1 Mini Gen4']),
    shellyDriver('switch-pm', 'Relay with power metering', [
      '1PM Gen3',
      '1PM Mini Gen3',
      '1PM Gen4',
      '1PM Mini Gen4',
    ]),
    shellyDriver('plug', 'Plug', ['Plug S Gen3', 'Outdoor Plug S Gen3', 'Plus Plug S']),
    shellyDriver('dimmer-pm', 'Dimmer', ['Dimmer Gen3', 'Dimmer 0/1-10V PM Gen3']),
  ],
  needsSetup: false,
  isConfigured: true,
  transportConfig: {},
  options: {},
  configuredAt: null,
  deviceCount: 3,
  entityCount: 21,
};

/** Zigbee2MQTT, running and heard of nothing, with two devices it passed over. */
const SILENT_ZIGBEE: IntegrationVendorView = {
  ...SAMPLE_VENDOR,
  id: 'zigbee2mqtt',
  name: 'Zigbee2MQTT',
  adoption: 'automatic',
  pairing: {
    driverId: 'bridge',
    openObjectId: 'permit_join',
    closeObjectId: 'permit_join_stop',
    stateObjectId: 'pairing',
  },
  listener: {
    level: 'warning',
    message:
      'NebulaHome is connected to its MQTT broker at mqtt://nebulahome:1884 but has heard nothing from Zigbee2MQTT there. Is its container running, and connected to this broker? Its log says which broker it tried.',
    at: new Date(),
  },
  passedOver: [
    {
      id: '0x00158d0001a2b3c4',
      name: 'Aqara MCCGQ11LM',
      model: 'MCCGQ11LM',
      reason: 'Zigbee2MQTT is still pairing it',
      heardAt: new Date(Date.now() - 40_000),
    },
    {
      id: '0x00124b0021aabbdd',
      name: 'Kitchen sensor',
      model: 'TS0601',
      reason: 'Zigbee2MQTT does not support this model yet',
      heardAt: new Date(Date.now() - 600_000),
    },
  ],
  containerStatuses: [
    {
      ownerKind: 'vendor',
      vendorId: 'zigbee2mqtt',
      dependencyId: 'zigbee2mqtt',
      containerName: 'nebulahome-zigbee2mqtt',
      state: 'running',
      version: '2.14.1',
      error: null,
    },
  ],
};

/**
 * Pairing, open for another three minutes, or shut.
 *
 * @param isOpen - Whether it is open.
 * @returns Where it stands.
 */
function samplePairing(isOpen: boolean): PairingState {
  return {
    entityId: composeEntityId('sensor', 'zigbee2mqtt', 'pairing'),
    isOpen,
    closesAt: isOpen ? Date.now() + 194_000 : null,
    canPress: true,
    reason: null,
    /**
     * Does nothing: the gallery shows the button, it does not pair.
     *
     * @returns Nothing.
     */
    open: () => undefined,
    /**
     * Does nothing either.
     *
     * @returns Nothing.
     */
    close: () => undefined,
    isBusy: false,
    problem: null,
  };
}

/** Lines of a Zigbee2MQTT that starts, fails to reach its adapter, and tries again. */
const SAMPLE_LOG = [
  '\u001b[32m[2026-09-28 13:40:01] info\u001b[39m: \tz2m: Logging to console',
  '\u001b[32m[2026-09-28 13:40:01] info\u001b[39m: \tz2m: Starting Zigbee2MQTT version 2.14.1',
  '\u001b[33m[2026-09-28 13:40:02] warning\u001b[39m: \tz2m: Adapter discovery is off',
  '\u001b[31m[2026-09-28 13:40:07] error\u001b[39m: \tz2m: Error while starting zigbee-herdsman',
  '{"level":50,"time":1790589607000,"msg":"Failed to connect to the adapter","path":"tcp://192.168.1.50:6638","retryInMs":5000}',
  '\u001b[32m[2026-09-28 13:40:12] info\u001b[39m: \tz2m: Connected to MQTT server mqtt://nebulahome:1884',
  '[2026-09-28 13:40:12] debug: \tzh:controller: Received network address response from 0x00158d0001a2b3c4 with a rather long line that has to wrap when the viewer wraps long lines, and scroll when it does not',
].map((text, index) => ({
  at: new Date(Date.parse('2026-09-28T11:40:01.000Z') + index * 2345),
  stream: index === 3 ? ('stderr' as const) : ('stdout' as const),
  text,
}));

/** The cache the log viewer's sample is read into. */
const LOG_CACHE = new QueryClient();

/** The cache the linked tags read their vendors from. */
const MATTER_GALLERY_CACHE = matterSampleCache();

/** The cache the Modbus broker's pages read from. */
const MODBUS_GALLERY_CACHE = modbusSampleCache();

/** The Modbus broker's tabs, each drawn as its page shows it. */
const MODBUS_TABS = ['overview', 'devices', 'discovery', 'templates'] as const;

/** The Matter fabric's devices, as the broker's tabs list them. */
const MATTER_GALLERY_ROWS = rowsOf(MATTER_SAMPLE_NODES, MATTER_SAMPLE_DEVICES, 'bridge');

/**
 * The Matter network map over the sample fabric, its icons read from the sample cache.
 *
 * @returns The map.
 */
function GalleryMatterNetwork() {
  const icons = useCatalogueIcons(
    MATTER_GALLERY_ROWS.flatMap((row) => [row, ...row.children]).map(
      (row) => row.view?.icon ?? null,
    ),
  );

  return <NetworkGraph network={MATTER_SAMPLE_NETWORK} rows={MATTER_GALLERY_ROWS} icons={icons} />;
}

/** A device reached through Shelly and Matter. */
const GALLERY_WAYS = [
  { vendorId: 'shelly', transport: 'shelly/rpc' },
  { vendorId: 'shelly', transport: 'matter' },
];

/** The cache the Backup page reads from. */
const BACKUP_CACHE = backupSampleCache();

/** The cache the Maintenance page reads from. */
const MAINTENANCE_CACHE = maintenanceSampleCache();

// The Backup page shows its controls to whoever may use them: the gallery's visitor is the owner.
useSession.setState({ user: SAMPLE_OWNER });

/**
 * A list of so many things, for a count: the rail reads only how long a list is.
 *
 * @param length - How many.
 * @param item - What each one is.
 * @returns The list.
 */
function listOf<TItem>(length: number, item: TItem): readonly TItem[] {
  return Array.from({ length }, () => item);
}

/** The cache the rail's counts are read from: the house of the boards. */
const RAIL_CACHE = (() => {
  const cache = new QueryClient();

  cache.setQueryData(LIBRARY_QUERY_KEYS.automations, listOf(148, {}));
  cache.setQueryData(LIBRARY_QUERY_KEYS.scenes, listOf(52, {}));
  cache.setQueryData(LIBRARY_QUERY_KEYS.aliases, listOf(67, {}));
  cache.setQueryData(LIBRARY_QUERY_KEYS.devices, listOf(64, {}));
  cache.setQueryData(LIBRARY_QUERY_KEYS.areas, listOf(9, { kind: 'room' }));
  cache.setQueryData(LIBRARY_QUERY_KEYS.tags, listOf(5, {}));
  cache.setQueryData(LIBRARY_QUERY_KEYS.vendors, listOf(9, {}));
  cache.setQueryData(CONTAINER_QUERY_KEYS.list, { items: listOf(6, {}) });

  return cache;
})();

/** The cache the energy samples' days are read from. */
const ENERGY_CACHE = energySampleCache();

/** Seven cards, every style and size among them: the picture the card is drawn after, a night, a sale, a flat roof, a grid alone, and the American house large and square. */
const ENERGY_SAMPLES = [
  {
    title: 'Charging from the panels',
    sample: energySample(
      'day',
      { solar: 11_100, battery: -8300, level: 85, grid: 0 },
      ENERGY_CACHE,
      'tall',
    ),
  },
  {
    title: 'Night, on the battery, the American house',
    sample: energySample(
      'night',
      { solar: 0, battery: 620, level: 41, grid: 380 },
      ENERGY_CACHE,
      'tall',
      'american',
    ),
  },
  {
    title: 'Selling, no battery',
    sample: energySample(
      'sale',
      { solar: 5200, battery: null, level: null, grid: -3100 },
      ENERGY_CACHE,
      'large',
      'european',
    ),
  },
  {
    title: 'A flat roof, exporting',
    sample: energySample(
      'flat',
      { solar: 7400, battery: 0, level: 100, grid: -4200 },
      ENERGY_CACHE,
      'tall',
      'arabic',
    ),
  },
  {
    title: 'Grid only, square',
    sample: energySample(
      'grid',
      { solar: null, battery: null, level: null, grid: 750 },
      ENERGY_CACHE,
      'square',
    ),
  },
  {
    title: 'The American house, large, charging',
    sample: energySample(
      'american_large',
      { solar: 6400, battery: -2100, level: 62, grid: 0 },
      ENERGY_CACHE,
      'large',
      'american',
    ),
  },
  {
    title: 'The American house, square, the day beside it',
    sample: energySample(
      'american_square',
      { solar: 3200, battery: 0, level: 100, grid: -1400 },
      ENERGY_CACHE,
      'square',
      'american',
    ),
  },
] as const;

/** What a section needs. */
type SectionProps = {
  /** What it is about. */
  readonly title: string;

  /** A line saying what the reader should notice. */
  readonly note: string;

  /** The specimens. */
  readonly children: ReactNode;
};

/**
 * One group of specimens.
 *
 * @param props - See {@link SectionProps}.
 * @returns The section.
 */
function Section(props: SectionProps) {
  const { title, note, children } = props;

  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-headline-sm font-medium">{title}</h2>
        <p className="text-caption text-foreground-subtle">{note}</p>
      </div>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

const TONES: readonly BadgeTone[] = ['neutral', 'accent', 'success', 'warning', 'danger'];

/**
 * The first run, framed as the setup screen frames it, with a switch between its two steps.
 *
 * @returns The sample.
 */
function FirstRunSample() {
  const step = useFirstRunStep((state) => state.step);
  const setStep = useFirstRunStep((state) => state.setStep);
  const heading = firstRunHeading(step);

  return (
    <div className="flex w-full flex-col gap-3">
      <Segmented
        label="Step"
        options={firstRunSteps().map((entry, index) => ({
          value: String(index),
          label: entry.name,
        }))}
        value={String(step)}
        onChange={(value) => {
          setStep(Number(value));
        }}
      />
      <div
        data-sample="/setup"
        className="relative h-[62rem] w-full overflow-hidden rounded-panel border border-border"
      >
        <AuthLayout
          isWide
          eyebrow={`Step ${String(step + 1)} of ${String(FIRST_RUN_STEP_COUNT)}`}
          title={heading?.title ?? ''}
          subtitle={heading?.subtitle ?? ''}
          steps={<SetupSteps steps={firstRunSteps()} current={step} />}
        >
          <FirstRunForm />
        </AuthLayout>
      </div>
    </div>
  );
}

/** What a sample's choices do: nothing, they are shown rather than used. */
function doNothing(): void {
  // A gallery choice changes nothing.
}

/**
 * A detail page's top and body, drawn from the kit alone: what every page about one thing opens
 * with.
 *
 * @returns The sample.
 */
function DetailPageSample() {
  const [tab, setTab] = useState<'overview' | 'devices' | 'configuration'>('overview');
  const [page, setPage] = useState(1);

  return (
    <div className="flex w-full flex-col gap-8">
      <DetailHero
        back={
          <a href="#integrations" className={HERO_BACK}>
            <AppIcon id="chevron-left" size={14} />
            Integrations
          </a>
        }
        mark={<HeroMark className="text-primary">S</HeroMark>}
        title="Shelly"
        description="Relays, dimmers and meters, Gen1 to Gen4, on the local network."
        facts={
          <>
            <Pill tone="success">Running</Pill>
            <HeroFact>v2.2.0</HeroFact>
            <HeroFact icon="network">Local network</HeroFact>
          </>
        }
        actions={
          <>
            <Button variant="ghost">
              <AppIcon id="radio" size={16} />
              Discover devices
            </Button>
            <OverflowMenu
              items={[
                { label: 'Reinstall', icon: 'rotate-ccw', onSelect: doNothing },
                { label: 'Remove', icon: 'trash-2', tone: 'danger', onSelect: doNothing },
              ]}
            />
          </>
        }
        tabs={
          <Tabs
            label="Integration"
            idPrefix="gallery-vendor"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'overview', label: 'Overview' },
              { id: 'devices', label: 'Devices', count: 2 },
              { id: 'configuration', label: 'Configuration' },
            ]}
          />
        }
      />

      <HealthStrip>
        <HealthCard label="Runtime" tone="success" value="Running" detail="Loaded and answering" />
        <HealthCard label="Connection" tone="success" value="Local network" detail="mDNS" />
        <HealthCard
          label="Devices"
          tone="info"
          value="2 of 2 reporting"
          detail="5 more found on the network"
          action={{ icon: 'eye', verb: 'Review', onSelect: doNothing }}
        />
        <HealthCard
          label="Updates"
          tone="danger"
          value="Failed"
          detail="Exited with code 1"
          action={{ icon: 'list', verb: 'Open the log', onSelect: doNothing }}
        />
      </HealthStrip>

      <KitSection title="Devices">
        <RowList>
          <ListRow
            icon={<AppIcon id="zap" size={18} />}
            title="Kitchen relay"
            subtitle="Plus 2PM · Kitchen"
            meta="4 entities"
            trailing={<Pill tone="cyan">Update ready</Pill>}
            hasChevron
            wrap={(className, parts) => (
              <a href="#kitchen" className={className}>
                {parts}
              </a>
            )}
          />
          <ListRow
            icon={<AppIcon id="lightbulb" size={18} className="text-lamp" />}
            title="Living room ceiling"
            subtitle="Dimmer 2 · Living room"
            meta="3 entities"
            trailing={<Pill tone="success">Reporting</Pill>}
          />
          <a href="#all" className={ROW_LIST_MORE}>
            All devices
            <AppIcon id="chevron-right" size={14} />
          </a>
        </RowList>
      </KitSection>

      <KitSection title="About">
        <FactGrid
          facts={[
            { label: 'Id', value: 'shelly', isMono: true },
            { label: 'Version', value: '2.2.0', isMono: true },
            { label: 'Discovery', value: 'mDNS, and on demand' },
            { label: 'Set up', value: '12 September 2026' },
          ]}
        />
      </KitSection>

      <div className="rounded-card border border-border bg-surface">
        <TableFooter page={page} size={20} total={148} onPage={setPage} onSize={() => undefined} />
      </div>
    </div>
  );
}

/**
 * The parts a long list and its page are given: filters on, a banner, a choice, a held button.
 *
 * @returns The sample.
 */
function ListPartsSample() {
  const [sort, setSort] = useState<'name' | 'devices' | 'recent'>('name');
  const [unlocked, setUnlocked] = useState(0);

  return (
    <div className="flex w-full flex-col gap-5">
      <FilterChips
        filters={[
          { id: 'status', key: 'Status', value: 'Running', onRemove: doNothing },
          { id: 'update', value: 'Update ready', onRemove: doNothing },
        ]}
        summary="4 of 9 shown"
        onClearAll={() => undefined}
      />
      <Note tone="accent">
        <span className="font-medium">Editing “Home”.</span> Everyone who uses Home sees the change.
      </Note>
      <Note tone="warning">The house has no position yet, so the sun has no time here.</Note>
      <div className="flex flex-wrap items-start gap-8">
        <RadioGroup
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'name', label: 'Name' },
            { value: 'devices', label: 'Most devices' },
            { value: 'recent', label: 'Recently added' },
          ]}
        />
        <div className="flex flex-col items-start gap-2">
          <HoldButton
            onConfirm={() => {
              setUnlocked(unlocked + 1);
            }}
          >
            Hold to unlock
          </HoldButton>
          <span className="text-caption text-foreground-subtle">Unlocked {unlocked} times</span>
        </div>
        <MenuButton
          label="Install"
          icon="plus"
          items={[
            {
              label: 'Image',
              description: 'One container from a registry image',
              icon: 'container',
              onSelect: doNothing,
            },
            {
              label: 'Compose',
              description: 'Several containers from a compose file',
              icon: 'layers',
              onSelect: doNothing,
            },
          ]}
        />
      </div>
    </div>
  );
}

/**
 * The gallery.
 *
 * @returns The page.
 */
function Gallery() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [select, setSelect] = useState('member');
  const [segment, setSegment] = useState('system');
  const [password, setPassword] = useState('');
  const [swatch, setSwatch] = useState<TagColor | null>('teal');
  const [openModal, setOpenModal] = useState<'plain' | 'protected' | 'device' | null>(null);
  const [isOn, setOn] = useState(true);
  const [level, setLevel] = useState(60);
  const [kelvin, setKelvin] = useState(3200);
  const [target, setTarget] = useState(21.5);
  const [picked, setPicked] = useState('light.desk');
  const [formula, setFormula] = useState('(t1 + t2) / 2 >= 21 ? t1 : t3');
  const [pickerCache] = useState(housePickerCache);
  const [query, setQuery] = useState('citta');

  // The whole page is themed by the same attribute the application sets on the root, so what is
  // on screen here is what ships rather than an approximation of it. An effect because the root
  // element is outside React, which is the one thing effects are for (RULES.md 15.2).
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  return (
    <div className="min-h-screen bg-canvas px-8 py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-10">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-headline-sm font-medium">Design system</h1>
            <p className="text-caption text-foreground-subtle">
              Development only. Every variant of every shared component.
            </p>
          </div>

          <Segmented
            label="Theme"
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
            value={theme}
            onChange={setTheme}
          />
        </header>

        <Section
          title="Automations"
          note="The list on sample data: a last run of every kind, and one never run."
        >
          <AutomationsListSample />
        </Section>

        <Section
          title="Automation editor"
          note="The board's Evening lights. Click a block to select it; drag a grip to move one."
        >
          <AutomationEditorSample />
        </Section>

        <Section title="Scene page" note="The board's Evening: every kind of member.">
          <ScenePageSample />
        </Section>

        <Section title="Alias editor" note="A calculated alias, and a new one.">
          <AliasEditorSample />
        </Section>

        <Section title="Empty library" note="Automations, scenes and aliases with nothing yet.">
          <EmptyLibrarySample />
        </Section>

        <Section
          title="First run"
          note="Account, then Home: the steps above a 640px card. The pin and the times follow what is typed."
        >
          <FirstRunSample />
        </Section>

        <Section title="Type" note="Each step names a job rather than a size.">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-label text-foreground-subtle uppercase">
              Label · 11
            </span>
            <span className="text-caption text-foreground-subtle">Caption · 12</span>
            <span className="text-ui-sm">Interface, small · 13</span>
            <span className="text-ui">Interface · 14</span>
            <span className="text-title font-medium">Title · 15</span>
            <span className="text-subhead font-medium">Subhead · 16</span>
            <span className="text-headline-sm font-medium">Headline, small · 18</span>
            <span className="text-headline font-medium">Headline · 22</span>
            <span className="text-display font-medium">Display · 30</span>
            <span className="text-reading font-medium tabular">21.5 · reading</span>
            <span className="text-reading-sm font-medium">Locked · reading, small</span>
            <span className="font-mono text-mono-reading tabular">21:40</span>
            <span className="font-mono text-mono-ui text-foreground-muted">
              light.hallway_ceiling
            </span>
          </div>
        </Section>

        <Section
          title="Surfaces"
          note="Canvas, rail, surface, raised, high - flat steps separated by lines."
        >
          <div className="flex flex-wrap gap-3">
            <Swatch className="border border-border bg-canvas">canvas</Swatch>
            <Swatch className="border border-border bg-rail">rail</Swatch>
            <Swatch className="border border-border bg-surface">surface</Swatch>
            <Swatch className="border border-border-strong bg-surface-raised">raised</Swatch>
            <Swatch className="border border-border-strong bg-surface-high">high</Swatch>
            <Swatch className="bg-primary text-primary-foreground">primary</Swatch>
          </div>
        </Section>

        <Section
          title="Toasts"
          note="Bottom right, three at a time, the rest queued. The pointer over them stops the bars."
        >
          <div className="flex flex-wrap gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                toast.success({
                  title: 'Saved',
                  message: 'Kitchen relay is up to date with your changes.',
                });
              }}
            >
              Success
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                toast.warning({
                  title: 'Hallway plug is silent',
                  message: 'It has not answered for 3 minutes. Its readings are paused.',
                  action: { label: 'Open the device', onSelect: doNothing },
                });
              }}
            >
              Warning
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                toast.error({
                  title: 'Couldn’t adopt Shelly Plug S Gen3',
                  message: 'It asks for a password. Type it on the device to try again.',
                  action: { label: 'Open it', onSelect: doNothing },
                });
              }}
            >
              Error
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                toast.info({
                  title: 'Firmware 1.4.4 is installing',
                  message: 'Kitchen relay restarts when it is done, in about a minute.',
                });
              }}
            >
              Information
            </Button>
            <Button
              onClick={() => {
                for (const index of [1, 2, 3, 4, 5, 6]) {
                  toast.info({ title: `Toast ${String(index)}`, message: 'One of six, queued.' });
                }
              }}
            >
              Six at once
            </Button>
          </div>
        </Section>

        <Section title="Button" note="Three intents, three sizes, and the waiting state.">
          {(['primary', 'ghost', 'danger'] as const).map((variant) => (
            <div key={variant} className="flex items-center gap-3">
              <Button variant={variant} size="compact">
                Compact
              </Button>
              <Button variant={variant}>Medium</Button>
            </div>
          ))}
          <Button isBusy>Saving</Button>
          <Button disabled>Disabled</Button>
          <div className="w-56">
            <Button size="large">Large, and full width</Button>
          </div>
        </Section>

        <Section title="Icon button" note="Named by what pressing it does. The label is required.">
          <IconButton label="Copy the token">
            <CopyIcon width="16" height="16" />
          </IconButton>
          <IconButton label="Copy the token" variant="raised">
            <CopyIcon width="16" height="16" />
          </IconButton>
          <IconButton label="Revoke the token" variant="danger">
            <WarningIcon width="16" height="16" />
          </IconButton>
          <IconButton label="Copy the token" size="small">
            <CopyIcon width="14" height="14" />
          </IconButton>
          <IconButton label="Copy the token" size="large">
            <CopyIcon width="18" height="18" />
          </IconButton>
        </Section>

        <Section title="Badge" note="Five meanings, and never colour alone.">
          {TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
          <Badge tone="success" icon={<CheckIcon width="12" height="12" />}>
            On
          </Badge>
          <Badge tone="warning" size="small">
            small
          </Badge>
        </Section>

        <Section title="Pill" note="A status in sentence case; the dot is never alone.">
          <Pill tone="success">Running</Pill>
          <Pill tone="warning">Waiting</Pill>
          <Pill tone="danger">Failed</Pill>
          <Pill tone="accent">Update ready</Pill>
          <Pill>Stopped</Pill>
        </Section>

        <Section
          title="Tag chip"
          note="Twelve hues and one meaning: a tag the owner made. The dot is there so colour is never the only carrier."
        >
          {TAG_COLORS.map((color) => (
            <TagChip key={color} color={color}>
              {color}
            </TagChip>
          ))}
          <TagChip color="teal" size="small">
            small
          </TagChip>
          <TagChip
            color="pink"
            onRemove={() => {
              // A gallery chip has nowhere to be removed from.
            }}
          >
            removable
          </TagChip>
        </Section>

        <Section
          title="Colour swatches"
          note="The palette as a radio group: arrow keys, one tab stop."
        >
          <ColorSwatches label="Colour" value={swatch} onChange={setSwatch} />
        </Section>

        <Section title="Fields" note="One shape, three sizes, and the same recess in each.">
          <div className="flex w-64 flex-col gap-4">
            <TextField label="Display name" defaultValue="Mattia Carli" />
            <TextField
              label="Email"
              defaultValue="not-an-address"
              error="That is not an address the server will take."
            />
            <TextField label="Compact" size="compact" defaultValue="In a row" />
            <TextField
              label="With a hint"
              hint="Optional, and used for nothing but recognising you."
              defaultValue=""
            />
          </div>

          <div className="flex w-64 flex-col gap-4">
            <SelectField
              label="Role"
              options={[
                { value: 'owner', label: 'Owner' },
                { value: 'admin', label: 'Admin' },
                { value: 'member', label: 'Member' },
                { value: 'guest', label: 'Guest' },
              ]}
              value={select}
              onChange={setSelect}
            />
            <PasswordField label="New password" value={password} onChange={setPassword} />
          </div>
        </Section>

        <Section title="Segmented" note="A choice small enough to show all at once.">
          <Segmented
            label="Theme preference"
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
            value={segment}
            onChange={setSegment}
          />
          <Segmented
            label="Compact"
            size="compact"
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={segment}
            onChange={setSegment}
          />
        </Section>

        <Section
          title="Switch, slider, stepper"
          note="What commands a device: a switch acts at once, a slider sends when it is let go, a stepper moves a step at a time."
        >
          <div className="flex items-center gap-3">
            <Switch label="Power" isOn={isOn} onChange={setOn} />
            <Switch label="Power, small" size="small" isOn={isOn} onChange={setOn} />
            <Switch label="Waiting" isOn={isOn} onChange={setOn} isBusy />
            <Switch label="Refused" isOn={false} onChange={setOn} disabled />
          </div>
          <div className="flex w-72 flex-col gap-5">
            <Slider
              label="Brightness"
              value={level}
              min={0}
              max={100}
              display={`${String(level)}%`}
              onChange={setLevel}
            />
            <Slider
              label="Colour temperature"
              value={kelvin}
              min={2000}
              max={6500}
              step={50}
              display={`${String(kelvin)} K`}
              gradient="linear-gradient(90deg, hsl(32 100% 62%), hsl(45 60% 92%), hsl(210 80% 88%))"
              onChange={setKelvin}
            />
            <Slider
              label="Refused"
              value={30}
              min={0}
              max={100}
              display="30%"
              onChange={setLevel}
              disabled
            />
          </div>
          <Stepper
            label="Target temperature"
            value={target}
            min={7}
            max={30}
            step={0.5}
            format={(value) => `${value.toFixed(1)}°`}
            onChange={setTarget}
          />
        </Section>

        <Section
          title="Entity controls"
          note="The Control panel of an entity's page, for every capability the contract describes. Commands fail here: there is no session."
        >
          <QueryClientProvider client={new QueryClient()}>
            <div className="grid w-full gap-4 md:grid-cols-2">
              {CONTROL_SPECIMENS.map((specimen) => (
                <ControlPanel
                  key={specimen.entityId}
                  entity={specimen}
                  state={capabilityStateOf(specimen, undefined)}
                  reportedAt={null}
                  reading={readingOf(specimen, undefined)}
                  canControl
                />
              ))}
            </div>
          </QueryClientProvider>
        </Section>

        <Section
          title="Entity picker"
          note="Every field that holds an entity opens this: the house by floor, room and device, with a search and the kinds."
        >
          <QueryClientProvider client={pickerCache}>
            <div className="flex w-full flex-col gap-4">
              <EntityField label="Entity" value={picked} onChange={setPicked} />
              <EntityField label="From" isOptional value="" onChange={setPicked} />
            </div>
          </QueryClientProvider>
        </Section>

        <Section
          title="Alias formula"
          note="The typed text is transparent; the coloured copy under it must line up letter for letter. t3 is not a source."
        >
          <div className="w-full">
            <AliasFormulaField
              value={formula}
              onChange={setFormula}
              sources={[
                { variableName: 't1', color: 'red' },
                { variableName: 't2', color: 'teal' },
              ]}
              error="t3 is not one of the sources."
            />
          </div>
        </Section>

        <Section
          title="Search"
          note="Every list's search box, and what a list says when it leaves nothing: what was searched for, and one press to clear."
        >
          <div className="flex w-full flex-col gap-4">
            <SearchField
              placeholder="Search devices, entities…"
              value={query}
              onChange={setQuery}
            />
            <NoMatches
              query={query}
              onClear={() => {
                setQuery('');
              }}
            />
          </div>
        </Section>

        <Section
          title="Rail"
          note="The sidebar: Automate, House and System, counts beside the entries, and the 72px rail it collapses to."
        >
          <QueryClientProvider client={RAIL_CACHE}>
            <MemoryRouter initialEntries={['/devices']}>
              <div className="flex h-180 overflow-hidden rounded-panel border border-border">
                <Sidebar />
                <div className="grow bg-canvas" />
              </div>
            </MemoryRouter>
          </QueryClientProvider>
        </Section>

        <Section
          title="Detail page"
          note="Hero, tabs, the health strip, rows and facts: the top and body of a page about one thing."
        >
          <DetailPageSample />
        </Section>

        <Section
          title="Lists and banners"
          note="Filters on, the foot of a paged table, a banner, a choice, and a button to hold."
        >
          <ListPartsSample />
        </Section>

        <Section title="Panel" note="The group of rows a settings page is built from.">
          <div className="w-full">
            <Panel title="Account" action={<Button size="compact">Add</Button>}>
              <PanelRow
                title="Display name"
                note="What everyone else sees."
                control={
                  <Button variant="ghost" size="compact">
                    Edit
                  </Button>
                }
              />
              <PanelRow
                title="Two-factor"
                note="An authenticator app, checked at sign-in."
                control={<Badge tone="success">On</Badge>}
              />
              <PanelRow
                title="Opens into something"
                control={
                  <Button variant="danger" size="compact">
                    Revoke
                  </Button>
                }
              >
                <p className="text-ui text-foreground-muted">
                  A row can carry a whole form under its title.
                </p>
              </PanelRow>
              <PanelNote>A tier cannot keep data for less time than the one above it.</PanelNote>
            </Panel>
          </div>
        </Section>

        <Section
          title="Backup settings"
          note="The real page over a cache already holding its answers, seen by the owner: a schedule learned from the load, three locations - one failing - and the last run."
        >
          <QueryClientProvider client={BACKUP_CACHE}>
            <MemoryRouter initialEntries={['/settings/system/backup']}>
              <div className="flex w-full flex-col gap-4">
                <BackupSettings />
              </div>
            </MemoryRouter>
          </QueryClientProvider>
        </Section>

        <Section
          title="Maintenance settings"
          note="The real page over a cache holding its answers: Nebula Home, two packages and two integrations with an update, automatic updates on, the quietest time."
        >
          <QueryClientProvider client={MAINTENANCE_CACHE}>
            <MemoryRouter initialEntries={['/settings/system/maintenance']}>
              <div className="flex w-full flex-col gap-4">
                <MaintenanceSettings />
              </div>
            </MemoryRouter>
          </QueryClientProvider>
        </Section>

        <Section
          title="Automation editor"
          note="The real screen, mounted here because the route behind it needs a session. Reading entities fails without one, which is the path where the entity fields fall back to being typed."
        >
          <div className="h-[38rem] w-full overflow-hidden rounded-panel border border-border">
            <MemoryRouter initialEntries={['/automations/new']}>
              <QueryClientProvider client={new QueryClient()}>
                <AutomationEditor />
              </QueryClientProvider>
            </MemoryRouter>
          </div>
        </Section>

        <Section
          title="Energy card"
          note="Panels green, battery blue, grid yellow; the dots run the way the power goes. The panels and the battery are drawn only when the card has their meters."
        >
          <QueryClientProvider client={ENERGY_CACHE}>
            <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
              {ENERGY_SAMPLES.map(({ title, sample }) => (
                <div key={title} className="flex flex-col gap-1.5">
                  <span className="text-caption text-foreground-subtle">{title}</span>
                  <div
                    // A dashboard row is 100px with 16px between: this is the card at its size.
                    className={
                      sample.card.h === 4
                        ? 'h-[448px]'
                        : sample.card.h === 3
                          ? 'h-[332px]'
                          : 'h-[216px]'
                    }
                  >
                    <EnergyCard card={sample.card} data={sample.data} />
                  </div>
                </div>
              ))}
            </div>
          </QueryClientProvider>
        </Section>

        <Section
          title="Reached two ways"
          note="The linked tag, labelled in a hero, plain in a row, and the row's that unlinks on hover; the Matter dialog's picture as the job looks for the device, goes, waits, ends and fails."
        >
          <QueryClientProvider client={MATTER_GALLERY_CACHE}>
            <div className="flex w-full flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <WaysTag ways={GALLERY_WAYS} isLabelled />
                <WaysTag ways={GALLERY_WAYS} />
                <WaysTag ways={GALLERY_WAYS} onUnlink={doNothing} />
              </div>
              <div className="flex flex-wrap gap-6">
                <JoinAnimation phase="searching" done={1} />
                <JoinAnimation phase="working" done={3} />
                <JoinAnimation phase="warning" done={3} />
                <JoinAnimation phase="done" done={6} />
                <JoinAnimation phase="failed" done={2} />
              </div>
            </div>
          </QueryClientProvider>
        </Section>

        {MODBUS_TABS.map((tab) => (
          <Section
            key={tab}
            title={`Modbus · ${tab}`}
            note="The house's Modbus broker over sample data: three gateways, five devices - one silent - two servers found and one ignored, the owner's templates and SolaX's."
          >
            <QueryClientProvider client={MODBUS_GALLERY_CACHE}>
              <MemoryRouter initialEntries={[`/brokers/modbus?tab=${tab}`]}>
                <div className="w-full" data-gallery={`modbus-${tab}`}>
                  <ModbusBrokerPage />
                </div>
              </MemoryRouter>
            </QueryClientProvider>
          </Section>
        ))}

        <Section
          title="Modbus · template editor"
          note="The relay board's template as blocks: a switch on a coil, an input, the firmware scaled, a mode with options; the cards at the side."
        >
          <QueryClientProvider client={MODBUS_GALLERY_CACHE}>
            <MemoryRouter initialEntries={[`/brokers/modbus/templates/${MODBUS_SAMPLE_RELAY_ID}`]}>
              <div className="w-full" data-gallery="modbus-editor">
                <Routes>
                  <Route
                    path="/brokers/modbus/templates/:templateId"
                    element={<ModbusTemplatePage />}
                  />
                </Routes>
              </div>
            </MemoryRouter>
          </QueryClientProvider>
        </Section>

        <BrokerGallery />

        <Section
          title="Matter network"
          note="The fabric as a map: the house in the middle, an access point and a Thread router of another fabric around it, devices round those, a bridge's behind it on dotted links and a silent plug on a dashed red one. Hover a point for its card; drag, zoom and fit."
        >
          <QueryClientProvider client={MATTER_GALLERY_CACHE}>
            <MemoryRouter>
              <div className="w-full">
                <GalleryMatterNetwork />
              </div>
            </MemoryRouter>
          </QueryClientProvider>
        </Section>

        <Section
          title="Pairing and hearing"
          note="Pair devices is the page's primary button; open, it counts down. A listener hearing nothing is a callout with the way to the log."
        >
          <div className="flex w-full flex-col gap-4">
            <div className="flex items-center gap-3">
              <PairingButton pairing={samplePairing(false)} />
              <PairingButton pairing={samplePairing(true)} />
            </div>
            <MemoryRouter>
              <ListenerCallout vendor={SILENT_ZIGBEE} />
              <div className="mt-4 flex flex-col gap-4">
                <PairingPanel vendor={SILENT_ZIGBEE} pairing={samplePairing(true)} devices={[]} />
                <PassedOverPanel vendor={SILENT_ZIGBEE} />
              </div>
            </MemoryRouter>
          </div>
        </Section>

        <Section
          title="Log viewer"
          note="Times in the viewer's zone, levels read from the line, colours the program asked for in the theme's tones."
        >
          <QueryClientProvider client={LOG_CACHE}>
            <div className="w-full">
              <LogViewer
                queryKey={['gallery', 'log']}
                fileName="zigbee2mqtt"
                read={async () =>
                  Promise.resolve({ lines: SAMPLE_LOG, cursor: null, isTruncated: false })
                }
              />
            </div>
          </QueryClientProvider>
        </Section>

        <Section
          title="Install dialog"
          note="The Community Hub's results as full-width rows, and an item's own page."
        >
          <div className="flex w-full flex-col gap-4">
            <ul
              id="gallery-catalogue-rows"
              className="flex w-full flex-col rounded-dialog border border-border-strong bg-surface p-4"
            >
              <CatalogueRow
                logo={
                  <ListingLogo
                    listing={{ name: 'Philips Hue', color: '#3b9dff', logo: null }}
                    size={48}
                  />
                }
                name="Philips Hue"
                isOfficial
                description="Lights, switches and motion sensors through the Hue bridge, all local."
                facts={
                  <>
                    <Stars count={1240} />
                    <Installs count={41_800} />
                    <span>by nebulahome</span>
                  </>
                }
                isInstalled={false}
                onOpen={() => undefined}
              />
              <CatalogueRow
                logo={
                  <ListingLogo
                    listing={{ name: 'Govee', color: '#62a9ff', logo: null }}
                    size={48}
                  />
                }
                name="Govee"
                isOfficial={false}
                description="LED strips and lights over LAN, with cloud as a fallback."
                facts={
                  <>
                    <Stars count={86} />
                    <Installs count={12_700} />
                    <span>by govee-community</span>
                    <span className="rounded-pill border border-warning-line px-2 text-warning">
                      Needs the internet
                    </span>
                  </>
                }
                isInstalled
                onOpen={() => undefined}
              />
            </ul>
            <div
              id="gallery-catalogue-item"
              className="w-full rounded-dialog border border-border-strong bg-surface"
            >
              <CatalogueItem
                logo={
                  <ListingLogo
                    listing={{ name: 'Philips Hue', color: '#3b9dff', logo: null }}
                    size={80}
                  />
                }
                name="Philips Hue"
                by="by nebulahome"
                chips={
                  <>
                    <CatalogueChip tone="accent">Official</CatalogueChip>
                    <CatalogueChip icon="network">Local network</CatalogueChip>
                    <CatalogueChip icon="cable">HTTP</CatalogueChip>
                  </>
                }
                stats={
                  <>
                    <CatalogueStat
                      icon="star"
                      iconClassName="text-lamp"
                      value="1.2K"
                      label="stars"
                    />
                    <CatalogueStat icon="download" value="41.8K" label="installs" />
                    <CatalogueStat icon="tag" value="3.1.0" />
                    <CatalogueStat
                      icon="clock"
                      value="12 days ago"
                      label="since the last release"
                    />
                  </>
                }
                description="Lights, switches and motion sensors through the Hue bridge, all local."
                worksWith={[
                  'Hue Bridge v2',
                  'White and colour bulbs',
                  'Lightstrips',
                  'Motion sensors',
                ]}
                effects={[
                  {
                    icon: 'cable',
                    title: 'Talks to its devices over HTTP',
                    note: 'On your network. Nothing leaves the house.',
                  },
                  {
                    icon: 'package',
                    title: 'Nothing else to install',
                    note: 'Profiles only: it runs inside Nebula Home, with no code of its own.',
                  },
                  {
                    icon: 'radio-tower',
                    title: 'Then add its devices',
                    note: 'From its page, once it is installed.',
                  },
                ]}
              />
            </div>
          </div>
        </Section>

        <Section title="Modal" note="Clicking away closes it, unless what it holds is shown once.">
          <Button
            onClick={() => {
              setOpenModal('plain');
            }}
          >
            Open a dialog
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setOpenModal('protected');
            }}
          >
            Open one that keeps a secret
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setOpenModal('device');
            }}
          >
            Open one with a side card
          </Button>
        </Section>
      </div>

      <QueryClientProvider client={pickerCache}>
        <DeviceDialog
          key={openModal === 'device' ? 'device-open' : 'device-shut'}
          target={
            openModal === 'device'
              ? { mode: 'create', vendor: SAMPLE_VENDOR, existingIds: [] }
              : null
          }
          onClose={() => {
            setOpenModal(null);
          }}
          onSaved={() => {
            setOpenModal(null);
          }}
        />
      </QueryClientProvider>

      <Modal
        isOpen={openModal === 'plain'}
        onClose={() => {
          setOpenModal(null);
        }}
        title="Invite somebody"
        description="They will be able to sign in once they have set a password."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpenModal(null);
              }}
            >
              Cancel
            </Button>
            <Button>Send it</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <TextField label="Username" defaultValue="" />
          {/* The dropdown that used to give the whole dialog a scrollbar. */}
          <SelectField
            label="Role"
            options={[
              { value: 'owner', label: 'Owner' },
              { value: 'admin', label: 'Admin' },
              { value: 'member', label: 'Member' },
              { value: 'guest', label: 'Guest' },
            ]}
            value={select}
            onChange={setSelect}
          />
        </div>
      </Modal>

      <Modal
        isOpen={openModal === 'protected'}
        onClose={() => {
          setOpenModal(null);
        }}
        title="Recovery codes"
        description="Shown once. Clicking away will not dismiss this."
        closesOnBackdrop={false}
        footer={
          <Button
            onClick={() => {
              setOpenModal(null);
            }}
          >
            I have saved them
          </Button>
        }
      >
        <p className="font-mono text-ui text-foreground-muted">4f2a-9c71 · 8be3-1d40</p>
      </Modal>
    </div>
  );
}

/** What a swatch needs. */
type SwatchProps = {
  /** The classes under test. */
  readonly className: string;

  /** What the surface is called. */
  readonly children: ReactNode;
};

/**
 * One surface, labelled.
 *
 * @param props - See {@link SwatchProps}.
 * @returns The swatch.
 */
function Swatch(props: SwatchProps) {
  const { className, children } = props;

  return (
    <div
      className={`flex h-16 w-28 items-end rounded-panel p-2 text-caption text-foreground-muted ${className}`}
    >
      {children}
    </div>
  );
}

const root = document.getElementById('root');

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <Gallery />
      <Toaster />
    </StrictMode>,
  );
}

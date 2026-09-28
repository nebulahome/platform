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
import { MemoryRouter } from 'react-router';

import {
  composeEntityId,
  TAG_COLORS,
  type IntegrationKind,
  type IntegrationVendorView,
  type TagColor,
} from '@nebula-home/contracts';
import {
  Badge,
  Button,
  ColorSwatches,
  IconButton,
  Modal,
  Panel,
  PanelNote,
  PanelRow,
  Segmented,
  SelectField,
  Slider,
  Stepper,
  Switch,
  TagChip,
  TextField,
  type BadgeTone,
} from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { CheckIcon, CopyIcon, WarningIcon } from '@/components/icons';
import { LogViewer } from '@/components/log-viewer';
import { PasswordField } from '@/components/password-field';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { capabilityStateOf } from '@/library/entity-control';
import { readingOf } from '@/library/entity-reading';
import { EnergyCard } from '@/routes/dashboard/cards/energy/energy-card';
import { AliasFormulaField } from '@/routes/library/alias-formula-field';
import { AutomationEditor } from '@/routes/library/automation-editor';
import { DeviceDialog } from '@/routes/library/device-dialog';
import { ControlPanel } from '@/routes/library/entity/controls/control-panel';
import { EntityField } from '@/routes/library/entity-field';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { ListenerCallout, PassedOverPanel } from '@/routes/library/vendor-hearing';
import { PairingButton, PairingPanel, type PairingState } from '@/routes/library/vendor-pairing';
import { BackupSettings } from '@/routes/settings/backup-settings';
import { backupSampleCache, SAMPLE_OWNER } from '@/testing/backup-samples';
import { energySample, energySampleCache } from '@/testing/energy-samples';
import { aDevice, anArea, anEntity } from '@/testing/fixtures';

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
  logoPadding: 0,
  internetRequired: false,
  transports: ['shelly/rpc'],
  wires: ['http'],
  discoverySources: ['mdns'],
  adoption: 'owner',
  pairing: null,
  listener: null,
  passedOver: [],
  account: null,
  accounts: [],
  needsAccount: false,
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
  pairing: { driverId: 'bridge', objectId: 'permit_join' },
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
  const openedAt = Date.now() - 60_000;

  return {
    entityId: composeEntityId('switch', 'zigbee2mqtt', 'permit_join'),
    isOpen,
    openedAt: isOpen ? openedAt : null,
    closesAt: isOpen ? openedAt + 254_000 : null,
    canPress: true,
    reason: null,
    /**
     * Does nothing: the gallery shows the button, it does not pair.
     *
     * @returns Nothing.
     */
    toggle: () => undefined,
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

/** The cache the Backup page reads from. */
const BACKUP_CACHE = backupSampleCache();

// The Backup page shows its controls to whoever may use them: the gallery's visitor is the owner.
useSession.setState({ user: SAMPLE_OWNER });

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
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-head font-semibold">{title}</h2>
        <p className="text-caption text-foreground-subtle">{note}</p>
      </div>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

const TONES: readonly BadgeTone[] = ['neutral', 'accent', 'success', 'warning', 'danger'];

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
            <h1 className="text-head font-semibold">Design system</h1>
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

        <Section title="Type" note="Each step names a job rather than a size.">
          <div className="flex flex-col gap-2">
            <span className="text-label text-foreground-subtle uppercase">Label · 11</span>
            <span className="text-caption text-foreground-subtle">Caption · 12</span>
            <span className="text-ui">Interface · 13</span>
            <span className="text-title font-medium">Title · 14</span>
            <span className="text-subhead font-semibold">Subhead · 16</span>
            <span className="text-head font-semibold">Head · 18</span>
            <span className="text-headline font-semibold">Headline · 20</span>
            <span className="text-reading font-semibold tabular">21.5 · reading</span>
            <span className="text-reading-lg font-semibold tabular">60% · large</span>
            <span className="font-mono text-ui text-foreground-muted">light.hallway_ceiling</span>
          </div>
        </Section>

        <Section
          title="Surfaces"
          note="Ground, rail, card, control, recess — four steps and a hole."
        >
          <div className="flex flex-wrap gap-3">
            <Swatch className="border border-border bg-canvas">canvas</Swatch>
            <Swatch className="border border-border bg-rail">rail</Swatch>
            <Swatch className="border border-border face-card">card</Swatch>
            <Swatch className="border border-border-strong face-raised">raised</Swatch>
            <Swatch className="border border-border face-sunk">sunk</Swatch>
            <Swatch className="face-primary text-primary-foreground">primary</Swatch>
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
            <div className="flex w-full flex-col gap-4">
              <BackupSettings />
            </div>
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
    </StrictMode>,
  );
}

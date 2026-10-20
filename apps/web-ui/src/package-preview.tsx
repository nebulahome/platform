/**
 * THROWAWAY - never committed. Draws the built 3D Home package (copied into
 * public/pkg-preview/ui) with the interface's real components and a UI host whose data hooks
 * answer from fixtures: the sample house, its devices, a synthetic past.
 *
 * Query string: ?theme=light|dark  ?lang=it  ?card=large|medium|wide|small  #/edit  #/simulate
 */
/* eslint-disable */
// @ts-nocheck
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SDK_VERSION } from '@nebulahome/package-sdk';
import { sunPosition } from '@nebulahome/contracts';

import { LENT_MODULES } from '@/packages/shared-modules';

import './styles/globals.css';

const params = new URLSearchParams(location.search);
const scheme = params.get('theme') === 'light' ? 'light' : 'dark';
const lang = params.get('lang') ?? 'en';
document.documentElement.dataset.theme = scheme;

const HOUR = 3_600_000;
const now = Date.now();

const house = await (await fetch('/pkg-preview/sample-house.json')).json();
const iconNodes = await (await fetch('/pkg-preview/icon-nodes.json')).json();
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/api/v1/icons')) {
    const ids = (new URL(url, location.origin).searchParams.get('ids') ?? '')
      .split(',')
      .filter(Boolean);
    const allowed = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
    const items = ids.flatMap((id) => {
      const node = iconNodes[id];
      if (!Array.isArray(node)) return [];
      return [
        {
          id,
          name: id,
          keywords: [],
          origin: 'builtin',
          isOverridden: false,
          frame: { x: 0, y: 0, size: 24 },
          node: node
            .filter((el) => allowed.has(el[0]))
            .map(([tag, attrs]) => [
              tag,
              Object.fromEntries(
                Object.entries(attrs)
                  .filter(([k]) => k !== 'key')
                  .map(([k, v]) => [k, String(v)]),
              ),
            ]),
        },
      ];
    });
    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return realFetch(input, init);
};
const it = lang === 'it' ? await (await fetch('/pkg-preview/it.json')).json() : {};

// ---- the entities -------------------------------------------------------------------------
const iso = (ms) => new Date(ms).toISOString();
const view = (entityId, extra) => ({
  entityId,
  domain: entityId.split('.')[0],
  name: extra.name,
  icon: null,
  deviceId: extra.deviceId ?? `dev-${entityId}`,
  areaId: null,
  capabilities: extra.capabilities ?? {},
  state: extra.state,
  attributes: extra.attributes ?? {},
  isAvailable: extra.isAvailable ?? true,
  lastChanged: iso(now - (extra.ago ?? 40) * 60_000),
  unitOfMeasurement: extra.unit ?? null,
  deviceClass: extra.deviceClass ?? null,
  displayPrecision: extra.precision ?? null,
});

let entities = new Map(
  [
    view('light.living_room_ceiling', {
      name: 'Living room ceiling',
      state: { on_off: { isOn: true }, level: { level: 72 }, color_temp: { mireds: 370 } },
      capabilities: { on_off: {}, level: {}, color_temp: { minMireds: 153, maxMireds: 500 } },
    }),
    view('light.reading_lamp', {
      name: 'Reading lamp',
      state: { on_off: { isOn: true }, level: { level: 40 } },
      capabilities: { on_off: {}, level: {} },
    }),
    view('light.island_lights', {
      name: 'Island lights',
      state: {
        on_off: { isOn: true },
        level: { level: 85 },
        color_hs: { hue: 36, saturation: 45 },
      },
      capabilities: { on_off: {}, level: {}, color_hs: {} },
    }),
    view('climate.living_room_ac', {
      name: 'Living room AC',
      state: {
        thermostat: {
          currentTemperature: 25.4,
          targetTemperature: 23,
          mode: 'cool',
          action: 'cooling',
          humidity: 48,
        },
      },
      capabilities: {
        thermostat: {
          supportedModes: ['off', 'heat', 'cool', 'auto', 'fan_only', 'dry'],
          minTemperature: 16,
          maxTemperature: 30,
          temperatureStep: 0.5,
        },
      },
    }),
    view('sensor.living_room_temperature', {
      name: 'Living room temperature',
      state: { sensor_numeric: { value: 21.6 } },
      unit: '°C',
      deviceClass: 'temperature',
      precision: 1,
      deviceId: 'dev-ac',
    }),
    view('sensor.kitchen_temperature', {
      name: 'Kitchen temperature',
      state: { sensor_numeric: { value: 22.1 } },
      unit: '°C',
      deviceClass: 'temperature',
      precision: 1,
    }),
    view('binary_sensor.hallway_motion', {
      name: 'Hallway motion',
      state: { sensor_binary: { isOn: true } },
      deviceClass: 'motion',
      ago: 6,
    }),
    view('binary_sensor.living_room_motion', {
      name: 'Living room motion',
      state: { sensor_binary: { isOn: false } },
      deviceClass: 'motion',
    }),
    view('lock.front_door', {
      name: 'Front door',
      state: { lock: { lockState: 'locked' } },
      capabilities: { lock: { hasCode: true } },
    }),
    view('binary_sensor.study_door', {
      name: 'Study door',
      state: { sensor_binary: { isOn: true } },
      deviceClass: 'door',
    }),
    view('cover.living_room_blinds', {
      name: 'Living room blinds',
      state: { cover: { position: 60, tilt: 30, motion: 'stopped' } },
      capabilities: { cover: { hasPosition: true, hasTilt: true } },
    }),
    view('vacuum.robbie', {
      name: 'Robbie',
      state: {
        vacuum: {
          activity: 'cleaning',
          rooms: [
            { id: '1', name: 'Hallway' },
            { id: '2', name: 'Kitchen' },
            { id: '3', name: 'Living room' },
          ],
          isResumable: false,
        },
      },
      capabilities: {
        vacuum: {
          canPause: true,
          canStop: true,
          canDock: true,
          canLocate: true,
          canCleanRooms: true,
        },
      },
      attributes: { battery_level: 64 },
    }),
    view('switch.dishwasher_plug', {
      name: 'Dishwasher plug',
      state: { on_off: { isOn: true } },
      capabilities: { on_off: {} },
      ago: 113,
    }),
    view('media_player.living_room_speaker', {
      name: 'Living room speaker',
      state: {
        media_player: {
          playback: 'playing',
          volume: 35,
          isMuted: false,
          source: 'Line in',
          mediaTitle: 'Clair de Lune',
          mediaArtist: 'Debussy',
          mediaDurationSeconds: 300,
          mediaPositionSeconds: 102,
        },
      },
      capabilities: {
        media_player: {
          supportedSources: ['Line in', 'Radio', 'Bluetooth'],
          hasSeek: true,
          hasVolume: true,
        },
      },
    }),
    view('camera.porch', {
      name: 'Porch camera',
      state: { camera: { isStreamAvailable: true, isRecording: false } },
      capabilities: { camera: { hasSnapshot: true, hasStream: true, hasRecording: true } },
    }),
    view('light.bedroom_ceiling', {
      name: 'Bedroom ceiling',
      state: { on_off: { isOn: false }, level: { level: 0 } },
      capabilities: { on_off: {}, level: {} },
    }),
    view('sensor.bedroom_temperature', {
      name: 'Bedroom temperature',
      state: { sensor_numeric: { value: 19.8 } },
      unit: '°C',
      deviceClass: 'temperature',
      precision: 1,
    }),
    view('light.landing', {
      name: 'Landing',
      state: { on_off: { isOn: false } },
      capabilities: { on_off: {} },
    }),
    view('binary_sensor.bedroom_window', {
      name: 'Bedroom window',
      state: { sensor_binary: { isOn: false } },
      deviceClass: 'window',
    }),
    view('sensor.3d_home_room_kitchen_temperature', {
      name: 'Kitchen temperature',
      state: { sensor_numeric: { value: 22.1 } },
      unit: '°C',
      deviceClass: 'temperature',
      precision: 1,
    }),
    view('sensor.3d_home_room_living_temperature', {
      name: 'Living room temperature',
      state: { sensor_numeric: { value: 21.6 } },
      unit: '°C',
      deviceClass: 'temperature',
      precision: 1,
    }),
    view('binary_sensor.3d_home_room_living_presence', {
      name: 'Living room presence',
      state: { sensor_binary: { isOn: false } },
      deviceClass: 'occupancy',
    }),
    view('binary_sensor.3d_home_room_hallway_presence', {
      name: 'Hallway presence',
      state: { sensor_binary: { isOn: true } },
      deviceClass: 'occupancy',
    }),
    view('sensor.3d_home_room_bedroom_temperature', {
      name: 'Bedroom temperature',
      state: { sensor_numeric: { value: 19.8 } },
      unit: '°C',
      deviceClass: 'temperature',
      precision: 1,
    }),
  ].map((entity) => [entity.entityId, entity]),
);
const listeners = new Set<() => void>();
let version = 0;
const bump = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};
const useVersion = () =>
  React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );

const apply = (entityId, capability, command) => {
  const entity = entities.get(entityId);
  if (!entity) return;
  const state = structuredClone(entity.state);
  if (capability === 'on_off')
    state.on_off = {
      isOn: command.command === 'toggle' ? !state.on_off?.isOn : command.command === 'turn_on',
    };
  if (capability === 'level') {
    state.level = { level: command.level };
    state.on_off = { isOn: command.level > 0 };
  }
  if (capability === 'color_temp') state.color_temp = { mireds: command.mireds };
  if (capability === 'color_hs')
    state.color_hs = { hue: command.hue, saturation: command.saturation };
  if (capability === 'cover')
    state.cover = {
      ...state.cover,
      position:
        command.command === 'open'
          ? 100
          : command.command === 'close'
            ? 0
            : (command.position ?? state.cover.position),
      tilt: command.tilt ?? state.cover.tilt,
    };
  if (capability === 'lock')
    state.lock = { lockState: command.command === 'lock' ? 'locked' : 'unlocked' };
  if (capability === 'thermostat')
    state.thermostat = {
      ...state.thermostat,
      ...(command.command === 'set_target'
        ? { targetTemperature: command.temperature }
        : { mode: command.mode, action: command.mode === 'off' ? 'off' : state.thermostat.action }),
    };
  if (capability === 'media_player' && (command.command === 'play' || command.command === 'pause'))
    state.media_player = {
      ...state.media_player,
      playback: command.command === 'play' ? 'playing' : 'paused',
    };
  if (capability === 'media_player' && command.command === 'set_volume')
    state.media_player = { ...state.media_player, volume: command.volume };
  entities.set(entityId, { ...entity, state, lastChanged: new Date().toISOString() });
  entities = new Map(entities);
  bump();
};

// ---- the server ---------------------------------------------------------------------------
const server = { house, revision: 1, draft: null, models: [], modelData: new Map() };
const call = async (method, input) => {
  await new Promise((resolve) => setTimeout(resolve, 60));
  switch (method) {
    case 'houseGet':
      return {
        house: server.house,
        revision: server.revision,
        savedAt: null,
        hasDraft: server.draft !== null,
        models: server.models,
      };
    case 'draftGet':
      return { draft: server.draft, revision: server.revision };
    case 'draftPut':
      server.draft = {
        house: input.house,
        baseRevision: input.baseRevision,
        updatedAt: new Date().toISOString(),
      };
      return { updatedAt: server.draft.updatedAt };
    case 'houseSave':
      server.house = input.house ?? server.draft.house;
      server.revision += 1;
      server.draft = null;
      bump();
      return { revision: server.revision };
    case 'draftDiscard':
      server.draft = null;
      bump();
      return { revision: server.revision };
    case 'houseExport':
      return { file: { version: 2, house: server.house }, summary: {}, modelIds: [] };
    case 'houseImport':
      server.house = input.house ?? input;
      server.revision += 1;
      bump();
      return {
        revision: server.revision,
        summary: { floors: server.house.floors.length, rooms: 0, devices: 0, items: 0 },
      };
    case 'houseWipe':
      server.house = { ...server.house, floors: [] };
      server.revision += 1;
      bump();
      return { revision: server.revision };
    case 'modelList':
      return server.models;
    case 'modelGet':
      return { data: server.modelData.get(input.id) };
    case 'modelImport': {
      const id = input.id ?? `m${String(server.models.length + 1)}`;
      const meta = {
        id,
        name: input.name,
        source: input.source,
        triangles: 100,
        size: [1, 1, 1],
        bytes: input.data.length,
      };
      server.models = [...server.models.filter((m) => m.id !== id), meta];
      server.modelData.set(id, input.data);
      bump();
      return meta;
    }
    case 'modelRemove':
      server.models = server.models.filter((m) => m.id !== input.id);
      bump();
      return { models: server.models };
    default:
      throw new Error(`No method ${method}`);
  }
};

// ---- the past -----------------------------------------------------------------------------
const seeded = (seed) => {
  let x = seed;
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
};
const telemetry = (entityId, from, to) => {
  const base = entities.get(entityId)?.state.sensor_numeric?.value ?? 20;
  const points = [];
  const step = Math.max(5 * 60_000, (to - from) / 400);
  for (let t = from; t < to; t += step)
    points.push({
      time: iso(t),
      value:
        base +
        1.4 * Math.sin((((t / HOUR) % 24) / 24) * 2 * Math.PI - 1.6) +
        0.15 * Math.sin(t / 900_000),
    });
  return points;
};
const states = (entityId, from, to) => {
  const entity = entities.get(entityId);
  if (!entity) return [];
  const random = seeded(entityId.length * 97 + Math.floor(from / HOUR));
  const points = [];
  const key = Object.keys(entity.state)[0];
  let isOn = false;
  for (let t = from + random() * HOUR; t < Math.min(to, now); t += (0.4 + random() * 1.6) * HOUR) {
    const previous = structuredClone(entity.state);
    const next = structuredClone(entity.state);
    if (key === 'on_off') {
      previous.on_off = { isOn };
      next.on_off = { isOn: !isOn };
    } else if (key === 'sensor_binary') {
      previous.sensor_binary = { isOn };
      next.sensor_binary = { isOn: !isOn };
    } else if (key === 'lock') {
      previous.lock = { lockState: isOn ? 'unlocked' : 'locked' };
      next.lock = { lockState: isOn ? 'locked' : 'unlocked' };
    } else if (key === 'cover') {
      previous.cover = { ...entity.state.cover, position: isOn ? 100 : 0 };
      next.cover = { ...entity.state.cover, position: isOn ? 0 : 100 };
    }
    isOn = !isOn;
    points.push({
      time: iso(t),
      state: next,
      previousState: previous,
      attributes: {},
      isAvailable: true,
      source: 'preview',
      ...(random() > 0.6 ? { cause: { type: random() > 0.5 ? 'automation' : 'user' } } : {}),
    });
  }
  return points;
};
const spanOf = (window) =>
  'lastMs' in window
    ? { from: Date.now() - window.lastMs, to: Date.now() }
    : { from: Date.parse(window.from), to: Date.parse(window.to) };

// ---- the host -----------------------------------------------------------------------------
const english = (key, english, values = {}) => {
  const found = key
    .split('.')
    .reduce((node, part) => (node === undefined ? undefined : node[part]), it);
  let text =
    typeof english === 'string' ? english : values.count === 1 ? english.one : english.other;
  if (typeof found === 'string') text = found;
  if (typeof found === 'object' && found !== null && typeof english !== 'string')
    text = (values.count === 1 ? found.one : found.other) ?? text;
  if (typeof english !== 'string') {
    const plural = key
      .split('.')
      .slice(0, -1)
      .reduce((node, part) => (node === undefined ? undefined : node[part]), it);
    const last = key.split('.').at(-1);
    const form = plural?.[`${last}_${values.count === 1 ? 'one' : 'other'}`];
    if (typeof form === 'string') text = form;
  }
  return text.replace(/\{\{(\w+)\}\}/g, (all, name) =>
    values[name] === undefined ? all : String(values[name]),
  );
};
let route = location.hash.slice(1) || '/';
const routeListeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  route = location.hash.slice(1) || '/';
  routeListeners.forEach((l) => l());
});
const useRoute = () =>
  React.useSyncExternalStore(
    (l) => {
      routeListeners.add(l);
      return () => routeListeners.delete(l);
    },
    () => route,
  );
let settingsValues = {
  wallHeight: 2.7,
  roof: 'hip',
  roofPitch: 25,
  roofOverhang: 0.5,
  quality: 'balanced',
  smoothCamera: true,
};

const host = {
  usePackage: () => ({ id: '3d-home', version: '0.1.0', name: '3D Home' }),
  useEntity: (entityId) => {
    useVersion();
    return entities.get(entityId);
  },
  useEntities: (filter) => {
    useVersion();
    const all = [...entities.values()];
    const owned =
      filter?.owner === 'any' ? all : all.filter((e) => e.entityId.includes('.3d_home_'));
    return owned.filter(
      (e) =>
        (filter?.entityIds === undefined || filter.entityIds.includes(e.entityId)) &&
        (filter?.domain === undefined || e.domain === filter.domain),
    );
  },
  useCustomEntity: () => ({
    values: undefined,
    isAvailable: false,
    lastChanged: null,
    send: async () => undefined,
  }),
  useCommand: () =>
    React.useCallback(async (entityId, capability, command) => {
      console.log('command', entityId, capability, command);
      apply(entityId, capability, command);
    }, []),
  usePackageRpc: (method, input = null, options) => {
    const v = useVersion();
    const [state, setState] = React.useState({ data: undefined, error: null, isLoading: true });
    const key = JSON.stringify([method, input, v]);
    React.useEffect(() => {
      let live = true;
      call(method, input).then(
        (data) => live && setState({ data, error: null, isLoading: false }),
        (error) => live && setState({ data: undefined, error, isLoading: false }),
      );
      return () => {
        live = false;
      };
    }, [key]);
    return { ...state, refetch: () => bump() };
  },
  usePackageCall: () => React.useCallback((method, input) => call(method, input), []),
  usePackageMutation: (method) => {
    const [isPending, setPending] = React.useState(false);
    return {
      mutate: async (input) => {
        setPending(true);
        try {
          return await call(method, input);
        } finally {
          setPending(false);
          bump();
        }
      },
      isPending,
      error: null,
      reset: () => undefined,
    };
  },
  usePackageSettings: () => {
    useVersion();
    return {
      values: settingsValues,
      isLoading: false,
      update: async (patch) => {
        settingsValues = { ...settingsValues, ...patch };
        bump();
      },
      isUpdating: false,
      canEdit: true,
      error: null,
    };
  },
  useViewer: () => ({ userId: 'u', username: 'bobby', role: 'owner', can: () => true }),
  useLocale: () => ({ locale: lang === 'it' ? 'it-IT' : 'en-GB', timeZone: 'Europe/Rome' }),
  useTranslation: () => ({ t: english, locale: lang }),
  useTheme: () => ({ scheme }),
  usePortalContainer: () => document.getElementById('portal'),
  usePackageRoute: () => {
    const path = useRoute();
    const [p, q = ''] = path.split('?');
    return { path: p, segments: p.split('/').filter(Boolean), query: new URLSearchParams(q) };
  },
  usePackageNavigate: () => (to) => {
    location.hash = to;
  },
  usePlatformNavigate: () => (target) => console.log('platform', target),
  PackageLink: ({ to, children, ...rest }) =>
    React.createElement('a', { ...rest, href: `#${to}` }, children),
  PlatformLink: ({ to, children, ...rest }) =>
    React.createElement(
      'a',
      {
        ...rest,
        href: '#',
        onClick: (e) => {
          e.preventDefault();
          console.log('platform', to);
        },
      },
      children,
    ),
  useStateHistory: (query) => {
    useVersion();
    const span = spanOf(query.window);
    return {
      series: Object.fromEntries(query.entityIds.map((id) => [id, states(id, span.from, span.to)])),
      window: span,
      truncated: [],
      isLoading: false,
      error: null,
      refetch: () => undefined,
    };
  },
  useTelemetry: (query) => {
    const span = spanOf(query.window);
    return {
      series: Object.fromEntries(
        query.entityIds.map((id) => [id, telemetry(id, span.from, span.to)]),
      ),
      window: span,
      truncated: [],
      isLoading: false,
      error: null,
      refetch: () => undefined,
      resolution: '1m',
    };
  },
  useAreas: () => [
    {
      key: 'home',
      name: 'Home',
      kind: 'house',
      parentKey: null,
      icon: null,
      sortOrder: 0,
      level: null,
      latitude: 45.07,
      longitude: 7.69,
    },
    {
      key: 'ground_floor',
      name: 'Ground floor',
      kind: 'floor',
      parentKey: 'home',
      icon: null,
      sortOrder: 0,
      level: 0,
      latitude: null,
      longitude: null,
    },
    {
      key: 'first_floor',
      name: 'First floor',
      kind: 'floor',
      parentKey: 'home',
      icon: null,
      sortOrder: 1,
      level: 1,
      latitude: null,
      longitude: null,
    },
    {
      key: 'kitchen',
      name: 'Kitchen',
      kind: 'room',
      parentKey: 'ground_floor',
      icon: null,
      sortOrder: 0,
      level: null,
      latitude: null,
      longitude: null,
    },
    {
      key: 'living_room',
      name: 'Living room',
      kind: 'room',
      parentKey: 'ground_floor',
      icon: null,
      sortOrder: 1,
      level: null,
      latitude: null,
      longitude: null,
    },
  ],
  useEntityPicture: (entityId) => ({
    url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2a3a"/><stop offset="1" stop-color="#3a2f22"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><text x="12" y="168" fill="#fff" font-family="monospace" font-size="12">' + entityId + '</text></svg>')}`,
    isLoading: false,
    error: null,
  }),
};

globalThis.__nebula = {
  sdk: SDK_VERSION,
  modules: { ...LENT_MODULES, '@nebulahome/package-sdk/ui@1': host },
};

const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = '/pkg-preview-files/ui/index.css';
document.head.append(link);

const entryUrl = ['/pkg-preview-files', 'ui', 'index.js'].join('/');
const entry = (await import(/* @vite-ignore */ entryUrl)).default;
const card = params.get('card');
const Page = (await entry.page()).default;
const Card = card === null ? null : (await entry.cards.house()).default;
const sizes = { small: [267, 100], wide: [550, 100], medium: [550, 216], large: [550, 332] };
const query = new QueryClient();

createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={query}>
    <div className="min-h-screen bg-canvas p-6 text-foreground" data-nebula-package="3d-home">
      {Card === null ? (
        <Page packageId="3d-home" />
      ) : (
        <div className="flex flex-wrap gap-6">
          {(card === 'all' ? Object.keys(sizes) : [card]).map((size) => (
            <div
              key={size}
              className="overflow-hidden rounded-card border border-border"
              style={{
                width: sizes[size][0],
                height: sizes[size][1],
                background: 'linear-gradient(180deg,#11142199 0%,#0c0e19 55%)',
              }}
            >
              <Card
                packageId="3d-home"
                cardId="house"
                name="3D Home"
                title="Home"
                size={size}
                isEditing={false}
                options={{
                  floor: 'all',
                  view: 'dollhouse',
                  light: params.get('light') ?? 'live',
                  devices: 'all',
                  tapToControl: true,
                  canTurn: true,
                }}
              />
            </div>
          ))}
        </div>
      )}
      <div id="portal" />
    </div>
  </QueryClientProvider>,
);

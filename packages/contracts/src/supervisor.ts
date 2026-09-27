/**
 * The supervisor: the one service that speaks to Docker.
 *
 * It holds the Docker socket - which is root on the host, so nothing else may - lists every
 * container the host runs, tells the platform's own container apart, measures the others, starts,
 * stops, restarts and updates them, and runs the containers an integration depends on. Every
 * other service asks it on the bus: `api` for the containers page, `hub` for the containers a
 * vendor's bundle declares, `backup` to stop them around a restore.
 *
 * Each container but the platform's own is also a device in the registry, with a handful of
 * entities `core` writes when the supervisor tells it which containers there are, and whose
 * states the supervisor reports as an adapter would. Their `source` is the supervisor.
 *
 * Defined in ARCHITECTURE.md 4.10.
 */
import { z } from 'zod';

import { entityIdSchema } from './entity-id.js';
import { SEMVER_PATTERN } from './package-manifest.js';
import { entityRegistrationSchema } from './registration.js';
import { timestampSchema } from './timestamp.js';

/** The bus service name the supervisor answers on, and the `source` of every container entity. */
export const SUPERVISOR_SERVICE = 'supervisor';

/** The methods the supervisor answers, each `nebula.v1.svc.supervisor.<method>`. */
export const SUPERVISOR_METHODS = {
  /** Whether Docker can be reached, and how the platform itself runs. */
  status: 'status',

  /** Every container, as the list shows it. */
  list: 'list',

  /** One container, with everything the page shows about it. */
  inspect: 'inspect',

  /** The last lines a container wrote. */
  logs: 'logs',

  /** Start, stop or restart a container. */
  control: 'control',

  /** Pull the newest image and recreate a container on it. */
  update: 'update',

  /** Ask the registries again now, rather than at the next scheduled check. */
  checkUpdates: 'check_updates',

  /** Every container the loaded vendors declare, from `hub`: what should exist, whole. */
  reconcile: 'reconcile',

  /** The containers one vendor declares, after its settings changed. */
  ensure: 'ensure',

  /** Where the containers one vendor declares stand, for its page. */
  managed: 'managed',

  /** Stops every container an integration runs, before a restore swaps their data. */
  suspendManaged: 'suspend_managed',

  /** Starts them again afterwards. */
  resumeManaged: 'resume_managed',
} as const;

/** How many samples the supervisor keeps per container: a quarter of an hour at ten seconds. */
export const CONTAINER_SAMPLE_WINDOW = 90;

/**
 * A container's name, as Docker allows it.
 *
 * Docker's own rule, without the leading slash its API puts in front: a letter or digit, then
 * letters, digits, underscores, dots and dashes.
 */
export const CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

/** Validates a container's name. */
export const containerNameSchema = z
  .string()
  .regex(CONTAINER_NAME_PATTERN, 'Must be a container name');

/** What every container device's public id starts with, so no device the owner adds can take it. */
export const CONTAINER_DEVICE_PREFIX = 'container-';

/**
 * The longest slug a container contributes to its ids.
 *
 * Bounded by the entity id: `container_` + the slug + `_memory_usage` must fit the 64 characters
 * an object id may have.
 */
const MAXIMUM_SLUG_LENGTH = 40;

/**
 * A container's name as the ids made from it spell it.
 *
 * Lower case, every run of anything but a letter or digit one dash, no dash at either end, cut
 * to a length every id it goes into can hold. Two names can give one slug - `my_app` and
 * `my-app` - and the supervisor, which sees every name, gives the second none rather than a
 * device that would take the first one's entities.
 *
 * @param name - The container's name.
 * @returns The slug, never empty: a name with nothing to keep is `unnamed`.
 */
export function containerSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .slice(0, MAXIMUM_SLUG_LENGTH)
    .replaceAll(/^-+|-+$/g, '');

  return slug.length === 0 ? 'unnamed' : slug;
}

/**
 * The public id of a container's device: what the devices page lists it under.
 *
 * @param name - The container's name.
 * @returns `container-<slug>`.
 */
export function containerDeviceId(name: string): string {
  return `${CONTAINER_DEVICE_PREFIX}${containerSlug(name)}`;
}

/**
 * What a container's entity ids start with after the domain.
 *
 * @param name - The container's name.
 * @returns `container_<slug>`, with underscores where the slug has dashes.
 */
export function containerObjectPrefix(name: string): string {
  return `container_${containerSlug(name).replaceAll('-', '_')}`;
}

/** The states Docker gives a container. */
export const CONTAINER_STATES = [
  'created',
  'running',
  'paused',
  'restarting',
  'removing',
  'exited',
  'dead',
] as const;

/** A state Docker gives a container. */
export type ContainerState = (typeof CONTAINER_STATES)[number];

/** What a container's health check last said, for a container that has one. */
export const CONTAINER_HEALTH = ['starting', 'healthy', 'unhealthy'] as const;

/** What a container's health check last said. */
export type ContainerHealth = (typeof CONTAINER_HEALTH)[number];

/** What can be done to a container from the page. */
export const CONTAINER_ACTIONS = ['start', 'stop', 'restart'] as const;

/** What can be done to a container from the page. */
export type ContainerAction = (typeof CONTAINER_ACTIONS)[number];

/**
 * Why a container cannot be started, stopped, restarted or updated from here.
 *
 * `self` is the platform's own container - stopping it would stop the page asking - and
 * `managed` one an integration runs, which starts, stops and updates it itself.
 */
export const CONTAINER_REFUSALS = ['self', 'managed'] as const;

/** Why a container cannot be controlled from here. */
export type ContainerRefusal = (typeof CONTAINER_REFUSALS)[number];

/**
 * The words a secret is stored under, in an environment variable's name.
 *
 * The same idea the API applies to a configuration a bundle did not declare: by name, matched
 * without regard to case and anywhere in the name, because the same secret is `DB_PASSWORD`,
 * `API_KEY` and `ACCESS_TOKEN` depending on who wrote the image.
 */
const SECRET_NAME_PARTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'credential',
  'private_key',
];

/**
 * Whether an environment variable's value is kept from the page.
 *
 * @param name - The variable's name.
 * @returns True when the name says it holds a secret.
 */
export function isSecretName(name: string): boolean {
  const lower = name.toLowerCase();

  return SECRET_NAME_PARTS.some((part) => lower.includes(part));
}

/** A byte count. */
const byteCountSchema = z.number().min(0);

/** One published or exposed port. */
export const containerPortSchema = z.object({
  containerPort: z.int().min(0).max(65_535),
  protocol: z.string().min(1).max(8),

  /** The host address it is published on; null for a port only exposed. */
  hostIp: z.string().max(64).nullable(),
  hostPort: z.int().min(0).max(65_535).nullable(),
});

/** One published or exposed port. */
export type ContainerPort = z.output<typeof containerPortSchema>;

/** One volume, folder or memory file system mounted into a container. */
export const containerMountSchema = z.object({
  /** `volume`, `bind`, `tmpfs` and the rarer kinds, as Docker says them. */
  type: z.string().min(1).max(16),

  /** The volume's name or the host's folder; null for a memory file system. */
  source: z.string().max(1024).nullable(),
  destination: z.string().min(1).max(1024),
  isReadOnly: z.boolean(),

  /** The folder inside the volume, for a volume mounted in part. */
  subpath: z.string().max(1024).nullable(),
});

/** One mount. */
export type ContainerMount = z.output<typeof containerMountSchema>;

/** One network a container is on. */
export const containerNetworkSchema = z.object({
  name: z.string().min(1).max(256),
  ipAddress: z.string().max(64).nullable(),
  gateway: z.string().max(64).nullable(),
  aliases: z.array(z.string().max(256)),
});

/** One network a container is on. */
export type ContainerNetwork = z.output<typeof containerNetworkSchema>;

/** One environment variable, its value withheld when its name says it is a secret. */
export const containerEnvSchema = z.object({
  name: z.string().min(1).max(512),
  value: z.string().max(8192).nullable(),
  isHidden: z.boolean(),
});

/** One environment variable. */
export type ContainerEnv = z.output<typeof containerEnvSchema>;

/** One device of the host handed to a container: a serial adapter, a camera. */
export const containerDeviceMappingSchema = z.object({
  host: z.string().min(1).max(1024),
  container: z.string().min(1).max(1024),
});

/** One device of the host handed to a container. */
export type ContainerDeviceMapping = z.output<typeof containerDeviceMappingSchema>;

/**
 * What the supervisor knows about a container's image and a newer one.
 *
 * `latestVersion` is what the registry offers: the highest release of the same shape for an
 * image pinned to a version, the version the tag now points at for one that follows a tag such as
 * `latest`. Null when it was never asked, or could not be - an installation without the internet
 * has nothing to compare against and says so through `checkedAt` and `error`, not a failure.
 */
export const containerUpdateSchema = z.object({
  installedVersion: z.string().max(128).nullable(),
  latestVersion: z.string().max(128).nullable(),
  isAvailable: z.boolean(),
  checkedAt: timestampSchema.nullable(),
  error: z.string().max(512).nullable(),
  isInstalling: z.boolean(),

  /** How far the pull has got, 0 to 100, while installing. */
  progress: z.number().min(0).max(100).nullable(),
});

/** What the supervisor knows about a container's image and a newer one. */
export type ContainerUpdate = z.output<typeof containerUpdateSchema>;

/** Which integration runs a container. */
export const containerManagerSchema = z.object({
  vendorId: z.string().min(1).max(64),

  /** Which of the vendor's declared containers it is. */
  dependencyId: z.string().min(1).max(64),

  /**
   * True once the vendor no longer declares it - the bundle was removed, or no longer needs it.
   * The container is then the owner's again: it can be controlled, and nothing restarts it.
   */
  isReleased: z.boolean(),
});

/** Which integration runs a container. */
export type ContainerManager = z.output<typeof containerManagerSchema>;

/** One measurement of a running container. */
export const containerSampleSchema = z.object({
  at: timestampSchema,

  /** How much of the machine's processor it used since the sample before, all cores together. */
  cpuPercent: z.number().min(0).max(100),
  memoryUsedBytes: byteCountSchema,

  /** Its memory limit, or the host's memory when it has none. */
  memoryLimitBytes: byteCountSchema,
});

/** One measurement of a running container. */
export type ContainerSample = z.output<typeof containerSampleSchema>;

/** One container, as the list shows it. */
export const containerSummarySchema = z.object({
  /** Docker's id, the full 64 characters. */
  id: z.string().regex(/^[0-9a-f]{12,64}$/),
  name: containerNameSchema,

  /** Its device's public id; null for the platform's own container, which has none. */
  deviceId: z.string().nullable(),

  /** The image as the container was created from it: `koenkk/zigbee2mqtt:2.14.1`. */
  image: z.string().min(1).max(512),

  /** The version it runs, from the image's label or its tag; null when neither says. */
  version: z.string().max(128).nullable(),
  state: z.enum(CONTAINER_STATES),

  /** Docker's own sentence for it: `Up 3 hours`, `Exited (0) 2 minutes ago`. */
  status: z.string().max(256),
  health: z.enum(CONTAINER_HEALTH).nullable(),
  createdAt: timestampSchema,
  startedAt: timestampSchema.nullable(),

  /** The platform's own container: listed, measured, never controlled. */
  isSelf: z.boolean(),
  managedBy: containerManagerSchema.nullable(),

  /** The image's page on its registry - Docker Hub, GitHub - when it has one people can read. */
  registryUrl: z.url().nullable(),

  /** The last sample, null while it is not running or before the first one. */
  cpuPercent: z.number().min(0).max(100).nullable(),
  memoryUsedBytes: byteCountSchema.nullable(),
  memoryLimitBytes: byteCountSchema.nullable(),

  update: containerUpdateSchema,

  /** Why it cannot be controlled from here; null when it can. */
  refusal: z.enum(CONTAINER_REFUSALS).nullable(),
});

/** One container, as the list shows it. */
export type ContainerSummary = z.output<typeof containerSummarySchema>;

/** One container, with everything its page shows. */
export const containerDetailSchema = containerSummarySchema.extend({
  command: z.string().max(4096).nullable(),

  /** `no`, `always`, `unless-stopped`, `on-failure`. */
  restartPolicy: z.string().max(32).nullable(),

  /** `bridge`, `host`, `none`, or the name of the network it was started on. */
  networkMode: z.string().max(256),
  hostname: z.string().max(256).nullable(),
  networks: z.array(containerNetworkSchema),
  ports: z.array(containerPortSchema),
  mounts: z.array(containerMountSchema),
  devices: z.array(containerDeviceMappingSchema),
  env: z.array(containerEnvSchema),
  labels: z.record(z.string(), z.string()),

  /** How far apart the samples are. */
  sampleIntervalMs: z.int().min(1),

  /** Oldest first, at most {@link CONTAINER_SAMPLE_WINDOW}. */
  samples: z.array(containerSampleSchema).max(CONTAINER_SAMPLE_WINDOW),

  /** What the owner should know about it: a volume kept outside the backups, a failed start. */
  warnings: z.array(z.string().max(512)),

  /** The port of the container's own web page on this machine, for one that serves one. */
  webPort: z.int().min(1).max(65_535).nullable(),
});

/** One container, with everything its page shows. */
export type ContainerDetail = z.output<typeof containerDetailSchema>;

/** How the platform itself runs, as far as reaching its containers goes. */
export const PLATFORM_NETWORK_MODES = ['bridge', 'host', 'native'] as const;

/** How the platform itself runs. */
export type PlatformNetworkMode = (typeof PLATFORM_NETWORK_MODES)[number];

/** Whether Docker can be reached, and what the supervisor found about the platform. */
export const dockerStatusSchema = z.object({
  isAvailable: z.boolean(),

  /** The engine's version: `28.1.1`. */
  version: z.string().max(64).nullable(),
  apiVersion: z.string().max(16).nullable(),

  /** Why it cannot be reached, in English, when it cannot. */
  reason: z.string().max(512).nullable(),

  /**
   * `native` when the platform is not in a container at all (development), `host` or `bridge`
   * for the network its container is on; null while Docker cannot be reached.
   */
  platformNetwork: z.enum(PLATFORM_NETWORK_MODES).nullable(),
});

/** Whether Docker can be reached. */
export type DockerStatus = z.output<typeof dockerStatusSchema>;

/** The reply to `svc.supervisor.list`. */
export const containerListReplySchema = z.object({
  docker: dockerStatusSchema,
  containers: z.array(containerSummarySchema),
});

/** The reply to `svc.supervisor.list`. */
export type ContainerListReply = z.output<typeof containerListReplySchema>;

/** `GET /containers`: whether Docker can be seen, and every container. */
export const containersViewSchema = z.object({
  docker: dockerStatusSchema,
  items: z.array(containerSummarySchema),
});

/** `GET /containers`. */
export type ContainersView = z.output<typeof containersViewSchema>;

/** `GET /containers/:name/logs`. */
export const containerLogsQuerySchema = z.object({
  tail: z.coerce.number().int().min(1).max(2000).default(200),
});

/** `svc.supervisor.status`, `list`, `check_updates`, `suspend_managed`, `resume_managed`. */
export const supervisorEmptyRequestSchema = z.strictObject({});

/** `svc.supervisor.inspect` and `svc.supervisor.update`: which container. */
export const containerNameRequestSchema = z.strictObject({ name: containerNameSchema });

/** Which container. */
export type ContainerNameRequest = z.output<typeof containerNameRequestSchema>;

/** The most lines a caller may ask for. */
export const CONTAINER_LOG_MAXIMUM_LINES = 2000;

/** `svc.supervisor.logs`. */
export const containerLogsRequestSchema = z.strictObject({
  name: containerNameSchema,
  tail: z.int().min(1).max(CONTAINER_LOG_MAXIMUM_LINES).default(200),
});

/** Which container, and how many lines. */
export type ContainerLogsRequest = z.output<typeof containerLogsRequestSchema>;

/** One line a container wrote. */
export const containerLogLineSchema = z.object({
  /** When Docker received it; null when the line carried no time. */
  at: timestampSchema.nullable(),
  stream: z.enum(['stdout', 'stderr']),
  text: z.string().max(16_384),
});

/** One line a container wrote. */
export type ContainerLogLine = z.output<typeof containerLogLineSchema>;

/** The reply to `svc.supervisor.logs`: oldest first. */
export const containerLogsReplySchema = z.object({
  lines: z.array(containerLogLineSchema).max(CONTAINER_LOG_MAXIMUM_LINES),
});

/** The reply to `svc.supervisor.logs`. */
export type ContainerLogsReply = z.output<typeof containerLogsReplySchema>;

/** `svc.supervisor.control`. */
export const containerControlRequestSchema = z.strictObject({
  name: containerNameSchema,
  action: z.enum(CONTAINER_ACTIONS),
});

/** What to do to which container. */
export type ContainerControlRequest = z.output<typeof containerControlRequestSchema>;

/** A reply that says only that the call was taken. */
export const supervisorAcknowledgementSchema = z.object({ ok: z.literal(true) });

// ---------------------------------------------------------------------------------------------
// The containers an integration runs
// ---------------------------------------------------------------------------------------------

/**
 * An id a bundle gives one of its containers: `zigbee2mqtt`, `mosquitto`. It names the
 * container and its folder of the data directory, so it is a directory name people read.
 */
export const DEPENDENCY_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/** A volume of a container an integration runs: a name, and where the container sees it. */
export const managedVolumeSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  path: z.string().regex(/^\/[^\s]*$/, 'Must be an absolute path in the container'),

  /**
   * True for what can be made again: kept under the cache, which no backup takes. False for what
   * is the owner's - the Zigbee network's key and every pairing - which every backup takes.
   */
  isCache: z.boolean(),
});

/** A volume of a container an integration runs. */
export type ManagedVolume = z.output<typeof managedVolumeSchema>;

/**
 * One container an integration runs, as `hub` hands it over: the bundle's declaration with the
 * vendor's settings put in.
 *
 * What is left in braces is the platform's to fill, since only the supervisor knows how the
 * container it creates reaches the rest of the platform: `{platform.mqtt.url}`,
 * `{platform.mqtt.username}`, `{platform.mqtt.password}`, `{platform.timezone}`. No path of the
 * host appears but the devices, which the owner typed: where a volume lives is the platform's to
 * choose, never a bundle's.
 */
export const managedContainerSpecSchema = z.object({
  vendorId: z.string().min(1).max(64),
  dependencyId: z.string().regex(DEPENDENCY_ID_PATTERN),

  /** What the interface calls it. */
  name: z.string().min(1).max(128),

  /** The image without a tag: `koenkk/zigbee2mqtt`, `ghcr.io/owner/image`. */
  image: z.string().regex(/^[a-z0-9][a-z0-9._/:-]{0,254}$/),

  /** The oldest release the integration works with. */
  minVersion: z.string().regex(SEMVER_PATTERN),

  env: z.array(z.object({ name: z.string().min(1).max(256), value: z.string().max(4096) })),
  volumes: z.array(managedVolumeSchema).max(8),
  devices: z.array(containerDeviceMappingSchema).max(8),
  ports: z
    .array(
      z.object({
        container: z.int().min(1).max(65_535),
        host: z.int().min(1).max(65_535),
        protocol: z.enum(['tcp', 'udp']),
      }),
    )
    .max(8),

  /** Files written into a volume once, when missing: a first configuration. */
  seed: z
    .array(
      z.object({
        volume: z.string().min(1).max(32),
        path: z
          .string()
          .regex(/^[a-zA-Z0-9._-][a-zA-Z0-9._/-]{0,254}$/)
          .refine((value) => !value.split('/').includes('..'), 'Must stay inside its volume'),
        content: z.string().max(65_536),
      }),
    )
    .max(8),

  /** The container port its own web page is on, when it serves one and it is published. */
  webPort: z.int().min(1).max(65_535).nullable(),
});

/** One container an integration runs, as `hub` hands it over. */
export type ManagedContainerSpec = z.output<typeof managedContainerSpecSchema>;

/** The containers one vendor runs. */
export const vendorContainersSchema = z.object({
  vendorId: z.string().min(1).max(64),
  containers: z.array(managedContainerSpecSchema).max(8),
});

/** The containers one vendor runs. */
export type VendorContainers = z.output<typeof vendorContainersSchema>;

/**
 * `svc.supervisor.reconcile`: every container every loaded vendor declares, whole. A managed
 * container of a vendor not in it is released.
 */
export const reconcileRequestSchema = z.strictObject({
  vendors: z.array(vendorContainersSchema),
});

/** Every container every loaded vendor declares. */
export type ReconcileRequest = z.output<typeof reconcileRequestSchema>;

/** `svc.supervisor.ensure`: one vendor's containers, after its settings changed. */
export const ensureRequestSchema = z.strictObject(vendorContainersSchema.shape);

/** One vendor's containers. */
export type EnsureRequest = z.output<typeof ensureRequestSchema>;

/** Where one declared container stands. */
export const managedStatusSchema = z.object({
  vendorId: z.string().min(1).max(64),
  dependencyId: z.string().regex(DEPENDENCY_ID_PATTERN),

  /** Its name in Docker, once it exists. */
  containerName: containerNameSchema.nullable(),
  state: z.enum([...CONTAINER_STATES, 'missing', 'pulling']),
  version: z.string().max(128).nullable(),

  /** Why it is not running, in English. */
  error: z.string().max(1024).nullable(),
});

/** Where one declared container stands. */
export type ManagedStatus = z.output<typeof managedStatusSchema>;

/** `svc.supervisor.managed`: which vendor. */
export const managedRequestSchema = z.strictObject({ vendorId: z.string().min(1).max(64) });

/**
 * The reply to `reconcile`, `ensure` and `managed`. The work - a pull can take minutes - goes on after the
 * reply, which says what was found when it was asked.
 */
export const managedReplySchema = z.object({ containers: z.array(managedStatusSchema) });

/** The reply to `reconcile` and `ensure`. */
export type ManagedReply = z.output<typeof managedReplySchema>;

// ---------------------------------------------------------------------------------------------
// Events and entities
// ---------------------------------------------------------------------------------------------

/** What happened to a container that a page showing it should hear about. */
export const containerEventSchema = z.object({
  name: containerNameSchema,

  /** `changed`: started, stopped, updated, measured anew. `removed`: gone from Docker. */
  event: z.enum(['changed', 'removed']),
});

/** What happened to a container. */
export type ContainerEvent = z.output<typeof containerEventSchema>;

/** Which reading a container entity carries. */
export const CONTAINER_READINGS = ['cpu', 'memory', 'memory_used', 'running', 'image'] as const;

/** Which reading a container entity carries. */
export type ContainerReading = (typeof CONTAINER_READINGS)[number];

/** One container entity, before it is named after its container. */
export type ContainerEntityDefinition = Omit<
  z.input<typeof entityRegistrationSchema>,
  'entityId' | 'capabilities'
> & {
  readonly reading: ContainerReading;

  /** `sensor`, `binary_sensor`, `update`. */
  readonly domain: 'sensor' | 'binary_sensor' | 'update';

  /** What follows `container_<slug>_` in the entity id. */
  readonly suffix: string;
};

/**
 * The entities every container but the platform's own has.
 *
 * Percentages for the processor and the memory, so "above 90" means the same thing in every
 * container, and the memory in bytes beside them, because a container without a limit is judged
 * against the whole machine. Running is a state of its own for an automation to watch, and the
 * image an `update` entity: the version it runs, the one on offer, and installing it.
 */
export const CONTAINER_ENTITIES = [
  {
    reading: 'cpu',
    domain: 'sensor',
    suffix: 'cpu_usage',
    name: 'Processor usage',
    icon: 'cpu',
    unitOfMeasurement: '%',
    stateClass: 'measurement',
    displayPrecision: 1,
  },
  {
    reading: 'memory',
    domain: 'sensor',
    suffix: 'memory_usage',
    name: 'Memory usage',
    icon: 'memory-stick',
    unitOfMeasurement: '%',
    stateClass: 'measurement',
    displayPrecision: 1,
  },
  {
    reading: 'memory_used',
    domain: 'sensor',
    suffix: 'memory_used',
    name: 'Memory used',
    icon: 'memory-stick',
    deviceClass: 'data_size',
    unitOfMeasurement: 'B',
    stateClass: 'measurement',
    displayPrecision: 0,
  },
  {
    reading: 'running',
    domain: 'binary_sensor',
    suffix: 'running',
    name: 'Running',
    icon: 'play',
    deviceClass: 'running',
  },
  {
    reading: 'image',
    domain: 'update',
    suffix: 'image',
    name: 'Image',
    icon: 'circle-arrow-up',
  },
] as const satisfies readonly ContainerEntityDefinition[];

/**
 * One container's device, as the supervisor hands it to `core`: the name, what it runs, and its
 * entities already named after it.
 */
export const containerDeviceRegistrationSchema = z.strictObject({
  /** The container's name, which is the device's `external_id`. */
  name: containerNameSchema,

  /** The image it runs, which is the device's model. */
  image: z.string().min(1).max(128),
  swVersion: z.string().min(1).max(64).optional(),
  entities: z.array(entityRegistrationSchema).min(1),
});

/** One container's device, as the supervisor hands it to `core`. */
export type ContainerDeviceRegistration = z.output<typeof containerDeviceRegistrationSchema>;

/**
 * `svc.core.sync_containers`: every container but the platform's own, whole. `core` writes a
 * device for each, and removes the device of a container that is no longer in the list.
 */
export const syncContainersRequestSchema = z.strictObject({
  containers: z.array(containerDeviceRegistrationSchema).max(1000),
});

/** Every container but the platform's own. */
export type SyncContainersRequest = z.output<typeof syncContainersRequestSchema>;

/** What `core` wrote, and which gone containers it kept because an alias still reads them. */
export const syncContainersReplySchema = z.object({
  devices: z.array(
    z.object({
      deviceId: z.string().min(1).max(64),
      name: containerNameSchema,
      entityIds: z.array(entityIdSchema),
    }),
  ),
  kept: z.array(containerNameSchema),
});

/** What `core` wrote. */
export type SyncContainersReply = z.output<typeof syncContainersReplySchema>;

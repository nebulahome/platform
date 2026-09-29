/**
 * The supervisor: the one service that speaks to Docker.
 *
 * It holds the Docker socket - which is root on the host, so nothing else may - lists every
 * container the host runs, tells the platform's own container apart, measures the others, starts,
 * stops, restarts and updates them, and runs the containers an integration depends on. Every
 * other service asks it on the bus: `api` for the containers page, `hub` for the containers a
 * vendor's bundle declares, `backup` to stop them around a restore.
 *
 * Each container but the platform's own - the one it runs in and the others of its compose file,
 * the system containers - is also a device in the registry, with a handful of entities `core`
 * writes when the supervisor tells it which containers there are, and whose states the supervisor
 * reports as an adapter would. Their `source` is the supervisor.
 *
 * The owner can also add containers from here: one image from a registry, with its ports, its
 * environment and its volumes, or a whole compose project, written or uploaded, which the
 * supervisor keeps in the data directory and runs with `docker compose`.
 *
 * Defined in ARCHITECTURE.md 4.10.
 */
import { z } from 'zod';

import { DEPENDENCY_ID_PATTERN } from './container-dependencies.js';
import { entityIdSchema } from './entity-id.js';
import { entityRegistrationSchema } from './registration.js';
import { SEMVER_PATTERN } from './semver.js';
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

  /** Looks for images on Docker Hub. */
  searchImages: 'search_images',

  /** The tags of one image, newest first. */
  imageTags: 'image_tags',

  /** What one image declares: its ports, its environment, its volumes. */
  describeImage: 'describe_image',

  /** Pulls an image and runs a container of it. Answers at once; the pull goes on. */
  install: 'install',

  /** Forgets an install that failed, once the owner has read why. */
  dismissInstall: 'dismiss_install',

  /** Stops and removes a container the owner may control. */
  remove: 'remove',

  /** Checks a compose file without running anything. */
  composeValidate: 'compose_validate',

  /** Keeps a compose file and brings the project up with it: a new one, or an edit. */
  composeDeploy: 'compose_deploy',

  /** The file and environment of a project the platform deployed. */
  composeGet: 'compose_get',

  /** Starts, stops, or pulls newer images for every service of a project. */
  composeControl: 'compose_control',

  /** Takes a project down, and forgets it. */
  composeRemove: 'compose_remove',
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
 * Why a container cannot be started, stopped, restarted, updated or removed from here.
 *
 * `self` is the platform's own container - stopping it would stop the page asking - `system` one
 * of the rest of the platform's compose file, which the platform needs as much, and `managed` one
 * an integration runs, which starts, stops and updates it itself.
 */
export const CONTAINER_REFUSALS = ['self', 'system', 'managed'] as const;

/** Why a container cannot be controlled from here. */
export type ContainerRefusal = (typeof CONTAINER_REFUSALS)[number];

/**
 * The label every container of the platform's own compose file carries, so the supervisor tells
 * them apart even when the platform itself does not run in a container (development).
 */
export const PLATFORM_LABEL = 'io.nebulahome.platform';

/** The label every service of a compose project the platform deployed carries. */
export const COMPOSE_LABEL = 'io.nebulahome.compose';

/** The label a container the owner installed from here carries. */
export const INSTALLED_LABEL = 'io.nebulahome.installed';

/** The compose project the platform itself is run as, which no project written here may take. */
export const PLATFORM_COMPOSE_PROJECT = 'nebulahome';

/** A compose project's name, as `docker compose` allows it. */
export const COMPOSE_PROJECT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** Validates a compose project's name. */
export const composeProjectNameSchema = z
  .string()
  .regex(
    COMPOSE_PROJECT_PATTERN,
    'Must be lower-case letters, digits, dashes and underscores, starting with a letter or digit',
  );

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

/**
 * Who declares a container the platform runs: a vendor, in its `manifest.json` - reconciled by
 * `hub` - or a package, in its `nebula.package.json` - reconciled by the packet-manager. Each
 * reconciles its own kind, so neither releases the other's.
 */
export const CONTAINER_OWNER_KINDS = ['vendor', 'package'] as const;

/** Who declares a container the platform runs. */
export type ContainerOwnerKind = (typeof CONTAINER_OWNER_KINDS)[number];

/** Which integration or package runs a container. */
export const containerManagerSchema = z.object({
  ownerKind: z.enum(CONTAINER_OWNER_KINDS).default('vendor'),

  /** The vendor, or the package when `ownerKind` says so. */
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

/** The compose project a container belongs to, from the labels `docker compose` puts on it. */
export const containerComposeSchema = z.object({
  project: z.string().min(1).max(128),
  service: z.string().min(1).max(128),

  /** Which replica of the service it is, from 1. */
  number: z.int().min(1).nullable(),

  /** Where the project's files were on the machine that ran `docker compose`. */
  workingDir: z.string().max(1024).nullable(),
  configFiles: z.array(z.string().max(1024)).max(16),

  /** The version of `docker compose` that made it. */
  version: z.string().max(64).nullable(),

  /** Whether the platform deployed the project and keeps its file, so it is edited from here. */
  isEditable: z.boolean(),
});

/** The compose project a container belongs to. */
export type ContainerCompose = z.output<typeof containerComposeSchema>;

/** One container, as the list shows it. */
export const containerSummarySchema = z.object({
  /** Docker's id, the full 64 characters. */
  id: z.string().regex(/^[0-9a-f]{12,64}$/),
  name: containerNameSchema,

  /**
   * What the interface calls it: `Zigbee2MQTT` for `nebulahome-zigbee2mqtt`, `Postgres` for the
   * `postgres` service of a compose project. The name stays what addresses it.
   */
  displayName: z.string().min(1).max(128),

  /** Its device's public id; null for a system container, which has none. */
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

  /** One of the platform's compose file, itself among them: listed, measured, never controlled. */
  isSystem: z.boolean(),
  managedBy: containerManagerSchema.nullable(),

  /** The compose project it belongs to; null for a container started on its own. */
  compose: containerComposeSchema.nullable(),

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

  /**
   * The version of `docker compose` the supervisor runs compose projects with; null where the
   * plugin is not installed, and no compose project can be deployed from here.
   */
  composeVersion: z.string().max(64).nullable(),
});

/** Whether Docker can be reached. */
export type DockerStatus = z.output<typeof dockerStatusSchema>;

/** Where an install the owner asked for stands. */
export const CONTAINER_INSTALL_PHASES = ['pulling', 'creating', 'starting', 'failed'] as const;

/** One container being installed: pulled, made and started, before Docker lists it running. */
export const containerInstallSchema = z.object({
  name: containerNameSchema,

  /** The image with its tag. */
  image: z.string().min(1).max(512),
  phase: z.enum(CONTAINER_INSTALL_PHASES),

  /** How far the pull has got, 0 to 100, while pulling. */
  progress: z.number().min(0).max(100).nullable(),

  /** Why it failed, in English. */
  error: z.string().max(1024).nullable(),
  startedAt: timestampSchema,
});

/** One container being installed. */
export type ContainerInstall = z.output<typeof containerInstallSchema>;

/** What can be done to a whole compose project the platform deployed. */
export const COMPOSE_ACTIONS = ['deploy', 'start', 'stop', 'pull', 'remove'] as const;

/** What can be done to a whole compose project. */
export type ComposeAction = (typeof COMPOSE_ACTIONS)[number];

/** Where an operation on a compose project stands. */
export const COMPOSE_PHASES = [
  'pulling',
  'starting',
  'stopping',
  'removing',
  'done',
  'failed',
] as const;

/** Where an operation on a compose project stands. */
export type ComposePhase = (typeof COMPOSE_PHASES)[number];

/** How many lines of `docker compose` an operation keeps. */
export const COMPOSE_LOG_LINES = 200;

/** The last operation on a compose project the platform deployed, and what it wrote. */
export const composeOperationSchema = z.object({
  project: composeProjectNameSchema,
  action: z.enum(COMPOSE_ACTIONS),
  phase: z.enum(COMPOSE_PHASES),

  /** The last lines `docker compose` wrote, oldest first. */
  log: z.array(z.string().max(2048)).max(COMPOSE_LOG_LINES),
  error: z.string().max(4096).nullable(),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
});

/** The last operation on a compose project. */
export type ComposeOperation = z.output<typeof composeOperationSchema>;

/** The reply to `svc.supervisor.list`. */
export const containerListReplySchema = z.object({
  docker: dockerStatusSchema,
  containers: z.array(containerSummarySchema),
  installs: z.array(containerInstallSchema),

  /** The last operation on each compose project the platform deployed. */
  composeOperations: z.array(composeOperationSchema),
});

/** The reply to `svc.supervisor.list`. */
export type ContainerListReply = z.output<typeof containerListReplySchema>;

/** `GET /containers`: whether Docker can be seen, and every container. */
export const containersViewSchema = z.object({
  docker: dockerStatusSchema,
  items: z.array(containerSummarySchema),
  installs: z.array(containerInstallSchema),
  composeOperations: z.array(composeOperationSchema),
});

/** `GET /containers`. */
export type ContainersView = z.output<typeof containersViewSchema>;

/**
 * Where a container's log was last read up to: the time Docker received the last line, to the
 * nanosecond, as the seconds since 1970 and their fraction - `1790608123.123456789`, what Docker's
 * own `since` takes. Opaque to a caller, which hands back the one it was given.
 */
export const containerLogCursorSchema = z
  .string()
  .regex(/^\d{1,12}(?:\.\d{1,9})?$/, 'Must be a cursor a previous read returned');

/** `GET /containers/:name/logs`. */
export const containerLogsQuerySchema = z.object({
  tail: z.coerce.number().int().min(1).max(2000).default(200),

  /** Only the lines after this cursor, for a page that follows the log: what the last read gave. */
  since: containerLogCursorSchema.optional(),
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

  /** Only the lines after this cursor; at most `tail` of them, the newest. */
  since: containerLogCursorSchema.optional(),
});

/**
 * The most a reply of lines may weigh, in characters: under NATS' one megabyte with room for the
 * envelope, however long the lines. A reply that would be heavier keeps its newest lines.
 */
export const CONTAINER_LOG_MAXIMUM_CHARACTERS = 512_000;

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

  /**
   * Where the next read carries on from, handed back as `since`: the last line's, or the one
   * asked with when nothing new came. Null when no line carried a time.
   */
  cursor: containerLogCursorSchema.nullable().default(null),

  /** Whether older lines were left out to keep the reply under its weight. */
  isTruncated: z.boolean().default(false),
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
// The containers the owner adds
// ---------------------------------------------------------------------------------------------

/** An image without its tag: `nginx`, `traefik/whoami`, `ghcr.io/owner/image`. */
export const imageRepositorySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._/:-]{0,254}$/, 'Must be an image name');

/** A tag, as Docker allows it. */
export const imageTagNameSchema = z.string().regex(/^\w[\w.-]{0,127}$/, 'Must be an image tag');

/** A port number. */
const portNumberSchema = z.int().min(1).max(65_535);

/** A path inside a container. */
const containerPathSchema = z
  .string()
  .max(1024)
  .regex(/^\/\S*$/, 'Must be an absolute path in the container');

/** `svc.supervisor.search_images`. */
export const imageSearchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(128),
});

/** One image Docker Hub found. */
export const imageSearchResultSchema = z.object({
  /** What to pull: `nginx` for an official image, `traefik/whoami` for another. */
  repository: z.string().min(1).max(256),
  description: z.string().max(1024).nullable(),
  stars: z.int().min(0),
  pulls: z.number().min(0),
  isOfficial: z.boolean(),
});

/** One image Docker Hub found. */
export type ImageSearchResult = z.output<typeof imageSearchResultSchema>;

/** The reply to `svc.supervisor.search_images`. */
export const imageSearchReplySchema = z.object({
  results: z.array(imageSearchResultSchema).max(50),
});

/** The reply to `svc.supervisor.search_images`. */
export type ImageSearchReply = z.output<typeof imageSearchReplySchema>;

/** `svc.supervisor.image_tags`. */
export const imageTagsRequestSchema = z.strictObject({ image: imageRepositorySchema });

/** One tag of an image. */
export const imageTagSchema = z.object({
  name: z.string().min(1).max(128),

  /** When it was last pushed, where the registry says. */
  updatedAt: timestampSchema.nullable(),

  /** The compressed size of this machine's image, where the registry says. */
  bytes: z.number().min(0).nullable(),
});

/** One tag of an image. */
export type ImageTag = z.output<typeof imageTagSchema>;

/** The reply to `svc.supervisor.image_tags`: the newest first. */
export const imageTagsReplySchema = z.object({ tags: z.array(imageTagSchema).max(100) });

/** The reply to `svc.supervisor.image_tags`. */
export type ImageTagsReply = z.output<typeof imageTagsReplySchema>;

/** `svc.supervisor.describe_image`. */
export const imageDescribeRequestSchema = z.strictObject({
  image: imageRepositorySchema,
  tag: imageTagNameSchema,
});

/** What an image declares, for the install form to start from. */
export const imageDescriptionSchema = z.object({
  version: z.string().max(128).nullable(),
  description: z.string().max(1024).nullable(),
  ports: z.array(z.object({ container: portNumberSchema, protocol: z.enum(['tcp', 'udp']) })),
  env: z.array(z.object({ name: z.string().min(1).max(256), value: z.string().max(8192) })),

  /** The paths it declares as volumes. */
  volumes: z.array(z.string().max(1024)),
});

/** What an image declares. */
export type ImageDescription = z.output<typeof imageDescriptionSchema>;

/** The restart policies the install form offers. */
export const RESTART_POLICIES = ['no', 'always', 'unless-stopped', 'on-failure'] as const;

/** A restart policy. */
export type RestartPolicy = (typeof RESTART_POLICIES)[number];

/**
 * The networks an installed container can join: Docker's default bridge, the host's network, or
 * the one the platform shares with the containers integrations run (and, on a bridge, with itself).
 */
export const INSTALL_NETWORKS = ['bridge', 'host', 'platform'] as const;

/** A network an installed container can join. */
export type InstallNetwork = (typeof INSTALL_NETWORKS)[number];

/** A folder of a container, and where it is kept. */
export const installVolumeSchema = z.discriminatedUnion('kind', [
  z.object({
    /** A folder of the platform's data directory: backed up with the rest. */
    kind: z.literal('data'),
    name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, 'Must be a short folder name'),
    target: containerPathSchema,
    isReadOnly: z.boolean(),
  }),
  z.object({
    /** A Docker volume, made when missing. */
    kind: z.literal('volume'),
    name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/, 'Must be a volume name'),
    target: containerPathSchema,
    isReadOnly: z.boolean(),
  }),
  z.object({
    /** A folder of the machine. */
    kind: z.literal('bind'),
    source: z
      .string()
      .max(1024)
      .regex(/^\/\S*$/, 'Must be an absolute path on the machine'),
    target: containerPathSchema,
    isReadOnly: z.boolean(),
  }),
]);

/** A folder of a container, and where it is kept. */
export type InstallVolume = z.output<typeof installVolumeSchema>;

/** `svc.supervisor.install`, and `POST /containers`. */
export const containerInstallRequestSchema = z.strictObject({
  name: containerNameSchema,
  image: imageRepositorySchema,
  tag: imageTagNameSchema,
  ports: z
    .array(
      z.object({
        host: portNumberSchema,
        container: portNumberSchema,
        protocol: z.enum(['tcp', 'udp']),
      }),
    )
    .max(32),
  env: z
    .array(
      z.object({
        name: z.string().regex(/^[A-Za-z_][\w.-]{0,255}$/, 'Must be a variable name'),
        value: z.string().max(8192),
      }),
    )
    .max(128),
  volumes: z.array(installVolumeSchema).max(32),
  devices: z.array(containerDeviceMappingSchema).max(8),
  restartPolicy: z.enum(RESTART_POLICIES),
  network: z.enum(INSTALL_NETWORKS),
});

/** A container to install. */
export type ContainerInstallRequest = z.output<typeof containerInstallRequestSchema>;

/** `svc.supervisor.remove`. */
export const containerRemoveRequestSchema = z.strictObject({
  name: containerNameSchema,

  /** Also the volumes Docker made for it alone: not a named volume, not a folder. */
  removeVolumes: z.boolean(),
});

/** Which container to remove. */
export type ContainerRemoveRequest = z.output<typeof containerRemoveRequestSchema>;

/** The largest compose file taken. */
export const COMPOSE_FILE_MAXIMUM_BYTES = 256 * 1024;

/** A compose project, as the owner wrote or uploaded it. */
export const composeDefinitionSchema = z.strictObject({
  project: composeProjectNameSchema,
  file: z.string().min(1).max(COMPOSE_FILE_MAXIMUM_BYTES),

  /** What the project's `.env` holds: the values the file interpolates. */
  env: z
    .string()
    .max(64 * 1024)
    .default(''),
});

/** A compose project, as the owner wrote it. */
export type ComposeDefinition = z.output<typeof composeDefinitionSchema>;

/** One thing wrong with a compose file. */
export const composeProblemSchema = z.object({
  /** The line of the file, when `docker compose` said. */
  line: z.int().min(1).nullable(),
  message: z.string().max(2048),
});

/** One thing wrong with a compose file. */
export type ComposeProblem = z.output<typeof composeProblemSchema>;

/** The reply to `svc.supervisor.compose_validate`. */
export const composeValidationSchema = z.object({
  problems: z.array(composeProblemSchema),

  /** The services the file declares, when it is valid. */
  services: z.array(z.string().max(128)),
});

/** The reply to `svc.supervisor.compose_validate`. */
export type ComposeValidation = z.output<typeof composeValidationSchema>;

/** `svc.supervisor.compose_get`: which project. */
export const composeProjectRequestSchema = z.strictObject({ project: composeProjectNameSchema });

/** A project the platform deployed, as it keeps it. */
export const composeDocumentSchema = z.object({
  project: composeProjectNameSchema,
  file: z.string(),
  env: z.string(),
  updatedAt: timestampSchema,
});

/** A project the platform deployed. */
export type ComposeDocument = z.output<typeof composeDocumentSchema>;

/** `svc.supervisor.compose_control`. */
export const composeControlRequestSchema = z.strictObject({
  project: composeProjectNameSchema,
  action: z.enum(['start', 'stop', 'pull']),
});

/** What to do to a whole project. */
export type ComposeControlRequest = z.output<typeof composeControlRequestSchema>;

/** `svc.supervisor.compose_remove`. */
export const composeRemoveRequestSchema = z.strictObject({
  project: composeProjectNameSchema,

  /** Also its volumes, named ones included. */
  removeVolumes: z.boolean(),

  /** Also its folder of the data directory: the file, and every folder its services kept there. */
  removeFiles: z.boolean(),
});

/** Which project to remove, and how much of it. */
export type ComposeRemoveRequest = z.output<typeof composeRemoveRequestSchema>;

// ---------------------------------------------------------------------------------------------
// The containers an integration runs
// ---------------------------------------------------------------------------------------------

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
  ownerKind: z.enum(CONTAINER_OWNER_KINDS).default('vendor'),

  /** The vendor that declares it, or the package when `ownerKind` says so. */
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

  /** The MQTT topics its broker username is held to; every topic when absent. */
  mqttTopics: z.array(z.string().min(1).max(256)).max(16).optional(),
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
  /** Whose containers these are; a managed container of another owner of this kind is released. */
  ownerKind: z.enum(CONTAINER_OWNER_KINDS).default('vendor'),

  /** Every owner of the kind, with its containers: vendors, or packages. */
  vendors: z.array(vendorContainersSchema),
});

/** Every container every loaded vendor declares. */
export type ReconcileRequest = z.output<typeof reconcileRequestSchema>;

/** `svc.supervisor.ensure`: one vendor's containers, after its settings changed. */
export const ensureRequestSchema = z.strictObject({
  ...vendorContainersSchema.shape,
  ownerKind: z.enum(CONTAINER_OWNER_KINDS).default('vendor'),
});

/** One vendor's containers. */
export type EnsureRequest = z.output<typeof ensureRequestSchema>;

/** Where one declared container stands. */
export const managedStatusSchema = z.object({
  ownerKind: z.enum(CONTAINER_OWNER_KINDS).default('vendor'),
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
export const managedRequestSchema = z.strictObject({
  vendorId: z.string().min(1).max(64),
  ownerKind: z.enum(CONTAINER_OWNER_KINDS).default('vendor'),
});

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

  /** What the device is called when it is made. */
  displayName: z.string().min(1).max(128),

  /** The image it runs, which is the device's model. */
  image: z.string().min(1).max(128),
  swVersion: z.string().min(1).max(64).optional(),
  entities: z.array(entityRegistrationSchema).min(1),
});

/** One container's device, as the supervisor hands it to `core`. */
export type ContainerDeviceRegistration = z.output<typeof containerDeviceRegistrationSchema>;

/**
 * `svc.core.sync_containers`: every container but the system ones, whole. `core` writes a
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

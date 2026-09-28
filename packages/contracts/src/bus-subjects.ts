/**
 * The subject taxonomy: every address a message can be published to or subscribed on.
 *
 * Subjects are built here and nowhere else. A subject assembled by string concatenation at a
 * call site is a typo that produces no error - the publish succeeds, nobody is listening, and
 * the symptom is a feature that silently does nothing.
 *
 * **An entity id spans two NATS tokens.** `light.kitchen_ceiling` contains a dot, and NATS
 * treats a dot as a token separator, so `nebula.v1.state.report.light.kitchen_ceiling` is seven
 * tokens rather than six. A subscription written as `nebula.v1.state.report.*` matches a single
 * token and therefore receives **nothing**. Every wildcard over an entity id must use the
 * multi-token `>`, which is why the subscription patterns below are constants rather than
 * something each caller writes by hand.
 *
 * Defined in ARCHITECTURE.md 7.2.
 */
import { capabilityNameSchema, type CapabilityName } from './capabilities.js';
import { type DiscoveryEvent } from './discovery.js';
import { isEntityId, type EntityId } from './entity-id.js';
import { type LogLevel } from './log-level.js';
import { type DeviceEvent } from './registration.js';

/**
 * The prefix on every subject, carrying the bus contract version.
 *
 * A v2 platform publishes under `nebula.v2.` and a v1 subscriber never sees it, so the two can
 * run side by side during a migration instead of requiring a coordinated restart.
 */
export const BUS_SUBJECT_PREFIX = 'nebula.v1';

/**
 * Concrete subjects, each built from the parts that address one message.
 *
 * Use these to publish, and {@link BUS_PATTERNS} to subscribe.
 */
export const busSubjects = {
  /**
   * An adapter reporting the state of one of its entities.
   *
   * @param entityId - The entity being reported.
   * @returns The subject to publish the report on.
   */
  stateReport: (entityId: EntityId): string => `${BUS_SUBJECT_PREFIX}.state.report.${entityId}`,

  /**
   * Requesting the full registry snapshot.
   *
   * @returns The request/reply subject `core` answers on.
   */
  stateSnapshot: (): string => `${BUS_SUBJECT_PREFIX}.state.snapshot`,

  /**
   * Requesting the current state of one entity.
   *
   * @param entityId - The entity to read.
   * @returns The request/reply subject `core` answers on.
   */
  stateGet: (entityId: EntityId): string => `${BUS_SUBJECT_PREFIX}.state.get.${entityId}`,

  /**
   * Asking an adapter to resend everything it owns.
   *
   * @param adapterId - The package id of the adapter to resynchronise.
   * @returns The request/reply subject that adapter answers on.
   */
  stateResync: (adapterId: string): string => `${BUS_SUBJECT_PREFIX}.state.resync.${adapterId}`,

  /**
   * Announcing that an entity's state changed.
   *
   * @param entityId - The entity that changed.
   * @returns The fan-out subject to publish the event on.
   */
  stateChanged: (entityId: EntityId): string =>
    `${BUS_SUBJECT_PREFIX}.event.state_changed.${entityId}`,

  /**
   * Announcing a device lifecycle event.
   *
   * @param event - What happened to the device.
   * @returns The fan-out subject to publish the event on.
   */
  deviceEvent: (event: DeviceEvent): string => `${BUS_SUBJECT_PREFIX}.event.device.${event}`,

  /**
   * Announcing that the devices the hub has heard and nobody has added changed.
   *
   * @param event - What happened to the list.
   * @returns The fan-out subject to publish the event on.
   */
  discoveryEvent: (event: DiscoveryEvent): string =>
    `${BUS_SUBJECT_PREFIX}.event.discovery.${event}`,

  /**
   * Announcing something about one automation.
   *
   * @param automationId - The automation the event concerns.
   * @returns The fan-out subject to publish the event on.
   */
  automationEvent: (automationId: string): string =>
    `${BUS_SUBJECT_PREFIX}.event.automation.${automationId}`,

  /**
   * Announcing the installation's maintenance state: a restore started, moved on, or ended.
   *
   * @returns The fan-out subject `backup` publishes the state on.
   */
  maintenanceEvent: (): string => `${BUS_SUBJECT_PREFIX}.event.maintenance`,

  /**
   * Announcing that a backup or a restore began, moved to another phase, or ended.
   *
   * @returns The fan-out subject `backup` publishes on.
   */
  backupEvent: (): string => `${BUS_SUBJECT_PREFIX}.event.backup.progress`,

  /**
   * Announcing that a container changed or went away.
   *
   * @returns The fan-out subject the supervisor publishes on.
   */
  containerEvent: (): string => `${BUS_SUBJECT_PREFIX}.event.container.changed`,

  /**
   * Announcing that something about one integration changed that its page shows: an account
   * signed in, out, or asked to sign in again.
   *
   * @returns The fan-out subject the hub publishes on.
   */
  integrationEvent: (): string => `${BUS_SUBJECT_PREFIX}.event.integration.changed`,

  /**
   * Commanding an entity.
   *
   * @param entityId - The entity to command.
   * @param capability - Which of its capabilities the command targets.
   * @returns The request/reply subject `core` accepts the command on.
   */
  command: (entityId: EntityId, capability: CapabilityName): string =>
    `${BUS_SUBJECT_PREFIX}.cmd.${entityId}.${capability}`,

  /**
   * Calling a method another service exposes.
   *
   * @param service - The service that owns the method.
   * @param method - The method being called.
   * @returns The request/reply subject that service answers on.
   */
  service: (service: string, method: string): string =>
    `${BUS_SUBJECT_PREFIX}.svc.${service}.${method}`,

  /**
   * Shipping a log record to `logger`.
   *
   * @param service - The service the record came from.
   * @param level - Its severity.
   * @returns The subject to publish the record on.
   */
  log: (service: string, level: LogLevel): string =>
    `${BUS_SUBJECT_PREFIX}.log.${service}.${level}`,

  /**
   * Announcing a package lifecycle event.
   *
   * @param event - What happened to the package, or `routes` for a new routing table.
   * @returns The fan-out subject to publish the event on.
   */
  packageEvent: (event: 'installed' | 'removed' | 'started' | 'stopped' | 'routes'): string =>
    `${BUS_SUBJECT_PREFIX}.pkg.${event}`,

  /**
   * A camera's frames, as bytes: the one subject that carries no envelope (camera.ts).
   *
   * @param entityId - The camera.
   * @returns The subject its frames are published on while it streams.
   */
  cameraFrame: (entityId: EntityId): string => `${BUS_SUBJECT_PREFIX}.camera.frame.${entityId}`,

  /**
   * Publishing a numeric reading to the durable telemetry stream.
   *
   * @param entityId - The entity the reading belongs to.
   * @returns The JetStream subject to publish the reading on.
   */
  telemetry: (entityId: EntityId): string => `${BUS_SUBJECT_PREFIX}.telemetry.${entityId}`,
} as const;

/**
 * Subscription patterns.
 *
 * Every pattern that spans an entity id ends in `>` rather than `*`, for the reason given at the
 * top of this file: an entity id is two tokens, and `*` matches one.
 */
export const BUS_PATTERNS = {
  /** Every state report from every adapter. */
  allStateReports: `${BUS_SUBJECT_PREFIX}.state.report.>`,

  /** Every state change, for any entity. */
  allStateChanges: `${BUS_SUBJECT_PREFIX}.event.state_changed.>`,

  /** Every device lifecycle event. Single token, so `*` is correct here. */
  allDeviceEvents: `${BUS_SUBJECT_PREFIX}.event.device.*`,

  /** Every discovery event. Single token, so `*` is correct here. */
  allDiscoveryEvents: `${BUS_SUBJECT_PREFIX}.event.discovery.*`,

  /** Every automation event. */
  allAutomationEvents: `${BUS_SUBJECT_PREFIX}.event.automation.*`,

  /** Every command, for any entity and capability. */
  allCommands: `${BUS_SUBJECT_PREFIX}.cmd.>`,

  /** Every log record from every service, at every level. */
  allLogs: `${BUS_SUBJECT_PREFIX}.log.>`,

  /** Every package lifecycle event, including routing table updates. */
  allPackageEvents: `${BUS_SUBJECT_PREFIX}.pkg.*`,

  /** Every telemetry reading. The JetStream stream is configured on this pattern. */
  allTelemetry: `${BUS_SUBJECT_PREFIX}.telemetry.>`,
} as const;

/**
 * Builds the subscription pattern for every method one service exposes.
 *
 * @param service - The service whose methods to subscribe to.
 * @returns A pattern matching each of that service's method subjects.
 */
export function serviceMethodPattern(service: string): string {
  return `${BUS_SUBJECT_PREFIX}.svc.${service}.*`;
}

/**
 * Builds the subscription pattern for every command targeting one entity.
 *
 * @param entityId - The entity whose commands to subscribe to.
 * @returns A pattern matching that entity's commands across all capabilities.
 */
export function entityCommandPattern(entityId: EntityId): string {
  return `${BUS_SUBJECT_PREFIX}.cmd.${entityId}.*`;
}

/** What a command subject addresses. */
export type ParsedCommandSubject = {
  /** The entity being commanded. */
  readonly entityId: EntityId;

  /** Which of its capabilities the command targets. */
  readonly capability: CapabilityName;
};

/**
 * Reads back what {@link busSubjects.command} built.
 *
 * `core` subscribes to every command with one wildcard subscription, so the only thing that says
 * which entity and capability a message is for is the subject it arrived on.
 *
 * @param subject - The subject a command arrived on.
 * @returns What it addresses, or null when it is not a command subject or names an entity or
 * capability that does not exist. Null rather than a throw: a malformed subject is a message to
 * reject with an explanation, not an exceptional condition inside `core`.
 */
export function parseCommandSubject(subject: string): ParsedCommandSubject | null {
  const tokens = subject.split('.');

  // nebula . v1 . cmd . <domain> . <object_id> . <capability>
  const COMMAND_SUBJECT_TOKENS = 6;

  if (tokens.length !== COMMAND_SUBJECT_TOKENS) {
    return null;
  }

  const [namespace, version, kind, domain, objectId, capability] = tokens;

  if (`${String(namespace)}.${String(version)}` !== BUS_SUBJECT_PREFIX || kind !== 'cmd') {
    return null;
  }

  const entityId = `${String(domain)}.${String(objectId)}`;
  const parsedCapability = capabilityNameSchema.safeParse(capability);

  if (!isEntityId(entityId) || !parsedCapability.success) {
    return null;
  }

  return { entityId, capability: parsedCapability.data };
}

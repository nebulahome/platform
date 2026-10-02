/**
 * A container as the registry sees it: a device, its entities, and their states.
 *
 * The definitions are the contract's (`CONTAINER_ENTITIES`); this names them after one container
 * and fills them in from what the supervisor measured. The image entity offers no install for a
 * container the platform must not replace: its own, and one an integration runs.
 */
import {
  CONTAINER_ENTITIES,
  containerDeviceRegistrationSchema,
  containerObjectPrefix,
  entityIdSchema,
  type ContainerDeviceRegistration,
  type EntityId,
  type StateReport,
} from '@nebulahome/contracts';

/** What the supervisor knows about a container when its entities are written or reported. */
export type ContainerFacts = {
  readonly name: string;

  /** What the page calls it, which its device is named when it is made. */
  readonly displayName: string;
  readonly image: string;
  readonly version: string | null;
  readonly isRunning: boolean;

  /** Whether the owner may install an update from here. */
  readonly canUpdate: boolean;

  /** The means of the samples since the last report; null for none. */
  readonly cpuPercent: number | null;
  readonly memoryUsedBytes: number | null;
  readonly memoryLimitBytes: number | null;

  readonly update: {
    readonly latestVersion: string | null;
    readonly isInstalling: boolean;
    readonly progress: number | null;
  };
};

/** The capability each domain's entities declare. */
const CAPABILITY_OF = {
  sensor: 'sensor_numeric',
  binary_sensor: 'sensor_binary',
  update: 'update',
} as const;

/**
 * The id of one of a container's entities.
 *
 * @param name - The container's name.
 * @param definition - Which entity.
 * @param definition.domain - Its domain.
 * @param definition.suffix - What follows the container's prefix.
 * @returns The id.
 */
export function containerEntityId(
  name: string,
  definition: { readonly domain: string; readonly suffix: string },
): EntityId {
  return entityIdSchema.parse(
    `${definition.domain}.${containerObjectPrefix(name)}_${definition.suffix}`,
  );
}

/**
 * A container's device and entities, as `core` is handed them.
 *
 * @param facts - The container.
 * @returns Its registration.
 */
export function registrationOf(facts: ContainerFacts): ContainerDeviceRegistration {
  return containerDeviceRegistrationSchema.parse({
    name: facts.name,
    displayName: facts.displayName.slice(0, 128),
    image: facts.image.slice(0, 128),
    ...(facts.version === null ? {} : { swVersion: facts.version.slice(0, 64) }),
    entities: CONTAINER_ENTITIES.map((definition) => {
      const { reading, domain, suffix, ...rest } = definition;
      const capability = CAPABILITY_OF[domain];

      return {
        ...rest,
        entityId: containerEntityId(facts.name, { domain, suffix }),
        capabilities:
          capability === 'update'
            ? { update: { canInstall: facts.canUpdate && reading === 'image', hasProgress: true } }
            : { [capability]: {} },
      };
    }),
  });
}

/**
 * A number rounded to what the entity shows, so a report does not change on noise.
 *
 * @param value - The number.
 * @param digits - How many decimals.
 * @returns It rounded.
 */
function rounded(value: number, digits: number): number {
  const scale = 10 ** digits;

  return Math.round(value * scale) / scale;
}

/**
 * What every entity of a container reports now.
 *
 * A reading that could not be taken - a stopped container has no processor share - makes its
 * entity unavailable rather than zero, as the system entities do.
 *
 * @param facts - The container.
 * @returns One report per entity.
 */
export function reportsOf(facts: ContainerFacts): StateReport[] {
  const memoryPercent =
    facts.memoryUsedBytes !== null && facts.memoryLimitBytes !== null && facts.memoryLimitBytes > 0
      ? (facts.memoryUsedBytes / facts.memoryLimitBytes) * 100
      : null;

  return CONTAINER_ENTITIES.map((definition): StateReport => {
    const entityId = containerEntityId(facts.name, definition);

    switch (definition.reading) {
      case 'cpu': {
        return numeric(entityId, facts.cpuPercent === null ? null : rounded(facts.cpuPercent, 1));
      }

      case 'memory': {
        return numeric(entityId, memoryPercent === null ? null : rounded(memoryPercent, 1));
      }

      case 'memory_used': {
        return numeric(
          entityId,
          facts.memoryUsedBytes === null ? null : Math.round(facts.memoryUsedBytes),
        );
      }

      case 'running': {
        return { entityId, state: { sensor_binary: { isOn: facts.isRunning } }, isAvailable: true };
      }

      case 'image': {
        return {
          entityId,
          state: {
            update: {
              installedVersion: facts.version?.slice(0, 64) ?? null,
              latestVersion: facts.update.latestVersion?.slice(0, 64) ?? null,
              isInstalling: facts.update.isInstalling,
              progress: facts.update.progress,
            },
          },
          isAvailable: true,
        };
      }
    }
  });
}

/**
 * A numeric reading's report.
 *
 * @param entityId - The entity.
 * @param value - The reading, or null when it could not be taken.
 * @returns The report: unavailable, keeping no value, for a reading not taken.
 */
function numeric(entityId: EntityId, value: number | null): StateReport {
  return value === null
    ? { entityId, state: {}, isAvailable: false }
    : { entityId, state: { sensor_numeric: { value } }, isAvailable: true };
}

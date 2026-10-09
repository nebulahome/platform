/**
 * The devices of the packages.
 *
 * A package's process knows what devices it has - the broker's clients, the recorder's cameras -
 * and `core` is the one writer of the registry. So the package hands over the whole list whenever
 * it changes (`ctx.devices.sync`, `svc.core.sync_package`) and `core` makes its devices match: a
 * device for one it had not seen, the facts of one it had brought up to date, and the device of
 * one that is gone removed with its entities. The name, icon, room and tags of a device - and the
 * name and icon of an entity - are the owner's once they exist.
 *
 * The rows are `adapter` rows owned by the package (`package_id`), so a command to one of its
 * entities is routed to `svc.<package>.command` and a report is taken only from the package, as
 * an integration's are from its instance. An entity is named after the package
 * (`<domain>.<package>_…`) so one package cannot take another's, or an integration's; one outside
 * that, or one another owner holds, is refused and said so in the reply.
 *
 * Syncing also reads the package's entity types from its row (`system.packages.manifest`), which
 * the packet-manager wrote on install, so a `custom` entity is checked against them from then on.
 * An empty list removes every device the package had: what the packet-manager asks when it
 * removes a package.
 */
import { and, eq, inArray, ne, notInArray, or, sql, isNull } from 'drizzle-orm';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_SERVICE,
  CORE_SYNC_PACKAGE_METHOD,
  packageDeviceId,
  packageEntityTypeSchema,
  packageObjectPrefix,
  parseEntityId,
  syncPackageRequestSchema,
  type CapabilityName,
  type EntityId,
  type JsonObject,
  type PackageEntityType,
  type SyncPackageReply,
  type SyncPackageRequest,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { EntityDirectory } from '../domain/entity-directory.js';
import type { EntityRegistry } from '../domain/entity-registry.js';
import type { PackageTypes } from '../domain/package-types.js';
import type { BatchWriter } from '../persistence/batch-writer.js';
import type { EntityStateRow } from '../persistence/history-writer.js';

import { announceChange, type ChangeObserver } from './state-events.js';

/** What the packages service needs. */
export type PackagesServiceOptions = {
  readonly client: BusClient;
  readonly db: Database;

  /** The live directory, updated in the same call that writes the rows. */
  readonly directory: EntityDirectory;

  /** The live states, which forget a removed entity in the same call. */
  readonly registry: EntityRegistry;

  /** The state rows waiting to be written; those of a removed entity are dropped with it. */
  readonly stateCache: BatchWriter<EntityStateRow>;

  /** The packages' entity types, kept up to date from each package's row. */
  readonly packageTypes: PackageTypes;

  readonly logger: PlatformLogger;

  /** What in this process reacts to an entity becoming unreachable. Must not block. */
  readonly onNotableChange?: ChangeObserver;
};

/** One entity as it was written. */
type WrittenEntity = {
  readonly rowId: string;
  readonly entityId: EntityId;
  readonly isEnabled: boolean;
  readonly capabilities: Map<CapabilityName, JsonObject>;
};

/** One device as it was written. */
type WrittenDevice = {
  readonly externalId: string;
  readonly name: string;
  readonly isNew: boolean;
  readonly entities: WrittenEntity[];
};

/** What a sync did. */
export type PackageSyncOutcome = {
  readonly written: WrittenDevice[];
  readonly removed: {
    readonly externalId: string;
    readonly name: string;
    readonly entities: { readonly rowId: string; readonly entityId: EntityId }[];
  }[];
  readonly refused: SyncPackageReply['refused'];

  /** Entities no longer declared that an alias still reads: kept, unavailable. */
  readonly stranded: EntityId[];

  /** Devices gone from the list but kept because an alias reads one of their entities. */
  readonly kept: string[];
};

/** What reading the alias sources needs: the database, or a transaction on it. */
type Reader = Pick<Database, 'selectDistinct'>;

/**
 * The rows of entities no derived entity reads, out of those given.
 *
 * @param tx - The transaction.
 * @param rowIds - The candidates.
 * @returns The ones free to delete.
 */
async function unread(tx: Reader, rowIds: readonly string[]): Promise<Set<string>> {
  if (rowIds.length === 0) {
    return new Set();
  }

  const read = await tx
    .selectDistinct({ rowId: schema.registry.aliasSources.entityId })
    .from(schema.registry.aliasSources)
    .where(inArray(schema.registry.aliasSources.entityId, [...rowIds]));
  const reading = new Set(read.map((row) => row.rowId));

  return new Set(rowIds.filter((rowId) => !reading.has(rowId)));
}

/**
 * The entity types a package's row declares.
 *
 * @param db - The database.
 * @param packageId - The package.
 * @returns Its types, or undefined when it has no row: a package not installed.
 */
export async function readPackageTypes(
  db: Database,
  packageId: string,
): Promise<PackageEntityType[] | undefined> {
  const [row] = await db
    .select({ manifest: schema.system.packages.manifest })
    .from(schema.system.packages)
    .where(eq(schema.system.packages.id, packageId))
    .limit(1);

  if (row === undefined) {
    return undefined;
  }

  const declared = (row.manifest as { entityTypes?: unknown } | null)?.entityTypes;

  return (Array.isArray(declared) ? declared : []).flatMap((each) => {
    const parsed = packageEntityTypeSchema.safeParse(each);

    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Reads every installed package's entity types, at startup.
 *
 * @param db - The database.
 * @param types - Where they go.
 * @returns How many packages there were.
 */
export async function loadPackageTypes(db: Database, types: PackageTypes): Promise<number> {
  const rows = await db.select({ id: schema.system.packages.id }).from(schema.system.packages);

  for (const row of rows) {
    // One after another: a handful of rows, read once at startup.
    // eslint-disable-next-line no-await-in-loop -- see above
    types.set(row.id, (await readPackageTypes(db, row.id)) ?? []);
  }

  return rows.length;
}

/**
 * Makes a package's devices match its list, in one transaction.
 *
 * @param db - A connected database handle.
 * @param request - Every device the package has.
 * @returns What was written, removed, refused and kept.
 */
export async function syncPackageDevices(
  db: Database,
  request: SyncPackageRequest,
): Promise<PackageSyncOutcome> {
  const { packageId } = request;
  const prefix = packageObjectPrefix(packageId);

  // One transaction holds one connection, so its statements run one after another whatever the
  // loops say; awaiting each in turn is what the database does anyway.
  /* eslint-disable no-await-in-loop -- see above */
  return db.transaction(async (tx) => {
    const { devices, entities, entityCapabilities } = schema.registry;
    const existing = await tx
      .select({ id: devices.id, externalId: devices.externalId, name: devices.name })
      .from(devices)
      .where(and(eq(devices.source, 'adapter'), eq(devices.packageId, packageId)));
    const byExternalId = new Map(existing.map((row) => [row.externalId ?? '', row]));
    const written: WrittenDevice[] = [];
    const refused: SyncPackageReply['refused'] = [];
    const stranded: EntityId[] = [];

    for (const wanted of request.devices) {
      const found = byExternalId.get(wanted.externalId);
      const facts = {
        manufacturer: wanted.manufacturer ?? null,
        model: wanted.model ?? null,
        swVersion: wanted.swVersion ?? null,
        lastSeenAt: new Date(),
      };
      const [device] =
        found === undefined
          ? await tx
              .insert(devices)
              .values({
                source: 'adapter',
                packageId,
                externalId: wanted.externalId,
                name: wanted.name,
                icon: wanted.icon ?? null,
                ...facts,
              })
              .returning({ id: devices.id, name: devices.name })
          : await tx
              .update(devices)
              .set({ ...facts, updatedAt: new Date() })
              .where(eq(devices.id, found.id))
              .returning({ id: devices.id, name: devices.name });

      if (device === undefined) {
        throw new Error(
          `The device ${wanted.externalId} of ${packageId} was neither found nor written`,
        );
      }

      // Named after the package, or refused: an entity id is the package's to use only there.
      const outside = wanted.entities.filter(
        (entity) => !(entity.entityId.split('.', 2)[1] ?? '').startsWith(prefix),
      );

      refused.push(
        ...outside.map((entity) => ({
          entityId: entity.entityId,
          reason: `Not named after the package: its object id must start with ${prefix}`,
        })),
      );

      const named = wanted.entities.filter((entity) => !outside.includes(entity));
      const taken =
        named.length === 0
          ? []
          : await tx
              .select({ entityId: entities.entityId })
              .from(entities)
              .where(
                and(
                  inArray(
                    entities.entityId,
                    named.map((entity) => entity.entityId),
                  ),
                  or(
                    ne(entities.source, 'adapter'),
                    isNull(entities.packageId),
                    ne(entities.packageId, packageId),
                  ),
                ),
              );
      const takenIds = new Set(taken.map((row) => row.entityId));

      refused.push(
        ...[...takenIds].map((entityId) => ({ entityId, reason: 'Another owner has this entity' })),
      );

      const kept = named.filter((entity) => !takenIds.has(entity.entityId));

      // What the device no longer has goes, unless an alias reads it.
      const dropped = await tx
        .select({ rowId: entities.id, entityId: entities.entityId })
        .from(entities)
        .where(
          and(
            eq(entities.deviceId, device.id),
            kept.length === 0
              ? sql`true`
              : notInArray(
                  entities.entityId,
                  kept.map((entity) => entity.entityId),
                ),
          ),
        );
      const free = await unread(
        tx,
        dropped.map((row) => row.rowId),
      );

      if (free.size > 0) {
        await tx.delete(entities).where(inArray(entities.id, [...free]));
      }

      stranded.push(
        ...dropped.filter((row) => !free.has(row.rowId)).map((row) => parseEntityId(row.entityId)),
      );

      if (kept.length === 0) {
        written.push({
          externalId: wanted.externalId,
          name: device.name,
          isNew: found === undefined,
          entities: [],
        });
        continue;
      }

      const rows = await tx
        .insert(entities)
        .values(
          kept.map((entity) => ({
            entityId: entity.entityId,
            deviceId: device.id,
            packageId,
            source: 'adapter',
            name: entity.name,
            icon: entity.icon ?? null,
            unitOfMeasurement: entity.unitOfMeasurement ?? null,
            deviceClass: entity.deviceClass ?? null,
            stateClass: entity.stateClass ?? null,
            displayPrecision: entity.displayPrecision ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: entities.entityId,
          set: {
            // The owner's name and icon stay; what the reading is follows the package.
            icon: sql`coalesce(${entities.icon}, excluded.icon)`,
            deviceId: sql`excluded.device_id`,
            unitOfMeasurement: sql`excluded.unit_of_measurement`,
            deviceClass: sql`excluded.device_class`,
            stateClass: sql`excluded.state_class`,
            displayPrecision: sql`excluded.display_precision`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: entities.id, entityId: entities.entityId, isEnabled: entities.isEnabled });
      const declared = new Map(
        kept.map((entity) => [String(entity.entityId), entity.capabilities]),
      );

      await tx.delete(entityCapabilities).where(
        inArray(
          entityCapabilities.entityId,
          rows.map((row) => row.id),
        ),
      );
      await tx.insert(entityCapabilities).values(
        rows.flatMap((row) =>
          Object.entries(declared.get(row.entityId) ?? {}).map(([capability, params]) => ({
            entityId: row.id,
            capability,
            params,
          })),
        ),
      );

      written.push({
        externalId: wanted.externalId,
        name: device.name,
        isNew: found === undefined,
        entities: rows.map((row) => ({
          rowId: row.id,
          entityId: parseEntityId(row.entityId),
          isEnabled: row.isEnabled,
          capabilities: new Map(
            Object.entries(declared.get(row.entityId) ?? {}).map(([capability, params]) => [
              capability as CapabilityName,
              params,
            ]),
          ),
        })),
      });
    }

    const listed = new Set(request.devices.map((device) => device.externalId));
    const gone = existing.filter((row) => !listed.has(row.externalId ?? ''));
    const removed: PackageSyncOutcome['removed'] = [];
    const keptDevices: string[] = [];

    for (const device of gone) {
      const owned = await tx
        .select({ rowId: entities.id, entityId: entities.entityId })
        .from(entities)
        .where(eq(entities.deviceId, device.id));
      const free = await unread(
        tx,
        owned.map((row) => row.rowId),
      );
      const externalId = device.externalId ?? device.name;

      if (free.size > 0) {
        await tx.delete(entities).where(inArray(entities.id, [...free]));
      }

      if (free.size < owned.length) {
        keptDevices.push(externalId);
        stranded.push(
          ...owned.filter((row) => !free.has(row.rowId)).map((row) => parseEntityId(row.entityId)),
        );
        continue;
      }

      await tx.delete(devices).where(eq(devices.id, device.id));
      removed.push({
        externalId,
        name: device.name,
        entities: owned.map((row) => ({ rowId: row.rowId, entityId: parseEntityId(row.entityId) })),
      });
    }

    return { written, removed, refused, stranded, kept: keptDevices };
  });
  /* eslint-enable no-await-in-loop */
}

/**
 * Serves the subject a package hands over its devices on.
 *
 * The rows first, then the directory, then the events, for the reason a device's completion does
 * it in that order (`registration.ts`).
 *
 * @param options - The bus client, the database, the directory, the registry, the state cache,
 *   the packages' types and the logger.
 * @returns The subscription.
 */
export function startPackagesService(options: PackagesServiceOptions): BusSubscription {
  return options.client.serve(
    busSubjects.service(CORE_SERVICE, CORE_SYNC_PACKAGE_METHOD),
    syncPackageRequestSchema,

    /**
     * Makes a package's devices match its list.
     *
     * @param request - Every device the package has.
     * @returns What was written, refused and kept.
     */
    async (request: SyncPackageRequest): Promise<SyncPackageReply> => {
      const { packageId } = request;
      const types = await readPackageTypes(options.db, packageId);

      if (types === undefined) {
        // No row: the package was removed, or never installed. Its types go, and so do the
        // devices it may have left behind.
        options.packageTypes.forget(packageId);
      } else {
        options.packageTypes.set(packageId, types);
      }

      const outcome = await syncPackageDevices(
        options.db,
        types === undefined ? { packageId, devices: [] } : request,
      );

      for (const device of outcome.written) {
        for (const entity of device.entities) {
          options.directory.set({
            entityId: entity.entityId,
            rowId: entity.rowId,
            source: packageId,
            isEnabled: entity.isEnabled,
            capabilities: entity.capabilities,
          });
        }

        options.client.publish(busSubjects.deviceEvent(device.isNew ? 'added' : 'updated'), {
          deviceId: packageDeviceId(packageId, device.externalId),
          source: packageId,
          name: device.name,
          entityIds: device.isNew ? device.entities.map((entity) => entity.entityId) : [],
        });
      }

      for (const device of outcome.removed) {
        const rowIds = new Set(device.entities.map((entity) => entity.rowId));

        for (const entity of device.entities) {
          options.directory.remove(entity.entityId);
          options.registry.remove(entity.entityId);
        }

        options.stateCache.discard((row) => rowIds.has(row.entityId));
        options.client.publish(busSubjects.deviceEvent('removed'), {
          deviceId: packageDeviceId(packageId, device.externalId),
          source: packageId,
          name: device.name,
          entityIds: device.entities.map((entity) => entity.entityId),
        });
      }

      for (const entityId of outcome.stranded) {
        const result = options.registry.setAvailability(entityId, false);

        if (result !== undefined) {
          announceChange(options.client, result, undefined, options.onNotableChange);
        }
      }

      if (outcome.refused.length > 0) {
        options.logger.warn(
          { package: packageId, refused: outcome.refused },
          'Refused some of a package’s entities',
        );
      }

      const added = outcome.written.filter((device) => device.isNew).length;

      if (added > 0 || outcome.removed.length > 0 || outcome.kept.length > 0) {
        options.logger.info(
          {
            package: packageId,
            devices: outcome.written.length,
            added,
            removed: outcome.removed.map((device) => device.externalId),
            kept: outcome.kept,
          },
          'Took in a package’s devices',
        );
      }

      return {
        devices: outcome.written.map((device) => ({
          deviceId: packageDeviceId(packageId, device.externalId),
          externalId: device.externalId,
          entityIds: device.entities.map((entity) => entity.entityId),
        })),
        refused: outcome.refused,
        kept: outcome.kept,
      };
    },
  );
}

/**
 * The rows an integration test needs in the database before `core` can do anything.
 *
 * `core` does not invent entities. It loads what the owner configured and refuses reports for
 * anything else, so a test of the ingest pipeline has to configure a house first.
 *
 * Every fixture is scoped to a package id unique to the run and removed afterwards, so two runs
 * against the same development database do not see each other's entities.
 */
import { schema, type Database } from '@nebula-home/db';
import { eq } from 'drizzle-orm';

/** What was inserted, and how to name it afterwards. */
export type Fixture = {
  /** The package id every entity belongs to. */
  readonly packageId: string;

  /** The `registry.entities.id` uuid of each entity, by its text identifier. */
  readonly rowIds: ReadonlyMap<string, string>;
};

/** One entity to configure. */
export type FixtureEntity = {
  /** Its text identifier. */
  readonly entityId: string;

  /** Its display name. */
  readonly name: string;

  /** The capabilities it declares, with the device limits for each. */
  readonly capabilities: Readonly<Record<string, unknown>>;
};

/**
 * Inserts a package, a device and the given entities.
 *
 * @param db - A connected database handle.
 * @param packageId - The package id to scope everything to.
 * @param entities - The entities to configure.
 * @returns What was inserted.
 */
export async function insertFixture(
  db: Database,
  packageId: string,
  entities: readonly FixtureEntity[],
): Promise<Fixture> {
  await db.insert(schema.system.packages).values({
    id: packageId,
    version: '1.0.0',
    runtime: 'node',
    state: 'running',
    manifest: { id: packageId, version: '1.0.0', runtime: 'node', coreApiVersion: '^1.0.0' },
  });

  const [device] = await db
    .insert(schema.registry.devices)
    .values({ packageId, externalId: 'fixture-device', name: 'Fixture device' })
    .returning({ id: schema.registry.devices.id });

  if (device === undefined) {
    throw new Error('Could not insert the fixture device');
  }

  const rowIds = new Map<string, string>();

  for (const entity of entities) {
    const [inserted] = await db
      .insert(schema.registry.entities)
      .values({
        entityId: entity.entityId,
        deviceId: device.id,
        packageId,

        // `entities.source` records the kind of entity; the owning package is `package_id`, and
        // the `entities_source_consistency` constraint requires both for an adapter entity.
        source: 'adapter',
        name: entity.name,
      })
      .returning({ id: schema.registry.entities.id });

    if (inserted === undefined) {
      throw new Error(`Could not insert ${entity.entityId}`);
    }

    rowIds.set(entity.entityId, inserted.id);

    for (const [capability, params] of Object.entries(entity.capabilities)) {
      await db
        .insert(schema.registry.entityCapabilities)
        .values({ entityId: inserted.id, capability, params });
    }
  }

  return { packageId, rowIds };
}

/**
 * Removes everything a fixture inserted.
 *
 * History rows have no foreign key to `registry.entities` - a hypertable cannot afford one - so
 * they are deleted explicitly rather than left to cascade.
 *
 * @param db - A connected database handle.
 * @param fixture - What was inserted.
 * @returns A promise that settles once the rows are gone.
 */
export async function removeFixture(db: Database, fixture: Fixture): Promise<void> {
  for (const rowId of fixture.rowIds.values()) {
    await db
      .delete(schema.history.stateHistory)
      .where(eq(schema.history.stateHistory.entityId, rowId));
    await db.delete(schema.history.telemetry).where(eq(schema.history.telemetry.entityId, rowId));
  }

  await db
    .delete(schema.registry.devices)
    .where(eq(schema.registry.devices.packageId, fixture.packageId));

  await db.delete(schema.system.packages).where(eq(schema.system.packages.id, fixture.packageId));
}

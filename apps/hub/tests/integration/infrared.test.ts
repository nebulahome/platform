/**
 * The Infrared broker's tables against a real database: what the store writes is what migration
 * 0003 made, a cell holds one button, a remote's buttons go with it, and a remote lets go of its
 * blaster with the blaster's instance.
 *
 * Requires the development stack, migrated:
 *
 * ```
 * pnpm infra:up
 * pnpm db:migrate
 * ```
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError, type InfraredCode } from '@nebulahome/contracts';
import { createDatabase, schema } from '@nebulahome/db';

import { databaseInfraredStore, type InfraredStore } from '@/persistence/infrared.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** The instance the tests add, as a blaster. */
const BLASTER_ID = 'infrared-test-rm4';

/** A code, as the contract has it. */
const CODE: InfraredCode = { signal: 'ir', carrierHz: 38_000, pulses: [9000, 4500, 560, 560] };

let database: ReturnType<typeof createDatabase>;
let store: InfraredStore;

/** Empties the broker's tables and the test's instance. */
async function clear(): Promise<void> {
  await database.db.delete(schema.registry.infraredRemotes);
  await database.db
    .delete(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, BLASTER_ID));
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'hub-test' });
  store = databaseInfraredStore(database.db);
  await clear();
});

afterAll(async () => {
  await clear();
  await database.close();
});

describe('the Infrared store', () => {
  it('keeps a remote and its buttons, one a cell, and drops them together', async () => {
    const remote = await store.saveRemote({
      name: 'TV',
      kind: 'tv',
      blasterId: null,
      columns: 3,
    });

    expect(await store.remotes()).toEqual([remote]);
    expect(await store.saveRemote({ ...remote, name: 'Living room TV', columns: 4 })).toMatchObject(
      { id: remote.id, name: 'Living room TV', columns: 4 },
    );

    const power = await store.saveButton({
      remoteId: remote.id,
      name: 'Power',
      icon: 'power',
      cell: 0,
      code: CODE,
    });

    expect(power).toMatchObject({ cell: 0, code: CODE, lastPressedAt: null });
    await expect(
      store.saveButton({ remoteId: remote.id, name: 'Mute', icon: null, cell: 0, code: CODE }),
    ).rejects.toThrow(ConflictError);

    const at = new Date('2026-10-27T21:00:00Z');

    await store.notePressed(power.id, at);
    expect(await store.buttons()).toEqual([{ ...power, lastPressedAt: at }]);
    expect((await store.saveButton({ ...power, cell: 4 })).lastPressedAt).toEqual(at);

    expect(await store.removeRemote(remote.id)).toBe(true);
    expect(await store.buttons()).toEqual([]);
    await expect(
      store.saveRemote({ id: remote.id, name: 'TV', kind: 'tv', blasterId: null, columns: 3 }),
    ).rejects.toThrow(NotFoundError);
  });

  it('lets go of a blaster removed from the house, keeping the remote', async () => {
    await database.db.insert(schema.registry.integrations).values({
      id: BLASTER_ID,
      kind: 'broadlink/rm4-pro',
      kindVersion: '1.0.0',
      transport: 'broadlink/udp',
      transportConfig: { host: '192.168.1.30' },
    });

    const remote = await store.saveRemote({
      name: 'Fan',
      kind: 'fan',
      blasterId: BLASTER_ID,
      columns: 3,
    });

    await database.db
      .delete(schema.registry.integrations)
      .where(eq(schema.registry.integrations.id, BLASTER_ID));
    expect(await store.remotes()).toEqual([{ ...remote, blasterId: null }]);
  });
});

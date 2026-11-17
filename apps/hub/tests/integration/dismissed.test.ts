/**
 * The Found candidates set aside, kept in `registry.discovery_dismissed`.
 *
 * Requires the development stack:
 *
 * ```
 * pnpm infra:up
 * pnpm db:migrate
 * ```
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ulid } from '@nebulahome/bus';
import { createDatabase, schema } from '@nebulahome/db';

import { createDismissalStore, type DismissalStore } from '@/persistence/dismissed.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

const vendorId = `dismissed-${ulid().toLowerCase().slice(0, 10)}`;

let database: ReturnType<typeof createDatabase>;
let store: DismissalStore;

/**
 * This file's rows, as keys.
 *
 * @returns The keys set aside for this file's vendor.
 */
async function kept(): Promise<string[]> {
  return (await store.list())
    .filter((row) => row.vendorId === vendorId)
    .map((row) => row.key)
    .sort();
}

beforeAll(() => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'hub-dismissed' });
  store = createDismissalStore(database.db);
});

afterAll(async () => {
  await database.db
    .delete(schema.registry.discoveryDismissed)
    .where(eq(schema.registry.discoveryDismissed.vendorId, vendorId));
  await database.close();
});

describe('the candidates set aside', () => {
  it('keeps them, once each, and brings back only those asked', async () => {
    await store.set(
      [
        { vendorId, key: 'H450' },
        { vendorId, key: '@192.168.1.71' },
      ],
      true,
    );
    await store.set([{ vendorId, key: 'H450' }], true);

    expect(await kept()).toEqual(['@192.168.1.71', 'H450']);

    await store.set([{ vendorId, key: 'H450' }], false);

    expect(await kept()).toEqual(['@192.168.1.71']);
  });
});

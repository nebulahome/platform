/**
 * An icon catalogue for tests: the real built-in set over a store that keeps rows in memory.
 *
 * The built-in set is read from disk once per process, because a thousand and a half icons
 * take a moment to load and every server a test builds wants the same ones.
 */
import { loadBuiltinIcons, type IconRow } from '@nebulahome/icons';
import { createLogger } from '@nebulahome/logging';

import { IconService, type IconStore, type IconUses } from '../services/icons.js';

let builtin: ReturnType<typeof loadBuiltinIcons> | undefined;

/**
 * A store that keeps rows in memory and knows of no device using any icon.
 *
 * @param rows - What it starts with.
 * @returns The store.
 */
export function memoryIconStore(rows: IconRow[] = []): IconStore {
  return {
    /**
     * Reads every row.
     *
     * @returns The rows.
     */
    list: (): Promise<IconRow[]> => Promise.resolve([...rows]),

    /**
     * Adds a row.
     *
     * @param row - The row.
     * @returns A promise that settles at once.
     */
    insert: (row): Promise<void> => {
      rows.push(row);

      return Promise.resolve();
    },

    /**
     * Replaces a row.
     *
     * @param id - The row's id as it is.
     * @param row - The row as it should be.
     * @returns A promise that settles at once.
     */
    update: (id, row): Promise<void> => {
      rows.splice(
        rows.findIndex((each) => each.id === id),
        1,
        row,
      );

      return Promise.resolve();
    },

    /**
     * Deletes a row.
     *
     * @param id - Which row.
     * @returns A promise that settles at once.
     */
    remove: (id): Promise<void> => {
      rows.splice(
        rows.findIndex((each) => each.id === id),
        1,
      );

      return Promise.resolve();
    },

    /**
     * Counts what points at an icon: nothing, in a test with no registry.
     *
     * @returns Zero of each.
     */
    countUses: (): Promise<IconUses> => Promise.resolve({ devices: 0, entities: 0, tags: 0 }),
  };
}

/**
 * The catalogue a test server serves.
 *
 * @param rows - The owner's rows to start with.
 * @returns The service.
 */
export async function testIcons(rows: IconRow[] = []): Promise<IconService> {
  builtin ??= loadBuiltinIcons();

  return IconService.load({
    store: memoryIconStore(rows),
    builtin,
    logger: createLogger({ service: 'api', version: '0.0.0', level: 'fatal' }),
  });
}

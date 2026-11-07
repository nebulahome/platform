/**
 * Taking in an entity the API enabled or disabled: only the flag changes in the directory - the
 * links and limits it holds stay - and an entity `core` does not hold is not made up.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseEntityId } from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';

import { EntityDirectory } from '../domain/entity-directory.js';
import { loadEntityRecord } from '../persistence/registry-loader.js';
import { entityRecord } from '../testing/harness.js';

import { syncEntityEnabled } from './entity-service.js';

vi.mock('../persistence/registry-loader.js', () => ({ loadEntityRecord: vi.fn() }));

const plug = parseEntityId('switch.dryer_plug');
// Never touched: the loader is a stand-in.
const db = undefined as unknown as Database;

beforeEach(() => {
  vi.mocked(loadEntityRecord).mockReset();
});

describe('syncEntityEnabled', () => {
  it('takes in the flag and keeps what the row does not hold', async () => {
    const directory = new EntityDirectory();

    directory.set({ ...entityRecord(plug), linkedTo: parseEntityId('switch.dryer_matter') });
    vi.mocked(loadEntityRecord).mockResolvedValue(entityRecord(plug, { isEnabled: false }));

    expect(await syncEntityEnabled({ db, directory }, plug)).toBe(true);
    expect(directory.get(plug)).toMatchObject({
      isEnabled: false,
      linkedTo: 'switch.dryer_matter',
    });
  });

  it('says so for an entity it does not hold, without reading the row', async () => {
    const directory = new EntityDirectory();

    expect(await syncEntityEnabled({ db, directory }, plug)).toBe(false);
    expect(loadEntityRecord).not.toHaveBeenCalled();
    expect(directory.get(plug)).toBeUndefined();
  });
});

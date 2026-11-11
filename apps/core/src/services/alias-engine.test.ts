import { describe, expect, it, vi } from 'vitest';

import { aliasPartsSchema, aliasType, aliasTypeParts, parseEntityId } from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';

import { AliasCatalog, type AliasDefinition } from '../domain/alias-catalog.js';
import { createCoreHarness, entityRecord } from '../testing/harness.js';

import { AliasEngine, type AliasCodeRunner } from './alias-engine.js';

vi.mock('../persistence/alias-loader.js', () => ({
  eraseAlias: vi.fn(async () => {
    await Promise.resolve();

    return 'row-alias.porch';
  }),
  loadAlias: vi.fn(),
  loadAliases: vi.fn(),
  storePartValues: vi.fn(),
}));

const LIGHT = aliasType('light');
const porch = parseEntityId('alias.porch');

describe('the alias engine', () => {
  it('writes nothing for an alias deleted while its code was running', async () => {
    // The code may wait seconds on an HTTP call; the alias's state and cache row must not come
    // back after it is gone, or the cache writer fails on a foreign key it no longer has.
    const harness = createCoreHarness();
    const catalog = new AliasCatalog();
    let finish: ((value: { readonly value: unknown }) => void) | undefined;
    const code: AliasCodeRunner = {
      run: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      forget: vi.fn(),
      readsTime: () => false,
    };
    const engine = new AliasEngine({
      db: Object.create(null) as Database,
      directory: harness.directory,
      registry: harness.registry,
      catalog,
      ingest: harness,
      logger: harness.logger,
      newTraceId: () => 'trace',
      code,
    });
    const alias = {
      id: 'alias-id',
      entityId: porch,
      type: LIGHT,
      defs: aliasTypeParts(LIGHT),
      parts: aliasPartsSchema.parse({ on: { from: 'code', function: 'is_on' } }),
      isEnabled: true,
      reads: [],
    } as unknown as AliasDefinition;

    harness.directory.set(entityRecord(porch, { source: 'derived' }));
    catalog.upsert(alias);

    const running = engine.recompute(alias);

    await vi.waitFor(() => {
      expect(finish).toBeDefined();
    });
    await engine.remove(porch);
    finish?.({ value: true });
    await running;
    await harness.stateCache.flush();

    expect(harness.registry.get(porch)).toBeUndefined();
    expect(harness.cacheRows).toStrictEqual([]);
    expect(harness.historyRows).toStrictEqual([]);
  });
});

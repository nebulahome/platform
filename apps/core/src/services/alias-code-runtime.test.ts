import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  aliasType,
  aliasTypeParts,
  parseEntityId,
  type AliasPartConfig,
  type JsonObject,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';

import type { AliasDefinition } from '../domain/alias-catalog.js';
import { EntityDirectory } from '../domain/entity-directory.js';
import { EntityRegistry } from '../domain/entity-registry.js';
import { loadEntityLabels } from '../persistence/alias-code-reads.js';
import { storeMemory } from '../persistence/alias-loader.js';
import { loadHouse } from '../persistence/automation-store.js';
import { silentLogger } from '../testing/harness.js';

import { AliasCodeRuntime, MEMORY_WRITE_INTERVAL_MS } from './alias-code-runtime.js';

vi.mock('../persistence/alias-loader.js', () => ({ storeMemory: vi.fn() }));
vi.mock('../persistence/alias-code-reads.js', () => ({
  loadEntityLabels: vi.fn(),
  readTelemetrySummary: vi.fn(),
}));
vi.mock('../persistence/automation-store.js', () => ({ loadHouse: vi.fn() }));

const power = parseEntityId('sensor.power');
const offset = parseEntityId('sensor.offset');
const type = aliasType('sensor');
const [def] = aliasTypeParts(type);
const config: Extract<AliasPartConfig, { from: 'code' }> = { from: 'code', function: 'value' };

const COUNTER = `def value():
    mem["n"] = (mem["n"] or 0) + 1
    return mem["n"]
`;

/**
 * A sensor alias whose value comes from code.
 *
 * @param code - Its code.
 * @param memory - What its row holds as mem.
 * @returns The definition.
 */
function aliasOf(code: string, memory: JsonObject = {}): AliasDefinition {
  return {
    id: 'alias-1',
    entityId: parseEntityId('sensor.worked_out'),
    type,
    defs: aliasTypeParts(type),
    customType: null,
    parts: { value: config },
    code,
    memory,
    display: { deviceClass: null, unit: null, precision: null },
    debounceMs: 0,
    fallbackPolicy: 'unavailable',
    isEnabled: true,
    reads: [],
  };
}

describe('the alias code runtime', () => {
  let registry: EntityRegistry;
  let runtime: AliasCodeRuntime;

  /**
   * Runs the value part of an alias.
   *
   * @param alias - The alias.
   * @returns What the runtime gives the engine.
   * @throws {Error} When the sensor type has no part.
   */
  const run = (alias: AliasDefinition): ReturnType<AliasCodeRuntime['run']> => {
    if (def === undefined) {
      throw new Error('The sensor type has no part');
    }

    return runtime.run(alias, def, config, new Map());
  };

  beforeEach(() => {
    vi.mocked(storeMemory).mockReset().mockResolvedValue(undefined);
    vi.mocked(loadEntityLabels).mockReset().mockResolvedValue(new Map());
    vi.mocked(loadHouse).mockReset().mockResolvedValue({ timeZone: 'Europe/Rome', position: null });

    registry = new EntityRegistry();

    for (const [entityId, value] of [
      [power, 1200],
      [offset, 0],
    ] as const) {
      registry.seed({
        entityId,
        state: { sensor_numeric: { value } },
        attributes: {},
        isAvailable: true,
        lastChanged: new Date('2026-11-09T10:00:00Z'),
        lastUpdated: new Date('2026-11-09T10:00:00Z'),
        source: 'pkg-weather',
      });
    }

    // The reads and writes are mocked: the runtime only hands the handle on.
    const db: Partial<Database> = {};

    runtime = new AliasCodeRuntime({
      db: db as Database,
      registry,
      directory: new EntityDirectory(),
      logger: silentLogger(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives what the function returns, fitted to the part', async () => {
    expect(await run(aliasOf('def value():\n    return sensor.power * 2\n'))).toEqual({
      value: 2400,
    });
  });

  it('gives None as null', async () => {
    expect(await run(aliasOf('def value():\n    return None\n'))).toEqual({ value: null });
  });

  it('fails at the line, with every value the run read', async () => {
    const ran = await run(
      aliasOf('def value():\n    base = part.value\n    return sensor.power / sensor.offset\n'),
    );

    expect(ran).toMatchObject({
      error: {
        message: 'division by zero',
        function: 'value',
        line: 3,
        inputs: { 'part.value': null, 'sensor.power': 1200, 'sensor.offset': 0 },
      },
    });
  });

  it('fails a value the part cannot take, and code that cannot be read', async () => {
    expect(await run(aliasOf('def value():\n    return "high"\n'))).toMatchObject({
      error: { message: 'expected a number, got "high"', function: 'value' },
    });
    expect(await run(aliasOf('def value(:\n    return 1\n'))).toMatchObject({
      error: { function: 'value', line: 1 },
    });
  });

  it('keeps mem across runs and writes it at most every 10 seconds, and on flush', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    const alias = aliasOf(COUNTER, { n: 5 });

    expect(await run(alias)).toEqual({ value: 6 });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(storeMemory)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(storeMemory).mock.calls[0]?.[2]).toEqual({ n: 6 });

    expect(await run(alias)).toEqual({ value: 7 });
    expect(await run(alias)).toEqual({ value: 8 });
    await vi.advanceTimersByTimeAsync(MEMORY_WRITE_INTERVAL_MS - 1);
    expect(vi.mocked(storeMemory)).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.mocked(storeMemory)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(storeMemory).mock.calls[1]?.[2]).toEqual({ n: 8 });

    expect(await run(alias)).toEqual({ value: 9 });
    await runtime.flush();
    expect(vi.mocked(storeMemory)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(storeMemory).mock.calls[2]?.[2]).toEqual({ n: 9 });
  });

  it('keeps the held mem for a definition read back, unless the API wrote another', async () => {
    const alias = aliasOf(COUNTER, { n: 5 });

    expect(await run(alias)).toEqual({ value: 6 });
    await runtime.flush();

    // Not written yet: the row still holds 6.
    expect(await run(alias)).toEqual({ value: 7 });
    runtime.forget('alias-1');
    expect(await run(aliasOf(COUNTER, { n: 6 }))).toEqual({ value: 8 });

    runtime.forget('alias-1');
    expect(await run(aliasOf(COUNTER, {}))).toEqual({ value: 1 });
    await runtime.flush();
    expect(vi.mocked(storeMemory).mock.lastCall?.[2]).toEqual({ n: 1 });
  });

  it('says whether the code reads the time', () => {
    expect(runtime.readsTime(aliasOf('def value():\n    return now().hour\n'))).toBe(true);
    expect(runtime.readsTime(aliasOf('def value():\n    return sensor.power\n'))).toBe(false);
  });
});

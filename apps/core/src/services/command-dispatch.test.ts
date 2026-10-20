import { describe, expect, it } from 'vitest';

import {
  adapterCommandSchema,
  ADAPTER_COMMAND_METHOD,
  busSubjects,
  parseEntityId,
  type AdapterAck,
  type AdapterCommand,
} from '@nebulahome/contracts';

import { AliasCatalog } from '../domain/alias-catalog.js';
import type { EntityRecord } from '../domain/entity-directory.js';
import { createCoreHarness, entityRecord, silentLogger } from '../testing/harness.js';

import type { AliasEngine } from './alias-engine.js';
import { createCommandDispatcher } from './command-dispatch.js';

const plug = parseEntityId('switch.dryer_plug');
const plugMatter = parseEntityId('switch.matter_dryer_plug');

describe('createCommandDispatcher', () => {
  it('commands a linked entity as the one it reads through, the way the link chooses', async () => {
    const harness = createCoreHarness();
    const received: { adapter: string; command: AdapterCommand }[] = [];

    harness.directory.set({
      ...entityRecord(plug, { source: 'shelly-plug' }),
      sources: [plug, plugMatter],
      preferred: 'shelly-plug',
    });
    harness.directory.set({
      ...entityRecord(plugMatter, { source: 'matter-plug' }),
      linkedTo: plug,
    });

    for (const adapter of ['shelly-plug', 'matter-plug']) {
      harness
        .clientFor(adapter)
        .serve(
          busSubjects.service(adapter, ADAPTER_COMMAND_METHOD),
          adapterCommandSchema,
          (command): Promise<AdapterAck> => {
            received.push({ adapter, command });

            return Promise.resolve({ acceptedAt: new Date() });
          },
        );
    }

    const dispatcher = createCommandDispatcher({
      client: harness.client,
      directory: harness.directory,
      aliases: new AliasCatalog(),
      aliasEngine: undefined as unknown as AliasEngine,
      commandTimeoutMs: 500,
      // The link reads Matter first while Shelly is silent.
      links: {
        route: (holder: EntityRecord): EntityRecord | undefined =>
          holder.sources?.[1] === undefined ? undefined : harness.directory.get(holder.sources[1]),
      },
    });

    const ack = await dispatcher.dispatch({
      entityId: plugMatter,
      capability: 'on_off',
      command: { command: 'turn_on' },
      traceId: '00000000-0000-4000-8000-000000000001',
      logger: silentLogger(),
    });

    expect(ack.entityId).toBe(plug);
    expect(received.map(({ adapter, command }) => [adapter, command.entityId])).toEqual([
      ['matter-plug', plugMatter],
    ]);
  });
});

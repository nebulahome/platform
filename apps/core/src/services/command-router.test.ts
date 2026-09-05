import { beforeEach, describe, expect, it } from 'vitest';

import {
  adapterCommandSchema,
  ADAPTER_COMMAND_METHOD,
  busSubjects,
  commandAckSchema,
  DeviceUnavailableError,
  NotFoundError,
  parseEntityId,
  type AdapterAck,
  type AdapterCommand,
} from '@nebula-home/contracts';

import { entityRecord, createCoreHarness, type CoreHarness } from '../testing/harness.js';

import { startCommandRouter } from './command-router.js';

const bulb = parseEntityId('light.kitchen_ceiling');
const thermometer = parseEntityId('sensor.kitchen_temperature');
const average = parseEntityId('alias.average_indoor_temperature');
const orphan = parseEntityId('light.never_registered');

describe('startCommandRouter', () => {
  let harness: CoreHarness;
  let received: AdapterCommand[];

  beforeEach(() => {
    harness = createCoreHarness();
    received = [];

    harness.directory.set(
      entityRecord(bulb, { capabilities: { on_off: {}, level: { hasTransition: true } } }),
    );
    harness.directory.set(entityRecord(thermometer, { capabilities: { sensor_numeric: {} } }));
    harness.directory.set(
      entityRecord(average, { source: 'derived', capabilities: { sensor_numeric: {} } }),
    );

    startCommandRouter({
      client: harness.client,
      directory: harness.directory,
      commandTimeoutMs: 200,
    });
  });

  /**
   * Starts an adapter that accepts everything.
   *
   * @param packageId - The package the adapter publishes under.
   */
  function startAdapter(packageId = 'pkg-mqtt'): void {
    harness
      .clientFor(packageId)
      .serve(
        busSubjects.service(packageId, ADAPTER_COMMAND_METHOD),
        adapterCommandSchema,
        (command: AdapterCommand): AdapterAck => {
          received.push(command);

          return { acceptedAt: new Date() };
        },
      );
  }

  it('forwards a valid command to the owning adapter', async () => {
    startAdapter();

    const ack = await harness
      .clientFor('api')
      .request(
        busSubjects.command(bulb, 'level'),
        { command: { command: 'set_level', level: 55 } },
        commandAckSchema,
      );

    expect(ack.entityId).toBe(bulb);
    expect(ack.capability).toBe('level');
    expect(received).toHaveLength(1);
    expect(received[0]?.command).toStrictEqual({ command: 'set_level', level: 55 });
  });

  it('names the entity in the body on the second hop', async () => {
    // The adapter subject addresses a package, and one package owns many entities, so the
    // subject alone cannot say which one the command is for.
    startAdapter();

    await harness
      .clientFor('api')
      .request(
        busSubjects.command(bulb, 'on_off'),
        { command: { command: 'toggle' } },
        commandAckSchema,
      );

    expect(received[0]?.entityId).toBe(bulb);
    expect(received[0]?.capability).toBe('on_off');
  });

  it('reports an adapter that is not running as unavailability', async () => {
    // The caller's side of the story is the same either way: the thing being addressed did not
    // answer. A transport error would send whoever reads the log to the wrong place.
    await expect(
      harness
        .clientFor('api')
        .request(
          busSubjects.command(bulb, 'on_off'),
          { command: { command: 'turn_on' } },
          commandAckSchema,
        ),
    ).rejects.toBeInstanceOf(DeviceUnavailableError);
  });

  it('refuses a command for an entity nobody registered', async () => {
    await expect(
      harness
        .clientFor('api')
        .request(
          busSubjects.command(orphan, 'on_off'),
          { command: { command: 'turn_on' } },
          commandAckSchema,
        ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a command for a derived entity', async () => {
    // Commanding one would write a value the next recomputation immediately overwrites; the
    // command belongs on whichever source entity actually drives it.
    await expect(
      harness
        .clientFor('api')
        .request(
          busSubjects.command(average, 'sensor_numeric'),
          { command: { command: 'set' } },
          commandAckSchema,
        ),
    ).rejects.toThrow(/has no adapter to command/);
  });

  it('refuses a capability the entity does not declare', async () => {
    startAdapter();

    await expect(
      harness
        .clientFor('api')
        .request(
          busSubjects.command(bulb, 'lock'),
          { command: { command: 'lock' } },
          commandAckSchema,
        ),
    ).rejects.toThrow(/has no lock capability/);

    expect(received).toHaveLength(0);
  });

  it('refuses a command a read-only capability cannot accept', async () => {
    await expect(
      harness
        .clientFor('api')
        .request(
          busSubjects.command(thermometer, 'sensor_numeric'),
          { command: { command: 'set' } },
          commandAckSchema,
        ),
    ).rejects.toThrow(/reports only/);
  });

  it('refuses a subject that is not a command subject', async () => {
    // The subscription is a wildcard, so the subject is the only thing that says what was asked
    // for, and one that cannot be read is a request that cannot be answered.
    await expect(
      harness
        .clientFor('api')
        .request(
          'nebula.v1.cmd.light.kitchen_ceiling.self_destruct',
          { command: {} },
          commandAckSchema,
        ),
    ).rejects.toThrow(/not a command subject/);
  });

  it('does not reach the adapter when validation fails', async () => {
    startAdapter();

    await expect(
      harness
        .clientFor('api')
        .request(
          busSubjects.command(bulb, 'level'),
          { command: { command: 'set_level', level: 500 } },
          commandAckSchema,
        ),
    ).rejects.toThrow();

    expect(received).toHaveLength(0);
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  ConflictError,
  INFRARED_OPS,
  INFRARED_REMOTE_KIND,
  INFRARED_TRANSPORT,
  infraredDeviceKeyOf,
  NotFoundError,
  ValidationError,
  type InfraredCode,
  type JsonObject,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';
import {
  createInfraredIntegration,
  encodeInfraredProtocol,
  type LoadedVendor,
  type TransportInbound,
} from '@nebulahome/package-runtime';

import type { BluetoothInstance } from '../persistence/bluetooth.js';
import { memoryInfraredStore } from '../persistence/infrared.js';
import { platformInfraredVendor } from '../services/platform-vendors.js';
import { createInfraredTransport } from '../transports/infrared.js';

import { InfraredBroker } from './broker.js';

/** The blaster that sends infrared and radio. */
const PRO = 'living-room-rm4';

/** The blaster that sends infrared only. */
const MINI = 'bedroom-rm4';

/** A TV's Power button: NEC, address 0x04, command 0x08. */
const POWER: InfraredCode = encodeInfraredProtocol({ name: 'nec', address: 0x04, command: 0x08 });

/** A gate's radio button, as a blaster hears it: on-off keyed, no frequency of its own. */
const GATE: InfraredCode = { signal: 'rf', carrierHz: 0, pulses: [300, 900, 300, 900, 900, 300] };

/** How a blaster's own timeout reaches the hub. */
const SILENCE = Object.assign(new Error('The operation was aborted due to timeout'), {
  name: 'TimeoutError',
});

/**
 * A blaster integration as far as the broker reads it: an RM4 pro that sends RF too, an RM4 mini
 * that sends infrared only.
 *
 * @returns The vendor.
 */
function broadlinkVendor(): LoadedVendor {
  return {
    manifest: { id: 'broadlink', name: 'Broadlink' },
    drivers: [
      {
        manifest: { id: 'broadlink/rm4-pro' },
        infrared: { signals: ['ir', 'rf'], receives: true },
      },
      { manifest: { id: 'broadlink/rm4-mini' }, infrared: { signals: ['ir'], receives: true } },
      { manifest: { id: 'broadlink/plug' } },
    ],
  } as unknown as LoadedVendor;
}

/**
 * An instance of the house.
 *
 * @param id - Its id.
 * @param kind - Its driver.
 * @param name - Its device's name.
 * @param extra - What differs.
 * @returns It.
 */
function instance(
  id: string,
  kind: string,
  name: string,
  extra: Partial<BluetoothInstance> = {},
): BluetoothInstance {
  return {
    id,
    kind,
    transport: 'broadlink/udp',
    externalId: id,
    name,
    areaId: null,
    state: 'running',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...extra,
  };
}

/** A broker under test, and what it was given. */
type Rig = {
  readonly broker: InfraredBroker;
  readonly instances: BluetoothInstance[];

  /** Every op sent to a blaster, in order. */
  readonly sent: { deviceId: string; op: string; args: JsonObject }[];

  /** What each op answers; a function may throw, or wait. */
  readonly answers: Map<string, () => unknown>;

  /** The devices identified again, in order. */
  readonly reloaded: string[];
};

/**
 * A broker over a memory store and two blasters. A remote saved is added to the house at once,
 * as `api`'s auto-adoption would.
 *
 * @returns The rig, started.
 */
async function rig(): Promise<Rig> {
  const instances = [
    instance(PRO, 'broadlink/rm4-pro', 'Living room RM4', {
      areaId: '0b2f9a52-4c55-4f63-9d6c-1d9a3c6b1f00',
    }),
    instance(MINI, 'broadlink/rm4-mini', 'Bedroom RM4'),
    instance('kitchen-plug', 'broadlink/plug', 'Kitchen plug'),
  ];
  const sent: Rig['sent'] = [];
  const answers = new Map<string, () => unknown>([
    [INFRARED_OPS.send, () => null],
    [INFRARED_OPS.cancel, () => null],
  ]);
  const reloaded: string[] = [];
  const broker: InfraredBroker = new InfraredBroker({
    store: memoryInfraredStore(),
    logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
    vendors: () => [broadlinkVendor(), platformInfraredVendor('2026.10.0', '1.6.0')],
    instances: async () =>
      Promise.resolve([
        ...instances,
        ...broker.devices().map(({ deviceKey }) =>
          instance(`tv-${deviceKey.slice(-4)}`, INFRARED_REMOTE_KIND, 'Remote', {
            transport: INFRARED_TRANSPORT,
            externalId: deviceKey,
          }),
        ),
      ]),
    roles: {
      send: async (deviceId, op, args) => {
        sent.push({ deviceId, op, args });

        return Promise.resolve().then(() => answers.get(op)?.());
      },
    },
    addWaitMs: 0,
  });
  broker.onSaved((deviceIds) => reloaded.push(...deviceIds));
  await broker.start();

  return { broker, instances, sent, answers, reloaded };
}

/**
 * Waits until a learn job ended.
 *
 * @param broker - The broker.
 * @param jobId - The job.
 * @returns It, ended.
 */
async function ended(broker: InfraredBroker, jobId: string) {
  await vi.waitFor(() => {
    expect(['captured', 'failed', 'cancelled']).toContain(broker.job(jobId).phase);
  });

  return broker.job(jobId);
}

describe('the Infrared broker', () => {
  it('lists the devices whose profile declares a blaster, and has no hardware without one', async () => {
    const { broker, instances } = await rig();

    expect(await broker.blasters()).toEqual([
      expect.objectContaining({ deviceId: MINI, signals: ['ir'], receives: true, isOnline: true }),
      expect.objectContaining({
        deviceId: PRO,
        name: 'Living room RM4',
        vendorId: 'broadlink',
        vendorName: 'Broadlink',
        areaId: '0b2f9a52-4c55-4f63-9d6c-1d9a3c6b1f00',
        signals: ['ir', 'rf'],
        lastSentAt: null,
        remotes: 0,
      }),
    ]);
    expect(await broker.status()).toMatchObject({
      state: 'running',
      blasters: { total: 2, online: 2 },
      remotes: 0,
      devices: { total: 0, online: 0 },
      learning: [],
      lastSent: null,
    });

    instances.splice(0, 2);
    expect(await broker.status()).toMatchObject({ state: 'unavailable', blasters: { total: 0 } });
  });

  it('makes a remote a device of the house, its buttons button entities', async () => {
    const { broker } = await rig();
    const remote = await broker.saveRemote({
      name: 'TV',
      kind: 'tv',
      blasterId: PRO,
      columns: 3,
    });

    expect(remote).toMatchObject({ name: 'TV', blasterName: 'Living room RM4', canRf: true });
    expect(remote.deviceId).toMatch(/^tv-/u);

    const power = await broker.saveButton({
      remoteId: remote.id,
      name: 'Power',
      icon: 'power',
      code: POWER,
    });
    const integration = createInfraredIntegration({ id: INFRARED_REMOTE_KIND });
    const [sighting] = broker.devices();
    const claim = integration.claim(
      { deviceKey: sighting?.deviceKey ?? '', payload: sighting?.device },
      {},
    );

    expect(claim?.externalId).toBe(infraredDeviceKeyOf(remote.id));
    expect(claim === null ? undefined : integration.describe(claim, {})).toMatchObject({
      name: 'TV',
      entities: [{ domain: 'button', objectId: power.id, name: 'Power', icon: 'power' }],
    });
  });

  it('learns a code: listening, then captured with its protocol', async () => {
    const { broker, sent, answers } = await rig();
    let hear: (code: unknown) => void = () => undefined;

    answers.set(
      INFRARED_OPS.learn,
      async () =>
        new Promise((resolve) => {
          hear = resolve;
        }),
    );

    const job = broker.learn(PRO, 'ir', 30_000);

    expect(job).toMatchObject({
      blasterId: PRO,
      blasterName: 'Living room RM4',
      phase: 'listening',
    });
    expect(job.endsAt).not.toBeNull();
    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        deviceId: PRO,
        op: INFRARED_OPS.learn,
        args: { signal: 'ir', timeoutMs: 30_000 },
      });
    });
    expect((await broker.status()).learning).toEqual([
      { jobId: job.id, blasterId: PRO, blasterName: 'Living room RM4' },
    ]);
    // A second dialog on the same blaster follows the same job.
    expect(broker.learn(PRO, 'ir', 30_000).id).toBe(job.id);

    hear({ signal: 'ir', carrierHz: POWER.carrierHz, pulses: POWER.pulses });

    const captured = await ended(broker, job.id);

    expect(captured).toMatchObject({ phase: 'captured', error: null, endsAt: null });
    expect(captured.code?.protocol).toEqual({ name: 'nec', address: 0x04, command: 0x08 });
    expect((await broker.status()).learning).toEqual([]);
  });

  it('fails a job that heard nothing in time, or that the integration refused', async () => {
    const { broker, answers } = await rig();

    answers.set(INFRARED_OPS.learn, () => {
      throw SILENCE;
    });
    expect(await ended(broker, broker.learn(PRO, 'ir', 30_000).id)).toMatchObject({
      phase: 'failed',
      error: 'Nothing reached the blaster in 30 s.',
    });

    answers.set(INFRARED_OPS.learn, () => {
      throw new Error('The RM4 is learning for another app');
    });
    expect(await ended(broker, broker.learn(PRO, 'ir', 30_000).id)).toMatchObject({
      phase: 'failed',
      error: 'The RM4 is learning for another app',
    });
  });

  it('cancels a job and tells the blaster to stop listening', async () => {
    const { broker, sent, answers } = await rig();
    let refuse: (error: Error) => void = () => undefined;

    answers.set(
      INFRARED_OPS.learn,
      async () =>
        new Promise((resolve, reject) => {
          refuse = reject;
        }),
    );

    const job = broker.learn(MINI, 'ir', 30_000);

    expect(await broker.cancel(job.id)).toMatchObject({ phase: 'cancelled' });
    expect(sent.at(-1)).toEqual({ deviceId: MINI, op: INFRARED_OPS.cancel, args: {} });

    // The learn the cancel stopped rejects; the job stays cancelled.
    refuse(new Error('Cancelled'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(broker.job(job.id)).toMatchObject({ phase: 'cancelled', error: null });
    expect(() => broker.job('missing')).toThrow(NotFoundError);
  });

  it('sweeps an RF button first, then listens, and keeps the frequency it found', async () => {
    const { broker, sent, answers } = await rig();

    answers.set(INFRARED_OPS.sweep, () => ({ frequencyHz: 433_920_000 }));
    answers.set(INFRARED_OPS.learn, () => GATE);

    const job = broker.learn(PRO, 'rf', 30_000);

    expect(job.phase).toBe('sweeping');

    const captured = await ended(broker, job.id);

    expect(sent.map(({ op }) => op)).toEqual([INFRARED_OPS.sweep, INFRARED_OPS.learn]);
    expect(captured).toMatchObject({
      phase: 'captured',
      frequencyHz: 433_920_000,
      code: { ...GATE, frequencyHz: 433_920_000 },
    });
    expect(() => broker.learn(MINI, 'rf', 30_000)).toThrow(ValidationError);
  });

  it('sends a press through the remote’s own blaster, and notes it', async () => {
    const { broker, sent } = await rig();
    const tv = await broker.saveRemote({ name: 'TV', kind: 'tv', blasterId: PRO, columns: 3 });
    const fan = await broker.saveRemote({ name: 'Fan', kind: 'fan', blasterId: MINI, columns: 3 });
    const power = await broker.saveButton({
      remoteId: tv.id,
      name: 'Power',
      icon: null,
      code: POWER,
    });
    const speed = await broker.saveButton({
      remoteId: fan.id,
      name: 'Speed',
      icon: null,
      code: POWER,
    });
    const connection = await createInfraredTransport(broker).connect(
      {},
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: () => undefined,
        report: () => undefined,
      },
    );

    await connection.send(
      { deviceKey: infraredDeviceKeyOf(fan.id), op: 'press', args: { buttonId: speed.id } },
      AbortSignal.timeout(1000),
    );
    expect(sent).toEqual([{ deviceId: MINI, op: INFRARED_OPS.send, args: { code: POWER } }]);

    // A button is pressed only as one of its own remote's.
    await expect(
      connection.send(
        { deviceKey: infraredDeviceKeyOf(fan.id), op: 'press', args: { buttonId: power.id } },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow(NotFoundError);

    const { pressedAt } = await broker.press(power.id);

    expect(sent.at(-1)?.deviceId).toBe(PRO);
    expect((await broker.remote(tv.id)).buttons[0]?.lastPressedAt).toEqual(pressedAt);
    expect(await broker.status()).toMatchObject({
      lastSent: { remoteName: 'TV', buttonName: 'Power', blasterName: 'Living room RM4' },
    });
    expect((await broker.blasters()).find((each) => each.deviceId === PRO)?.lastSentAt).toEqual(
      pressedAt,
    );
    await expect(broker.test(MINI, GATE)).rejects.toThrow(ValidationError);
  });

  it('keeps a remote whose blaster is gone, its buttons unavailable, until it gets another', async () => {
    const { broker, instances, reloaded } = await rig();
    const tv = await broker.saveRemote({ name: 'TV', kind: 'tv', blasterId: PRO, columns: 3 });
    const power = await broker.saveButton({
      remoteId: tv.id,
      name: 'Power',
      icon: null,
      code: POWER,
    });
    const delivered: TransportInbound[] = [];
    const connection = await createInfraredTransport(broker).connect(
      {},
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (message) => delivered.push(message),
        report: () => undefined,
      },
    );
    const deviceKey = infraredDeviceKeyOf(tv.id);
    const identified = reloaded.length;

    await connection.apply([]);
    expect(delivered.at(-1)).toEqual({
      connectionKey: INFRARED_TRANSPORT,
      deviceKey,
      payload: { isAvailable: true },
    });

    // Its blaster stops: unavailable while it is down.
    instances[0] = instance(PRO, 'broadlink/rm4-pro', 'Living room RM4', { state: 'stopped' });
    await broker.refresh();
    expect(delivered.at(-1)?.payload).toEqual({ isAvailable: false });
    await expect(broker.press(power.id)).rejects.toThrow(ConflictError);

    // Removed: the remote keeps its buttons and waits for another blaster.
    instances.splice(0, 1);
    broker.releaseInstance(PRO);
    expect(await broker.remote(tv.id)).toMatchObject({
      blasterId: null,
      blasterName: null,
      isBlasterOnline: false,
      buttonCount: 1,
    });
    await expect(broker.press(power.id)).rejects.toThrow(/has no blaster/u);

    // Moved to another one: sent as learned, nothing identified again.
    await broker.saveRemote({ id: tv.id, name: 'TV', kind: 'tv', blasterId: MINI, columns: 3 });
    expect(delivered.at(-1)?.payload).toEqual({ isAvailable: true });
    await broker.press(power.id);
    expect(reloaded).toHaveLength(identified);
  });

  it('moves a button only to an empty cell, and identifies the remote again when its buttons change', async () => {
    const { broker, reloaded } = await rig();
    const tv = await broker.saveRemote({ name: 'TV', kind: 'tv', blasterId: PRO, columns: 3 });
    const deviceId = tv.deviceId ?? '';
    const power = await broker.saveButton({
      remoteId: tv.id,
      name: 'Power',
      icon: null,
      code: POWER,
    });
    const mute = await broker.saveButton({
      remoteId: tv.id,
      name: 'Mute',
      icon: null,
      code: POWER,
    });

    expect([power.cell, mute.cell]).toEqual([0, 1]);
    expect(reloaded).toEqual([deviceId, deviceId]);

    expect((await broker.moveButton(mute.id, 5)).cell).toBe(5);
    await expect(broker.moveButton(mute.id, 0)).rejects.toThrow(/only to an empty cell/u);
    await expect(
      broker.saveButton({ remoteId: tv.id, name: 'Input', icon: null, cell: 5, code: POWER }),
    ).rejects.toThrow(ConflictError);

    // Duplicate: a new button with the same code, in the first empty cell.
    expect(
      (await broker.saveButton({ remoteId: tv.id, name: 'Mute copy', icon: null, code: POWER }))
        .cell,
    ).toBe(1);
    expect(reloaded).toHaveLength(3);

    // Its code changed, nothing it describes did: not identified again.
    await broker.saveButton({
      remoteId: tv.id,
      id: power.id,
      name: 'Power',
      icon: null,
      code: GATE,
    });
    expect(reloaded).toHaveLength(3);

    expect(await broker.removeButton(mute.id)).toBe(true);
    expect(reloaded).toHaveLength(4);
    expect((await broker.remote(tv.id)).buttons.map((button) => button.cell)).toEqual([0, 1]);
  });

  it('imports codes into the free cells, all of them or none', async () => {
    const { broker } = await rig();
    const tv = await broker.saveRemote({ name: 'TV', kind: 'tv', blasterId: PRO, columns: 3 });

    await broker.saveButton({ remoteId: tv.id, name: 'Power', icon: null, code: POWER });

    const imported = await broker.importButtons(tv.id, [
      { name: 'Vol +', icon: null, code: POWER },
      { name: 'Vol -', icon: 'volume-down', code: POWER },
    ]);

    expect(imported.buttons.map(({ name, cell }) => ({ name, cell }))).toEqual([
      { name: 'Power', cell: 0 },
      { name: 'Vol +', cell: 1 },
      { name: 'Vol -', cell: 2 },
    ]);
    await expect(
      broker.importButtons(
        tv.id,
        [...Array(254).keys()].map((index) => ({
          name: `Key ${String(index)}`,
          icon: null,
          code: POWER,
        })),
      ),
    ).rejects.toThrow(/room for 253/u);
  });

  it('removes a remote whose device left the house, and only that one', async () => {
    const { broker } = await rig();
    const tv = await broker.saveRemote({ name: 'TV', kind: 'tv', blasterId: PRO, columns: 3 });
    const fan = await broker.saveRemote({ name: 'Fan', kind: 'fan', blasterId: null, columns: 2 });

    await broker.saveButton({ remoteId: tv.id, name: 'Power', icon: null, code: POWER });
    await broker.release(infraredDeviceKeyOf(tv.id));
    expect((await broker.remotes()).map((remote) => remote.id)).toEqual([fan.id]);
    expect(broker.devices()).toHaveLength(1);
    await expect(
      broker.saveRemote({ name: 'Radio', kind: 'audio', blasterId: 'kitchen-plug', columns: 3 }),
    ).rejects.toThrow(NotFoundError);
  });
});

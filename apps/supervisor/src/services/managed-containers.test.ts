/**
 * The managed containers' bookkeeping: which owner declares what, and which kind's reconciling
 * releases which containers; and a container that speaks MQTT waiting for the broker, against an
 * engine the test holds.
 */
import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, type ManagedContainerSpec } from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import { MANAGED_LABELS, type PlatformContext } from '../domain/managed.js';

import {
  ManagedContainers,
  WAITING_FOR_BROKER,
  type ManagedContainersOptions,
} from './managed-containers.js';

/**
 * One declared container.
 *
 * @param vendorId - Its vendor, or package.
 * @param dependencyId - Its id.
 * @returns The declaration.
 */
function spec(vendorId: string, dependencyId: string): ManagedContainerSpec {
  return {
    ownerKind: 'vendor',
    vendorId,
    dependencyId,
    name: dependencyId,
    image: `example/${dependencyId}`,
    minVersion: '1.0.0',
    env: [],
    volumes: [],
    devices: [],
    ports: [],
    seed: [],
    webPort: null,
  };
}

/**
 * The set, with Docker out of reach.
 *
 * @returns It.
 */
function managed(): ManagedContainers {
  return new ManagedContainers({
    logger: createLogger({ service: 'supervisor', version: '0.0.0', level: 'fatal' }),
    context: () => null,
    installationId: 'test',
    selfId: () => null,
    onChange: () => undefined,
  } as unknown as ManagedContainersOptions);
}

/**
 * The labels a managed container carries.
 *
 * @param ownerKind - Who declares it.
 * @param vendorId - The vendor or the package.
 * @param dependencyId - Its id.
 * @returns The labels.
 */
function labels(ownerKind: string, vendorId: string, dependencyId: string): Record<string, string> {
  return {
    [MANAGED_LABELS.managed]: 'true',
    [MANAGED_LABELS.ownerKind]: ownerKind,
    [MANAGED_LABELS.vendor]: vendorId,
    [MANAGED_LABELS.dependency]: dependencyId,
  };
}

describe('the managed containers of two kinds of owner', () => {
  it("leaves the packages' containers declared when the vendors are reconciled", () => {
    const set = managed();

    set.reconcile({
      ownerKind: 'package',
      vendors: [{ vendorId: 'nvr', containers: [spec('nvr', 'frigate')] }],
    });
    set.reconcile({
      ownerKind: 'vendor',
      vendors: [{ vendorId: 'zigbee2mqtt', containers: [spec('zigbee2mqtt', 'zigbee2mqtt')] }],
    });

    expect(set.managerOf(labels('package', 'nvr', 'frigate'))).toEqual({
      ownerKind: 'package',
      vendorId: 'nvr',
      dependencyId: 'frigate',
      isReleased: false,
    });
    expect(set.statusesOf('nvr', 'package')).toEqual([
      expect.objectContaining({ ownerKind: 'package', dependencyId: 'frigate' }),
    ]);
    expect(set.statusesOf('nvr')).toEqual([]);
  });

  it('releases a container its kind no longer declares, and reads an unlabelled one as a vendor’s', () => {
    const set = managed();

    set.reconcile({ ownerKind: 'vendor', vendors: [] });

    expect(
      set.managerOf({
        [MANAGED_LABELS.managed]: 'true',
        [MANAGED_LABELS.vendor]: 'zigbee2mqtt',
        [MANAGED_LABELS.dependency]: 'zigbee2mqtt',
      }),
    ).toMatchObject({ ownerKind: 'vendor', isReleased: true });
    // The packages were never reconciled: nothing of theirs is released yet.
    expect(set.managerOf(labels('package', 'nvr', 'frigate'))?.isReleased).toBe(false);
  });
});

/** The platform on the host network: no shared network to make, so the engine is asked less. */
const HOST: PlatformContext = {
  network: 'host',
  installationId: 'test',
  networkName: 'nebulahome',
  platformAlias: 'nebulahome',
  mqtt: null,
  timezone: 'Europe/Rome',
  dataMount: { kind: 'separate' },
};

/**
 * zigbee2mqtt as its bundle declares it, as far as the broker goes.
 *
 * @returns The declaration.
 */
function speaking(): ManagedContainerSpec {
  return {
    ...spec('zigbee2mqtt', 'bridge'),
    env: [{ name: 'ZIGBEE2MQTT_CONFIG_MQTT_SERVER', value: '{platform.mqtt.url}' }],
  };
}

/**
 * The set over an engine the test holds, with a broker that answers what the test says.
 *
 * @param existing - The container already there, if one is.
 * @returns The set, the engine, and the broker to set.
 */
function withEngine(existing?: unknown) {
  const engine = {
    inspectContainer: vi.fn(() =>
      existing === undefined
        ? Promise.reject(new NotFoundError('No such container'))
        : Promise.resolve(existing),
    ),
    inspectImage: vi.fn(() => Promise.resolve(undefined)),
    pull: vi.fn(() => Promise.resolve()),
    createContainer: vi.fn<(name: string, body: unknown) => Promise<string>>(() =>
      Promise.resolve('made'),
    ),
    control: vi.fn(() => Promise.resolve()),
  };
  const broker: { current: PlatformContext['mqtt'] | undefined } = { current: undefined };
  const set = new ManagedContainers({
    engine,
    registry: { tags: () => Promise.resolve(['2.1.0']) },
    logger: createLogger({ service: 'supervisor', version: '0.0.0', level: 'fatal' }),
    dataRoot: '/nowhere',
    context: () => HOST,
    installationId: 'test',
    selfId: () => null,
    onChange: () => undefined,
    brokerFor: () => Promise.resolve(broker.current),
    brokerRetryMs: 60_000,
  } as unknown as ManagedContainersOptions);

  return { set, engine, broker };
}

describe('a container that speaks MQTT', () => {
  it('waits for the broker instead of being made with an empty address, then is made', async () => {
    const { set, engine, broker } = withEngine();

    set.ensure({ vendorId: 'zigbee2mqtt', containers: [speaking()] });

    await vi.waitFor(() => {
      expect(set.statusesOf('zigbee2mqtt')[0]).toMatchObject({
        state: 'missing',
        error: WAITING_FOR_BROKER,
      });
    });
    expect(engine.pull).not.toHaveBeenCalled();
    expect(engine.createContainer).not.toHaveBeenCalled();

    // The MQTT package came up: a package event asks again.
    broker.current = { url: 'mqtt://127.0.0.1:1883', username: 'z2m', password: 'secret' };
    set.retryAwaitingBroker();

    await vi.waitFor(() => {
      expect(engine.createContainer).toHaveBeenCalledTimes(1);
    });
    expect(JSON.stringify(engine.createContainer.mock.calls[0]?.[1])).toContain(
      'ZIGBEE2MQTT_CONFIG_MQTT_SERVER=mqtt://127.0.0.1:1883',
    );
    expect(set.statusesOf('zigbee2mqtt')[0]).toMatchObject({ state: 'running', error: null });
    set.stop();
  });

  it('leaves a container already made exactly as it is while the broker does not answer', async () => {
    const { set, engine } = withEngine({
      Id: 'old',
      Image: 'sha256:old',
      Config: { Image: 'example/bridge:2.1.0', Labels: {} },
      State: { Running: true },
    });

    set.ensure({ vendorId: 'zigbee2mqtt', containers: [speaking()] });

    await vi.waitFor(() => {
      expect(set.statusesOf('zigbee2mqtt')[0]).toMatchObject({
        state: 'running',
        error: WAITING_FOR_BROKER,
      });
    });
    expect(engine.createContainer).not.toHaveBeenCalled();
    expect(engine.control).not.toHaveBeenCalled();
    set.stop();
  });

  it('is made at once when it does not speak MQTT, broker or not', async () => {
    const { set, engine } = withEngine();

    set.ensure({ vendorId: 'tasmota', containers: [spec('tasmota', 'bridge')] });

    await vi.waitFor(() => {
      expect(engine.createContainer).toHaveBeenCalledTimes(1);
    });
    set.stop();
  });
});

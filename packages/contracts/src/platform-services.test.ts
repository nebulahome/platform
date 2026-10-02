import { describe, expect, it } from 'vitest';

import {
  MQTT_BROKER_SERVICE,
  missingServices,
  mqttCredentialsRequestSchema,
  PLATFORM_SERVICES,
  platformServiceNameSchema,
  providerOf,
  servicesHeldBy,
  type ServiceProvider,
} from './platform-services.js';

/**
 * A package that provides the MQTT broker.
 *
 * @param id - Its id.
 * @param isRunning - Whether it runs.
 * @returns The package.
 */
function broker(id: string, isRunning: boolean): ServiceProvider {
  return { id, provides: [MQTT_BROKER_SERVICE], isRunning };
}

describe('the platform services', () => {
  it('are named <protocol>-broker', () => {
    for (const service of PLATFORM_SERVICES) {
      expect(platformServiceNameSchema.safeParse(service.name).success).toBe(true);
    }

    expect(platformServiceNameSchema.safeParse('matter-broker').success).toBe(true);
    expect(platformServiceNameSchema.safeParse('matter-controller').success).toBe(false);
  });

  it('take the credentials requests the hub and the supervisor send', () => {
    expect(mqttCredentialsRequestSchema.safeParse({ principal: 'hub' }).success).toBe(true);
    expect(
      mqttCredentialsRequestSchema.safeParse({
        principal: 'container',
        owner: 'vendor:zigbee2mqtt',
        topics: ['zigbee2mqtt/#'],
      }).success,
    ).toBe(true);
    expect(
      mqttCredentialsRequestSchema.safeParse({ principal: 'container', owner: 'zigbee2mqtt' })
        .success,
    ).toBe(false);
  });
});

describe('providerOf', () => {
  it('prefers a running provider, then the default package, then the id', () => {
    expect(providerOf(MQTT_BROKER_SERVICE, [])).toBeUndefined();
    expect(providerOf(MQTT_BROKER_SERVICE, [broker('mosquitto', false)])).toBe('mosquitto');
    expect(
      providerOf(MQTT_BROKER_SERVICE, [broker('mosquitto', false), broker('mqtt', false)]),
    ).toBe('mqtt');
    expect(
      providerOf(MQTT_BROKER_SERVICE, [broker('mosquitto', true), broker('mqtt', false)]),
    ).toBe('mosquitto');
    expect(providerOf(MQTT_BROKER_SERVICE, [broker('zebra', false), broker('alpha', false)])).toBe(
      'alpha',
    );
  });
});

describe('servicesHeldBy', () => {
  it('names the required services a package is the only one to provide', () => {
    const cards = { id: 'cards', provides: [] };

    expect(servicesHeldBy('mqtt', [broker('mqtt', true), cards]).map((each) => each.name)).toEqual([
      MQTT_BROKER_SERVICE,
    ]);
    expect(servicesHeldBy('mqtt', [broker('mqtt', true), broker('mosquitto', false)])).toEqual([]);
    expect(servicesHeldBy('cards', [broker('mqtt', true), cards])).toEqual([]);
  });
});

describe('missingServices', () => {
  it('names the required services nothing provides, but for those that stand outside', () => {
    expect(missingServices([], new Set()).map((each) => each.name)).toEqual([MQTT_BROKER_SERVICE]);
    expect(missingServices([broker('mqtt', false)], new Set())).toEqual([]);
    expect(missingServices([], new Set([MQTT_BROKER_SERVICE]))).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { registrationOf, reportsOf, type ContainerFacts } from './entities.js';

const FACTS: ContainerFacts = {
  name: 'my_web.server',
  displayName: 'My Web Server',
  image: 'nginx:1.27.3',
  version: '1.27.3',
  isRunning: true,
  canUpdate: true,
  cpuPercent: 3.14159,
  memoryUsedBytes: 256,
  memoryLimitBytes: 1024,
  update: { latestVersion: '1.27.4', isInstalling: false, progress: null },
};

describe('registrationOf', () => {
  it("names every entity after the container's slug", () => {
    const registration = registrationOf(FACTS);

    expect(registration.entities.map((entity) => entity.entityId)).toEqual([
      'sensor.container_my_web_server_cpu_usage',
      'sensor.container_my_web_server_memory_usage',
      'sensor.container_my_web_server_memory_used',
      'binary_sensor.container_my_web_server_running',
      'update.container_my_web_server_image',
    ]);
    expect(registration.swVersion).toBe('1.27.3');
  });

  it('offers no install for a container that must not be replaced from here', () => {
    const image = registrationOf({ ...FACTS, canUpdate: false }).entities.at(-1);

    expect(image?.capabilities).toEqual({ update: { canInstall: false, hasProgress: true } });
  });
});

describe('reportsOf', () => {
  it('reports the readings rounded as the entities show them', () => {
    const reports = reportsOf(FACTS);

    expect(reports[0]?.state).toEqual({ sensor_numeric: { value: 3.1 } });
    expect(reports[1]?.state).toEqual({ sensor_numeric: { value: 25 } });
    expect(reports[3]?.state).toEqual({ sensor_binary: { isOn: true } });
    expect(reports[4]?.state).toEqual({
      update: {
        installedVersion: '1.27.3',
        latestVersion: '1.27.4',
        isInstalling: false,
        progress: null,
      },
    });
  });

  it('makes a reading that could not be taken unavailable, not zero', () => {
    const reports = reportsOf({ ...FACTS, isRunning: false, cpuPercent: null });

    expect(reports[0]).toMatchObject({ isAvailable: false, state: {} });
  });
});

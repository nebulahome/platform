import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { parseEntityId, SYSTEM_ENTITIES } from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';

import type { NetworkCounters } from '../domain/network-counters.js';
import { createCoreHarness, entityRecord, type CoreHarness } from '../testing/harness.js';

import { SystemMonitor } from './system-monitor.js';
import type { SystemProbes } from './system-probes.js';

const cpu = parseEntityId('sensor.system_cpu_usage');
const download = parseEntityId('sensor.system_network_download');
const disk = parseEntityId('sensor.system_disk_usage');

/** A machine made up for the test, whose counters advance by a fixed step on every reading. */
type FakeMachine = {
  readonly probes: SystemProbes;

  /** Whether the network can be read; switched off to test a platform where it cannot. */
  hasNetwork: boolean;
};

/**
 * Builds a machine whose processor is a quarter busy and whose network receives 10 kB a read.
 *
 * @returns The machine.
 */
function fakeMachine(): FakeMachine {
  let reads = 0;
  let received = 0;

  const machine: FakeMachine = {
    hasNetwork: true,
    probes: {
      readCpu: () => {
        reads += 1;

        return { busy: reads * 25, total: reads * 100 };
      },
      readMemory: () => ({ usedBytes: 4096, totalBytes: 16_384 }),
      readVolume: async () => Promise.resolve({ totalBytes: 1000, freeBytes: 750, usedBytes: 250 }),
      readNetwork: async (): Promise<NetworkCounters | undefined> => {
        received += 10_000;

        return Promise.resolve(
          machine.hasNetwork
            ? { interface: 'eth0', receivedBytes: received, transmittedBytes: 0 }
            : undefined,
        );
      },
      readHost: () => ({
        hostname: 'nebula',
        platform: 'linux',
        osName: 'Linux 6.8.0',
        arch: 'x64',
        uptimeSeconds: 60,
        cpuModel: 'Test processor',
        cpuCount: 4,
      }),
    },
  };

  return machine;
}

describe('SystemMonitor', () => {
  let harness: CoreHarness;
  let machine: FakeMachine;
  let monitor: SystemMonitor;
  let clock: number;

  beforeEach(async () => {
    harness = createCoreHarness();
    machine = fakeMachine();
    clock = Date.UTC(2026, 8, 23, 12, 0, 0);

    for (const entity of SYSTEM_ENTITIES) {
      harness.directory.set(
        entityRecord(parseEntityId(entity.entityId), {
          source: 'system',
          capabilities: { sensor_numeric: {} },
        }),
      );
    }

    monitor = new SystemMonitor({
      probes: machine.probes,
      // Asked only for its size when the disk is counted, which fails here and is reported;
      // the data directory below does not exist, so the count finds an empty platform.
      db: undefined as unknown as Database,
      dataDir: join(tmpdir(), 'nebula-no-such-data-dir'),
      ingest: {
        client: harness.client,
        registry: harness.registry,
        directory: harness.directory,
        history: harness.history,
        stateCache: harness.stateCache,
        logger: harness.logger,
      },
      logger: harness.logger,
      newTraceId: () => 'trace',
      sampleIntervalMs: 10_000,
      publishIntervalMs: 60_000,
      now: () => new Date(clock),
    });

    // The baseline the first sample is measured against; the clocks are stopped at once, so
    // the samples below are taken by hand.
    await monitor.start();
    monitor.stop();
  });

  /**
   * Moves the clock on and takes a sample.
   *
   * @param seconds - How far to move it.
   */
  async function tick(seconds = 10): Promise<void> {
    clock += seconds * 1000;
    await monitor.sample();
  }

  it('turns the counters into a share and a rate between two samples', async () => {
    await tick();
    await tick();

    const latest = monitor.snapshot().samples.at(-1);

    expect(latest?.cpuPercent).toBe(25);
    expect(latest?.receiveRate).toBe(1000);
    expect(latest?.memoryUsedBytes).toBe(4096);
  });

  it('gives each system entity the mean of the samples since the last time', async () => {
    await tick();
    await tick();
    await tick();

    monitor.publish();

    expect(harness.registry.get(cpu)?.state.sensor_numeric?.value).toBe(25);
    expect(harness.registry.get(disk)?.state.sensor_numeric?.value).toBe(25);
    expect(harness.registry.get(download)?.isAvailable).toBe(true);
  });

  it('publishes nothing when no sample was taken since the last time', async () => {
    await tick();
    monitor.publish();

    const rows = harness.historyRows.length;

    monitor.publish();

    expect(harness.historyRows).toHaveLength(rows);
  });

  it('makes a network entity unavailable, not zero, where the network cannot be read', async () => {
    machine.hasNetwork = false;

    await tick();
    await tick();
    monitor.publish();

    expect(harness.registry.get(download)?.isAvailable).toBe(false);
    expect(monitor.snapshot().network).toBeNull();
  });

  it('keeps the host and the volume in its snapshot, and no more samples than the window', async () => {
    for (let index = 0; index < 100; index += 1) {
      await tick();
    }

    const snapshot = monitor.snapshot();

    expect(snapshot.samples).toHaveLength(90);
    expect(snapshot.host.cpuCount).toBe(4);
    expect(snapshot.disk).toMatchObject({ usedBytes: 250, otherBytes: 250, measuredAt: null });
  });
});

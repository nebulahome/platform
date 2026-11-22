import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseEntityId, QUIET_TIME_ENTITY_ID } from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';

import type { ActivityCell } from '../domain/quietest.js';
import { readActivity } from '../persistence/activity-load.js';
import { createCoreHarness, entityRecord, type CoreHarness } from '../testing/harness.js';

import { QuietTimeMonitor } from './quiet-time-monitor.js';

vi.mock('../persistence/activity-load.js', () => ({ readActivity: vi.fn() }));

const QUIET = parseEntityId(QUIET_TIME_ENTITY_ID);

/** A read of the activity the test answers when it chooses. */
type PendingRead = { readonly answer: () => void };

describe('QuietTimeMonitor', () => {
  let harness: CoreHarness;
  let monitor: QuietTimeMonitor;
  let reads: PendingRead[];

  beforeEach(() => {
    harness = createCoreHarness();
    reads = [];
    harness.directory.set(
      entityRecord(QUIET, { source: 'system', capabilities: { sensor_text: {} } }),
    );
    vi.mocked(readActivity).mockImplementation(
      async () =>
        new Promise<ActivityCell[]>((resolve) => {
          reads.push({
            answer: () => {
              resolve([]);
            },
          });
        }),
    );
    monitor = new QuietTimeMonitor({
      // Only handed to the activity read, which is the mock above.
      db: undefined as unknown as Database,
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
    });
  });

  /**
   * The zone the reported time was learned in.
   *
   * @returns It, or undefined while nothing was reported.
   */
  function reportedZone(): unknown {
    return harness.registry.get(QUIET)?.attributes['timezone'];
  }

  it('reports once the weeks of history are read, without holding up its start', async () => {
    monitor.start('Europe/Rome');

    expect(reads).toHaveLength(1);
    expect(reportedZone()).toBeUndefined();

    reads[0]?.answer();
    await vi.waitFor(() => {
      expect(reportedZone()).toBe('Europe/Rome');
    });
    monitor.stop();
  });

  it('drops a time learned in a zone the house has left meanwhile', async () => {
    monitor.start('UTC');
    monitor.sync('Europe/Rome');

    reads[1]?.answer();
    await vi.waitFor(() => {
      expect(reportedZone()).toBe('Europe/Rome');
    });

    reads[0]?.answer();
    await new Promise((resolve) => setImmediate(resolve));
    expect(reportedZone()).toBe('Europe/Rome');
    monitor.stop();
  });

  it('drops a time learned after it stopped', async () => {
    monitor.start('Europe/Rome');
    monitor.stop();

    reads[0]?.answer();
    await new Promise((resolve) => setImmediate(resolve));
    expect(reportedZone()).toBeUndefined();
  });
});

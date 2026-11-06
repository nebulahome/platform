/**
 * The entity lab builds every domain the contracts define from their schemas alone, and what it
 * builds is something the contracts accept - with nothing optional on, and with every optional
 * capability on.
 */
import { describe, expect, it } from 'vitest';

import { DOMAIN_CAPABILITIES, ENTITY_DOMAINS } from '@nebulahome/contracts';

import {
  applyCommand,
  buildRow,
  initialRows,
  withCapability,
} from '@/testing/entity-lab/lab-model';

/** The time the rows are built at. */
const NOW = Date.parse('2026-11-06T12:00:00Z');

describe('the entity lab', () => {
  it('starts a row for each way a domain may be, and the contracts accept every one', () => {
    for (const domain of ENTITY_DOMAINS) {
      const rows = initialRows(domain);

      expect(rows).toHaveLength(DOMAIN_CAPABILITIES[domain].oneOf.length);

      for (const row of rows) {
        expect(buildRow(row, NOW).issues, `${domain} ${row.id}`).toEqual([]);
      }
    }
  });

  it('still builds what the contracts accept with every optional capability switched on', () => {
    for (const domain of ENTITY_DOMAINS) {
      for (const row of initialRows(domain)) {
        const full = DOMAIN_CAPABILITIES[domain].may.reduce(
          (each, capability) => withCapability(each, capability, true),
          row,
        );

        expect(buildRow(full, NOW).issues, `${domain} ${row.id}`).toEqual([]);
      }
    }
  });

  it('answers a command as a device that obeys would, its argument copied by name', () => {
    expect(applyCommand({ level: 10 }, { command: 'set_level', level: 70 })).toEqual({ level: 70 });
    expect(applyCommand({ isOn: false }, { command: 'turn_on' })).toEqual({ isOn: true });
    expect(applyCommand({ activity: 'docked', rooms: [] }, { command: 'start' })).toMatchObject({
      activity: 'cleaning',
    });
  });
});

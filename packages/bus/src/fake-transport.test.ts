import { describe, expect, it } from 'vitest';

import { BUS_PATTERNS, busSubjects, type EntityId } from '@nebulahome/contracts';

import { subjectMatches } from './fake-transport.js';

const kitchenLight = 'light.kitchen_ceiling' as EntityId;

describe('subjectMatches', () => {
  it('matches an exact subject', () => {
    expect(subjectMatches('nebula.v1.state.snapshot', 'nebula.v1.state.snapshot')).toBe(true);
  });

  it('matches a single token with *', () => {
    expect(subjectMatches('nebula.v1.event.device.*', 'nebula.v1.event.device.added')).toBe(true);
  });

  it('does not let * span the dot inside an entity id', () => {
    // The rule the whole `BUS_PATTERNS` table exists for. `light.kitchen_ceiling` is two NATS
    // tokens, so a pattern ending in `*` receives nothing - a subscription that looks right,
    // publishes that succeed, and a feature that silently does nothing.
    expect(subjectMatches('nebula.v1.state.report.*', busSubjects.stateReport(kitchenLight))).toBe(
      false,
    );
  });

  it('spans an entity id with >', () => {
    expect(
      subjectMatches(BUS_PATTERNS.allStateReports, busSubjects.stateReport(kitchenLight)),
    ).toBe(true);
  });

  it('requires > to match at least one token', () => {
    expect(subjectMatches('nebula.v1.state.report.>', 'nebula.v1.state.report')).toBe(false);
  });

  it('rejects a subject that is longer than the pattern', () => {
    expect(subjectMatches('nebula.v1.state.snapshot', 'nebula.v1.state.snapshot.extra')).toBe(
      false,
    );
  });

  it('agrees with every pattern the contract publishes', () => {
    expect(
      subjectMatches(BUS_PATTERNS.allCommands, busSubjects.command(kitchenLight, 'on_off')),
    ).toBe(true);
    expect(subjectMatches(BUS_PATTERNS.allTelemetry, busSubjects.telemetry(kitchenLight))).toBe(
      true,
    );
    expect(
      subjectMatches(BUS_PATTERNS.allStateChanges, busSubjects.stateChanged(kitchenLight)),
    ).toBe(true);
    expect(subjectMatches(BUS_PATTERNS.allPackageEvents, busSubjects.packageEvent('started'))).toBe(
      true,
    );
    expect(subjectMatches(BUS_PATTERNS.allLogs, busSubjects.log('core', 'warn'))).toBe(true);
  });
});

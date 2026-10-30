import { describe, expect, it } from 'vitest';

import {
  BUS_PATTERNS,
  busSubjects,
  entityCommandPattern,
  parseCommandSubject,
} from './bus-subjects.js';
import { parseEntityId } from './entity-id.js';

const entityId = parseEntityId('light.kitchen_ceiling');

describe('subject builders', () => {
  it('prefixes every subject with the bus contract version', () => {
    expect(busSubjects.stateReport(entityId)).toBe('nebula.v1.state.report.light.kitchen_ceiling');
    expect(busSubjects.stateSnapshot()).toBe('nebula.v1.state.snapshot');
    expect(busSubjects.telemetry(entityId)).toBe('nebula.v1.telemetry.light.kitchen_ceiling');
  });

  it('places the capability after the entity id on a command subject', () => {
    expect(busSubjects.command(entityId, 'on_off')).toBe(
      'nebula.v1.cmd.light.kitchen_ceiling.on_off',
    );
  });

  it('builds log subjects from the service and the level', () => {
    expect(busSubjects.log('core', 'warn')).toBe('nebula.v1.log.core.warn');
  });
});

describe('subscription patterns', () => {
  it('uses the multi-token wildcard wherever an entity id appears', () => {
    // An entity id contains a dot, so it spans two NATS tokens. A trailing `*` matches one
    // token and would silently receive nothing at all.
    expect(BUS_PATTERNS.allStateReports.endsWith('.>')).toBe(true);
    expect(BUS_PATTERNS.allStateChanges.endsWith('.>')).toBe(true);
    expect(BUS_PATTERNS.allCommands.endsWith('.>')).toBe(true);
    expect(BUS_PATTERNS.allTelemetry.endsWith('.>')).toBe(true);
  });

  it('uses the single-token wildcard where the variable part is one token', () => {
    expect(BUS_PATTERNS.allDeviceEvents.endsWith('.*')).toBe(true);
    expect(BUS_PATTERNS.allPackageEvents.endsWith('.*')).toBe(true);
  });

  it('keeps a package’s live subjects out of the package events, one token longer', () => {
    const tokens = (subject: string): number => subject.split('.').length;

    expect(busSubjects.packageLive('music')).toBe('nebula.v1.pkg.music.live');
    expect(tokens(busSubjects.packageLive('music'))).toBe(tokens(BUS_PATTERNS.allPackageLive));
    expect(tokens(busSubjects.packageLiveInbox('music'))).toBe(
      tokens(BUS_PATTERNS.allPackageEvents) + 1,
    );
  });

  it('matches the subjects it is meant to cover', () => {
    // Mirrors how NATS resolves `>`: it stands for one or more remaining tokens.
    const prefix = BUS_PATTERNS.allStateReports.slice(0, -1);

    expect(busSubjects.stateReport(entityId).startsWith(prefix)).toBe(true);
  });

  it('narrows to one entity across all of its capabilities', () => {
    expect(entityCommandPattern(entityId)).toBe('nebula.v1.cmd.light.kitchen_ceiling.*');
  });
});

describe('parseCommandSubject', () => {
  it('reads back what the builder wrote', () => {
    expect(parseCommandSubject(busSubjects.command(entityId, 'level'))).toStrictEqual({
      entityId,
      capability: 'level',
    });
  });

  it('rejects a subject that is not a command', () => {
    // `core` subscribes with one wildcard and routes on the subject alone, so anything it
    // cannot read has to be refused rather than guessed at.
    expect(parseCommandSubject(busSubjects.stateReport(entityId))).toBeNull();
    expect(parseCommandSubject('nebula.v1.cmd.light.kitchen_ceiling')).toBeNull();
  });

  it('rejects a capability that does not exist', () => {
    expect(parseCommandSubject('nebula.v1.cmd.light.kitchen_ceiling.self_destruct')).toBeNull();
  });

  it('rejects an entity id that does not match the pattern', () => {
    expect(parseCommandSubject('nebula.v1.cmd.Light.Kitchen.on_off')).toBeNull();
  });

  it('rejects another bus contract version', () => {
    expect(parseCommandSubject('nebula.v2.cmd.light.kitchen_ceiling.on_off')).toBeNull();
  });
});

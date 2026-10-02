import { describe, expect, it } from 'vitest';

import { packageEntityTypeSchema, parseEntityId } from '@nebulahome/contracts';

import { validateCommand } from './command-validation.js';
import type { EntityRecord } from './entity-directory.js';
import { customCommandProblem, customStateProblem, PackageTypes } from './package-types.js';

/** A recorder's recording, as its manifest declares it. */
const RECORDING = packageEntityTypeSchema.parse({
  id: 'recording',
  name: 'Recording',
  icon: 'video',
  state: [
    { key: 'startedAt', type: 'timestamp', label: 'Started' },
    { key: 'size', type: 'number', label: 'Size', unit: 'MB' },
    {
      key: 'reason',
      type: 'choice',
      label: 'Why',
      choices: [
        { value: 'motion', label: 'Motion' },
        { value: 'person', label: 'A person' },
      ],
    },
    { key: 'note', type: 'text', label: 'Note', isOptional: true },
  ],
  commands: [
    { id: 'keep', name: 'Keep it' },
    { id: 'rename', name: 'Rename', fields: [{ key: 'title', type: 'text', label: 'Title' }] },
  ],
});

/** The entity of one recording. */
const ENTITY: EntityRecord = {
  entityId: parseEntityId('custom.nvr_last_recording'),
  rowId: 'row-1',
  source: 'nvr',
  isEnabled: true,
  capabilities: new Map([['custom', { packageId: 'nvr', type: 'recording' }]]),
};

/**
 * The types, with the recorder's.
 *
 * @returns Them.
 */
function types(): PackageTypes {
  const kept = new PackageTypes();

  kept.set('nvr', [RECORDING]);

  return kept;
}

describe("a custom entity's state", () => {
  it('holds values of its fields, in their types, a part of them at a time', () => {
    expect(customStateProblem(RECORDING, { size: 12, reason: 'person' })).toBeUndefined();
    expect(customStateProblem(RECORDING, { note: null })).toBeUndefined();
  });

  it('refuses a field it does not have, a value of the wrong type, and a choice it lacks', () => {
    expect(customStateProblem(RECORDING, { colour: 'red' })).toBe(
      'colour is not one of its fields',
    );
    expect(customStateProblem(RECORDING, { size: '12' })).toBe('size must be a number');
    expect(customStateProblem(RECORDING, { reason: 'cat' })).toBe(
      'reason must be one of motion, person',
    );
    expect(customStateProblem(RECORDING, { startedAt: 'yesterday' })).toBe(
      'startedAt must be a timestamp',
    );
    expect(customStateProblem(RECORDING, { size: null })).toBe('size must be a number');
  });
});

describe("a custom entity's commands", () => {
  it('takes its type’s commands with their fields, whole', () => {
    expect(customCommandProblem(RECORDING, 'keep', {})).toBeUndefined();
    expect(customCommandProblem(RECORDING, 'rename', { title: 'Front door' })).toBeUndefined();
    expect(customCommandProblem(RECORDING, 'rename', {})).toBe('title is missing');
    expect(customCommandProblem(RECORDING, 'erase', {})).toBe('A Recording takes no command erase');
  });

  it('is refused by core before the package is asked, and when the type is not known', () => {
    expect(
      validateCommand(ENTITY, 'custom', { command: 'rename', args: { title: 'Hall' } }, types()),
    ).toEqual({ command: 'rename', args: { title: 'Hall' } });
    expect(() =>
      validateCommand(ENTITY, 'custom', { command: 'rename', args: { title: 3 } }, types()),
    ).toThrow(/title must be a text/u);
    expect(() =>
      validateCommand(ENTITY, 'custom', { command: 'keep' }, new PackageTypes()),
    ).toThrow(/not installed/u);
  });
});

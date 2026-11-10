import { describe, expect, it } from 'vitest';

import {
  aliasFileSchema,
  aliasPartsReads,
  aliasesFile,
  changedLines,
  diffAliasEntry,
  readAliasFile,
  replaceAliasEntity,
  type AliasFileEntry,
} from './alias-file.js';

const THERMOSTAT: AliasFileEntry = aliasFileSchema.parse({
  format: 'nebula-home/aliases',
  version: 1,
  aliases: [
    {
      key: 'living_room_thermostat',
      name: 'Living room thermostat',
      behavesAs: 'thermostat',
      area: 'living_room',
      device: { device: 'Living room heater' },
      parts: {
        target_temperature: { from: 'stored', value: 21, min: 5, max: 30, step: 0.5 },
        mode: { from: 'stored', value: 'heat', offered: ['off', 'heat'] },
        action: { from: 'code', function: 'action' },
        current_temperature: { from: 'entity', entity: 'sensor.living_room_temperature' },
        humidity: {
          from: 'formula',
          formula: 'avg(sensor.lr_humidity, sensor.purifier_humidity)',
        },
      },
      code: ['def action():', '    return "idle"'],
    },
  ],
}).aliases[0]!;

describe('aliases file', () => {
  it('reads back what it writes', () => {
    const text = JSON.stringify(aliasesFile([THERMOSTAT]), null, 2);
    const read = readAliasFile(text);

    expect(read.ok).toBe(true);
    expect(read.ok && read.file.aliases[0]).toEqual(THERMOSTAT);
  });

  it('says where a file is wrong: JSON, shape, or parts for the type', () => {
    expect(readAliasFile('{').ok).toBe(false);

    const wrongShape = readAliasFile(JSON.stringify({ format: 'nebula-home/scenes', version: 1 }));
    expect(wrongShape.ok).toBe(false);

    const wrongParts = readAliasFile(
      JSON.stringify(
        aliasesFile([{ ...THERMOSTAT, parts: { mode: { from: 'stored', value: 'heat' } } }]),
      ),
    );

    expect(wrongParts.ok).toBe(false);
    expect(!wrongParts.ok && wrongParts.problems.map((problem) => problem.path)).toEqual([
      'aliases.0.parts.target_temperature',
      'aliases.0.parts.action',
    ]);
  });

  it('lists the entities the parts read, formulas included', () => {
    expect(aliasPartsReads(THERMOSTAT.parts)).toEqual([
      'sensor.living_room_temperature',
      'sensor.lr_humidity',
      'sensor.purifier_humidity',
    ]);
  });

  it('puts another entity in the place of a missing one, everywhere it is named', () => {
    const entry = replaceAliasEntity(
      { ...THERMOSTAT, code: ['x = sensor.lr_humidity + sensor.lr_humidity_2'] },
      'sensor.lr_humidity',
      'sensor.hall_humidity',
    );

    expect(entry.parts['humidity']).toMatchObject({
      formula: 'avg(sensor.hall_humidity, sensor.purifier_humidity)',
    });
    expect(entry.code).toEqual(['x = sensor.hall_humidity + sensor.lr_humidity_2']);
  });

  it('lists the changes between two setups, one per setting', () => {
    const after: AliasFileEntry = {
      ...THERMOSTAT,
      parts: {
        ...THERMOSTAT.parts,
        target_temperature: { from: 'stored', value: 21, min: 10, max: 30, step: 0.5 },
        preset: { from: 'stored', value: 'comfort', offered: ['comfort', 'eco'] },
      },
      code: ['def action():', '    return "heating"'],
    };

    expect(diffAliasEntry(THERMOSTAT, after)).toEqual([
      { sign: '+', path: 'preset', after: after.parts['preset'] },
      { sign: '~', path: 'target_temperature.min', before: 5, after: 10 },
      { sign: '~', path: 'code', after: 2 },
    ]);
    expect(diffAliasEntry(THERMOSTAT, THERMOSTAT)).toEqual([]);
  });

  it('counts the lines that differ', () => {
    expect(changedLines(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(2);
    expect(changedLines([], ['a'])).toBe(1);
    expect(changedLines(['a', 'b'], ['a', 'b'])).toBe(0);
  });
});

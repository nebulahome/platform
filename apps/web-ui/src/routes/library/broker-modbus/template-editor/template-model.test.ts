import { describe, expect, it } from 'vitest';

import {
  documentOf,
  emptyTemplate,
  entityOf,
  fileOf,
  manualNumberingOf,
  parseFile,
  problemsOf,
  type TemplateDraft,
} from './template-model';

/**
 * A relay board of one relay and a firmware register.
 *
 * @returns The blocks.
 */
function relayBoard(): TemplateDraft {
  const relay = entityOf('switch', 'Relay 1');
  const firmware = entityOf('sensor', 'Firmware');

  return {
    ...emptyTemplate(),
    name: 'Waveshare relay 8ch',
    pollSeconds: '5',
    entities: [
      relay,
      {
        ...firmware,
        capabilities: {
          sensor_numeric: {
            read: {
              ...firmware.capabilities.sensor_numeric!.read!,
              function: 3,
              address: '0x8000',
              scale: '0.01',
            },
            write: null,
          },
        },
      },
    ],
  };
}

describe('the template model', () => {
  it('writes the file with each read and write on one line, and reads it back', () => {
    const file = fileOf(relayBoard());

    expect(file).toContain('"read": { "function": 1, "address": "0x0000" }');
    expect(file).toContain('"write": { "function": 5 }');
    expect(file).toContain('"read": { "function": 3, "address": "0x8000", "scale": 0.01 }');

    const parsed = parseFile(file);

    expect(parsed.error).toBeNull();
    expect(documentOf(parsed.draft!)).toEqual(documentOf(relayBoard()));
  });

  it('says what is wrong where it is', () => {
    const board = relayBoard();
    const [relay] = board.entities;
    const wrong: TemplateDraft = {
      ...board,
      entities: [
        {
          ...relay!,
          capabilities: {
            on_off: {
              read: relay!.capabilities.on_off!.read,
              write: { ...relay!.capabilities.on_off!.write!, function: 6 },
            },
          },
        },
      ],
    };

    expect(problemsOf(relayBoard()).size).toBe(0);
    expect(problemsOf(wrong).get('entities.0.capabilities.on_off.write.function')).toBe(
      'The read is a coil: write it with 05 or 15',
    );
  });

  it('keeps blocks for a file a rule refuses, and none for one that is not JSON', () => {
    const file = fileOf(relayBoard()).replace('"function": 5', '"function": 6');

    expect(parseFile(file).draft?.entities).toHaveLength(2);
    expect(parseFile('{ "name": ').error).toMatch(/^Not valid JSON/u);
    expect(
      parseFile('{ "name": "x", "entities": [{ "name": "Relay", "domain": "fan" }] }').error,
    ).toMatch(/^Entity 1 \(Relay\): /u);
  });

  it('reads a manual’s numbering as the register it means', () => {
    expect(manualNumberingOf(3, '40011')).toEqual({ typed: '40011', register: '0x000A' });
    expect(manualNumberingOf(4, '30001')).toEqual({ typed: '30001', register: '0x0000' });
    expect(manualNumberingOf(3, '0x000A')).toBeUndefined();
    expect(manualNumberingOf(1, '40011')).toBeUndefined();
  });
});

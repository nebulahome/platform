import { describe, expect, it } from 'vitest';

import { automationDefinitionSchema, renameEntities } from '@nebulahome/contracts';

import { durationMsOf } from './ha-import';
import { automationsFile, readLibraryFile, scenesFile } from './library-file';

const NONE = { automations: [], scenes: [] };

/** An automations.yaml in both syntaxes, with something of every kind the port handles. */
const AUTOMATIONS_YAML = `
- id: '1700000000000'
  alias: Evening lights
  description: Warm light at sunset
  mode: restart
  trigger:
    - platform: sun
      event: sunset
      offset: "-00:15:00"
    - platform: state
      entity_id: binary_sensor.door, binary_sensor.back_door
      to: "on"
      for: { minutes: 2 }
    - platform: template
      value_template: "{{ true }}"
  condition:
    - condition: time
      after: "17:00"
      weekday: [mon, tue]
    - condition: not
      conditions:
        - condition: state
          entity_id: input_boolean.guest
          state: "on"
    - condition: sun
      after: sunset
  action:
    - service: light.turn_on
      target:
        entity_id: light.living
        area_id: kitchen
      data:
        brightness_pct: 60
        kelvin: 2700
        transition: 2
    - delay: "00:00:30"
    - condition: state
      entity_id: person.anna
      state: home
    - choose:
        - conditions:
            - condition: numeric_state
              entity_id: sensor.lux
              below: 50
          sequence:
            - service: scene.turn_on
              target: { entity_id: scene.evening }
      default:
        - action: notify.mobile_app
          data: { message: Hi }
- alias: New syntax
  triggers:
    - trigger: time_pattern
      minutes: /5
    - trigger: numeric_state
      entity_id: sensor.temp
      above: 20
      below: 25
  actions:
    - repeat:
        until:
          - condition: state
            entity_id: cover.blind
            state: closed
        sequence:
          - action: cover.close_cover
            entity_id: cover.blind
    - parallel:
        - action: climate.set_temperature
          target: { entity_id: climate.hall }
          data: { temperature: 21, hvac_mode: heat_cool }
        - sequence:
            - action: media_player.volume_set
              target: { entity_id: media_player.kitchen }
              data: { volume_level: 0.3 }
    - variables: { a: 1 }
- alias: Blueprinted
  use_blueprint: { path: motion.yaml }
`;

describe('readLibraryFile with Home Assistant automations', () => {
  const reading = readLibraryFile(AUTOMATIONS_YAML, {
    automations: ['evening_lights'],
    scenes: [],
  });

  if (!reading.ok || reading.file.kind !== 'automations') {
    throw new Error('Should have read as automations');
  }

  const [evening, newer] = reading.file.items;
  const items = reading.file.items;

  it('ports every automation but the blueprint, with keys that are free', () => {
    expect(reading.file.items.map((item) => item.key)).toEqual(['evening_lights_2', 'new_syntax']);
    expect(reading.file.notes.some((note) => note.item === 'Blueprinted')).toBe(true);
    expect(evening).toMatchObject({ name: 'Evening lights', mode: 'restart' });
  });

  it('writes documents the format accepts', () => {
    for (const item of items) {
      expect(automationDefinitionSchema.safeParse(item.definition).success).toBe(true);
    }
  });

  it('carries triggers over, one per entity, and notes the template', () => {
    expect(evening?.definition['triggers']).toEqual([
      { type: 'sun', event: 'sunset', offsetMinutes: -15 },
      {
        type: 'entity',
        entityId: 'binary_sensor.door',
        change: { kind: 'state', to: 'on' },
        forMs: 120_000,
      },
      {
        type: 'entity',
        entityId: 'binary_sensor.back_door',
        change: { kind: 'state', to: 'on' },
        forMs: 120_000,
      },
    ]);
    expect(reading.file.notes.some((note) => note.message.includes('"template"'))).toBe(true);
  });

  it('carries conditions over: time with days, NOT as a negated OR, the sun below the horizon', () => {
    expect(evening?.definition['if']).toEqual([
      { type: 'time', from: '17:00', days: ['monday', 'tuesday'] },
      {
        type: 'or',
        isNot: true,
        conditions: [
          {
            type: 'entity',
            entityId: 'input_boolean.guest',
            match: { kind: 'state', states: ['on'] },
          },
        ],
      },
      { type: 'sun', phase: 'below', elevation: -0.833 },
    ]);
  });

  it('splits a light call, and turns a condition step into an If over what follows', () => {
    const then = evening?.definition['then'] as Record<string, unknown>[];

    expect(then[0]).toEqual({
      type: 'command',
      entityId: 'light.living',
      capability: 'level',
      params: { command: 'set_level', level: 60, transitionMs: 2000 },
    });
    expect(then[1]).toMatchObject({ capability: 'color_temp', params: { mireds: 370 } });
    expect(then[2]).toEqual({ type: 'wait_duration', durationMs: 30_000 });
    expect(then[3]).toMatchObject({
      type: 'if',
      conditions: [{ type: 'entity', entityId: 'person.anna' }],
      then: [
        {
          type: 'if',
          conditions: [{ match: { kind: 'numeric', operator: 'lt', value: 50 } }],
          then: [{ type: 'scene', sceneKey: 'evening' }],
          else: [{ type: 'notify', channel: 'mobile_app', message: 'Hi' }],
        },
      ],
    });
    expect(reading.file.notes.some((note) => note.message.includes('area'))).toBe(true);
  });

  it('reads the new syntax: cron, a window kept as above, until as a negated AND, parallel', () => {
    expect(newer?.definition['triggers']).toEqual([
      { type: 'time', at: { kind: 'cron', expression: '*/5 * * * *' } },
      {
        type: 'entity',
        entityId: 'sensor.temp',
        change: { kind: 'numeric', operator: 'gt', value: 20 },
      },
    ]);

    const then = newer?.definition['then'] as Record<string, unknown>[];

    expect(then[0]).toMatchObject({
      type: 'do_while',
      conditions: [{ type: 'and', isNot: true }],
      actions: [{ capability: 'cover', params: { command: 'close' } }],
    });
    expect(then[1]).toMatchObject({
      type: 'parallel',
      branches: [
        [
          { params: { command: 'set_mode', mode: 'auto' } },
          { params: { command: 'set_target', temperature: 21 } },
        ],
        [{ params: { command: 'set_volume', volume: 30 } }],
      ],
    });
    expect(then).toHaveLength(2);
  });

  it('lets renamed entities through to the document', () => {
    const renamed = renameEntities(
      evening?.definition ?? {},
      new Map([['light.living', 'light.soggiorno']]),
    );

    expect(JSON.stringify(renamed)).toContain('light.soggiorno');
    expect(JSON.stringify(renamed)).not.toContain('light.living');
  });
});

describe('readLibraryFile with Home Assistant scenes', () => {
  it('reads each entity into a target state', () => {
    const reading = readLibraryFile(
      `
- id: '1'
  name: Romantic
  entities:
    light.tv:
      state: "on"
      brightness: 128
      rgb_color: [255, 0, 0]
    switch.fan: "off"
    cover.blind:
      state: closed
    media_player.kitchen:
      state: playing
      volume_level: 0.25
    sensor.thing:
      state: "12"
`,
      NONE,
    );

    expect(reading.ok && reading.file.kind === 'scenes' ? reading.file.items[0] : null).toEqual({
      key: 'romantic',
      name: 'Romantic',
      icon: null,
      areaKey: null,
      transitionMs: 0,
      rollbackOnPartialFailure: false,
      members: [
        {
          entityId: 'light.tv',
          targetState: {
            on_off: { isOn: true },
            level: { level: 50 },
            color_hs: { hue: 0, saturation: 100 },
          },
          transitionMs: null,
        },
        { entityId: 'switch.fan', targetState: { on_off: { isOn: false } }, transitionMs: null },
        { entityId: 'cover.blind', targetState: { cover: { position: 0 } }, transitionMs: null },
        {
          entityId: 'media_player.kitchen',
          targetState: { media_player: { playback: 'playing', volume: 25, isMuted: false } },
          transitionMs: null,
        },
      ],
    });
  });

  it('reads the scene section of a configuration.yaml, keeping !secret as text', () => {
    const reading = readLibraryFile(
      'homeassistant:\n  name: !secret name\nscene:\n  - name: Off\n    entities:\n      light.a: "off"\n',
      NONE,
    );

    expect(reading.ok && reading.file.kind === 'scenes' ? reading.file.items.length : 0).toBe(1);
  });
});

describe('our own files', () => {
  it('reads back what it writes, renaming a key that is taken', () => {
    const file = automationsFile([
      {
        key: 'porch',
        name: 'Porch',
        description: '',
        mode: 'single',
        maxRuntimeMs: 60_000,
        isEnabled: true,
        definition: { triggers: [{ type: 'manual' }], then: [{ type: 'stop' }] },
      },
    ]);
    const reading = readLibraryFile(JSON.stringify(file), { automations: ['porch'], scenes: [] });

    expect(reading.ok && reading.file.items[0]).toMatchObject({ key: 'porch_2', name: 'Porch' });
  });

  it('writes a scene with its waiting members as members', () => {
    const file = scenesFile([
      {
        id: '00000000-0000-4000-8000-000000000000',
        key: 'evening',
        name: 'Evening',
        icon: null,
        areaKey: null,
        transitionMs: 0,
        rollbackOnPartialFailure: false,
        members: [],
        unresolvedMembers: [
          { entityId: 'light.gone' as never, targetState: {}, transitionMs: null },
        ],
      },
    ]);
    const reading = readLibraryFile(JSON.stringify(file), NONE);

    expect(
      reading.ok && reading.file.kind === 'scenes' ? reading.file.items[0]?.members : [],
    ).toEqual([{ entityId: 'light.gone', targetState: {}, transitionMs: null }]);
  });

  it('refuses a file from a newer platform, and one that is something else', () => {
    expect(
      readLibraryFile(
        JSON.stringify({ format: 'nebula-home/scenes', version: 9, scenes: [] }),
        NONE,
      ).ok,
    ).toBe(false);
    expect(readLibraryFile(JSON.stringify({ format: 'nebula-home/dashboard' }), NONE).ok).toBe(
      false,
    );
    expect(readLibraryFile('just: words', NONE).ok).toBe(false);
  });
});

describe('durationMsOf', () => {
  it('reads every way Home Assistant writes a duration', () => {
    expect(durationMsOf(90)).toBe(90_000);
    expect(durationMsOf('01:02:03')).toBe(3_723_000);
    expect(durationMsOf('-00:15:00')).toBe(-900_000);
    expect(durationMsOf({ minutes: 1, milliseconds: 500 })).toBe(60_500);
    expect(durationMsOf('{{ states("input_number.x") }}')).toBeNull();
  });
});

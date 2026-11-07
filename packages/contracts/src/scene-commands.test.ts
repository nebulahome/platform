/**
 * The pure mappers that turn a scene target state into entity commands, and pick what a
 * rollback puts back.
 */
import { describe, expect, it } from 'vitest';

import { commandsForTargetState, restoreStateFor } from './scene-commands.js';

describe('commandsForTargetState', () => {
  it('maps on_off to turn_on and turn_off', () => {
    expect(commandsForTargetState({ on_off: { isOn: true } })).toEqual([
      { capability: 'on_off', command: { command: 'turn_on' } },
    ]);
    expect(commandsForTargetState({ on_off: { isOn: false } })).toEqual([
      { capability: 'on_off', command: { command: 'turn_off' } },
    ]);
  });

  it('maps level, colour and colour temperature', () => {
    expect(
      commandsForTargetState({
        level: { level: 40 },
        color_hs: { hue: 120, saturation: 80 },
        color_temp: { mireds: 300 },
      }),
    ).toEqual([
      { capability: 'level', command: { command: 'set_level', level: 40 } },
      {
        capability: 'color_hs',
        command: { command: 'set_color', hue: 120, saturation: 80 },
      },
      {
        capability: 'color_temp',
        command: { command: 'set_color_temp', mireds: 300 },
      },
    ]);
  });

  it('maps cover position and tilt without commanding motion', () => {
    expect(
      commandsForTargetState({ cover: { position: 75, tilt: 20, motion: 'stopped' } }),
    ).toEqual([
      { capability: 'cover', command: { command: 'set_position', position: 75 } },
      { capability: 'cover', command: { command: 'set_tilt', tilt: 20 } },
    ]);
  });

  it('maps lock locked and unlocked, and skips jammed', () => {
    expect(commandsForTargetState({ lock: { lockState: 'locked' } })).toEqual([
      { capability: 'lock', command: { command: 'lock' } },
    ]);
    expect(commandsForTargetState({ lock: { lockState: 'unlocked' } })).toEqual([
      { capability: 'lock', command: { command: 'unlock' } },
    ]);
    expect(commandsForTargetState({ lock: { lockState: 'jammed' } })).toEqual([]);
  });

  it('maps thermostat mode and then target, without readings', () => {
    expect(
      commandsForTargetState({
        thermostat: {
          currentTemperature: 21,
          targetTemperature: 22.5,
          mode: 'heat',
          action: 'heating',
          humidity: 40,
        },
      }),
    ).toEqual([
      { capability: 'thermostat', command: { command: 'set_mode', mode: 'heat' } },
      {
        capability: 'thermostat',
        command: { command: 'set_target', temperature: 22.5 },
      },
    ]);
  });

  it('only switches off a thermostat that is to be off', () => {
    expect(
      commandsForTargetState({
        thermostat: {
          currentTemperature: 21,
          targetTemperature: 22.5,
          mode: 'off',
          action: 'off',
        },
      }),
    ).toEqual([{ capability: 'thermostat', command: { command: 'set_mode', mode: 'off' } }]);
  });

  it('only switches off a light that is to be off, since a level would turn it back on', () => {
    expect(
      commandsForTargetState({
        on_off: { isOn: false },
        level: { level: 60 },
        color_hs: { hue: 10, saturation: 20 },
        color_temp: { mireds: 300 },
      }),
    ).toEqual([{ capability: 'on_off', command: { command: 'turn_off' } }]);
  });

  it('maps media playback, volume and mute, and skips titles and idle', () => {
    expect(
      commandsForTargetState({
        media_player: {
          playback: 'playing',
          volume: 30,
          isMuted: false,
          source: 'spotify',
          mediaTitle: 'Song',
          mediaArtist: 'Artist',
          mediaPositionSeconds: 12,
        },
      }),
    ).toEqual([
      { capability: 'media_player', command: { command: 'play' } },
      { capability: 'media_player', command: { command: 'set_volume', volume: 30 } },
      { capability: 'media_player', command: { command: 'set_mute', isMuted: false } },
      {
        capability: 'media_player',
        command: { command: 'set_source', source: 'spotify' },
      },
    ]);

    expect(
      commandsForTargetState({
        media_player: {
          playback: 'idle',
          volume: 10,
          isMuted: true,
        },
      }),
    ).toEqual([
      { capability: 'media_player', command: { command: 'set_volume', volume: 10 } },
      { capability: 'media_player', command: { command: 'set_mute', isMuted: true } },
    ]);

    expect(
      commandsForTargetState({
        media_player: { playback: 'paused', volume: 0, isMuted: false },
      }),
    ).toEqual([
      { capability: 'media_player', command: { command: 'pause' } },
      { capability: 'media_player', command: { command: 'set_volume', volume: 0 } },
      { capability: 'media_player', command: { command: 'set_mute', isMuted: false } },
    ]);

    expect(
      commandsForTargetState({
        media_player: { playback: 'stopped', volume: 0, isMuted: false },
      }),
    ).toEqual([
      { capability: 'media_player', command: { command: 'stop' } },
      { capability: 'media_player', command: { command: 'set_volume', volume: 0 } },
      { capability: 'media_player', command: { command: 'set_mute', isMuted: false } },
    ]);
  });
});

describe('restoreStateFor', () => {
  it('takes back only the capabilities the scene set', () => {
    expect(
      restoreStateFor(
        {
          on_off: { isOn: true },
          level: { level: 30 },
          media_player: { playback: 'playing', volume: 50, isMuted: false },
        },
        { level: { level: 90 } },
      ),
    ).toEqual({ level: { level: 30 } });
  });

  it('has nothing to restore when the entity held no state before', () => {
    expect(restoreStateFor({}, { on_off: { isOn: true } })).toEqual({});
  });
});

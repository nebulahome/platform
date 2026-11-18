/**
 * The samples of the thermostat, the cover, the lock, the media player and the camera.
 *
 * `CONTROL_SAMPLES` holds one entity per kind of card, the one the Add card catalogue draws (the
 * first of each kind); `CONTROL_VARIANTS` the ones the lab draws besides: what the boards
 * `K-All`, `K-Capabilities` and `K-States` draw for these kinds.
 */
import type { EntityView } from '@nebulahome/contracts';

import { can, sampleEntity } from '@/routes/dashboard/samples/sample-entity';

/** The thermostat the boards draw: Living room, heating to 21.5 °C. */
const THERMOSTAT = can('thermostat', {
  supportedModes: ['heat', 'cool', 'auto', 'off'],
  minTemperature: 7,
  maxTemperature: 30,
  temperatureStep: 0.5,
});

/** What a thermostat that does not read the humidity reports while it heats. */
const HEATING_DRY = {
  currentTemperature: 20.5,
  targetTemperature: 21.5,
  mode: 'heat',
  action: 'heating',
};

/** What the thermostat reports while it heats. */
const HEATING = { ...HEATING_DRY, humidity: 48 };

/** The cover art of Midnight City, drawn: the boards' warm-to-violet square. */
const ALBUM_ART = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><radialGradient id="a" cx=".3" cy=".3" r="1"><stop offset="0" stop-color="#ffb35c"/><stop offset=".35" stop-color="#ff5c9d"/><stop offset=".7" stop-color="#5b3fd1"/><stop offset="1" stop-color="#1b1f35"/></radialGradient><rect width="10" height="10" fill="url(#a)"/></svg>',
)}`;

/** One entity per kind of card. */
export const CONTROL_SAMPLES: readonly EntityView[] = [
  sampleEntity('climate.living', {
    name: 'Living room',
    area: 'Thermostat',
    capabilities: [THERMOSTAT],
    state: { thermostat: HEATING },
  }),
  sampleEntity('cover.living_blinds', {
    name: 'Living room blinds',
    area: 'Living room',
    capabilities: [can('cover', { hasPosition: true, hasTilt: true })],
    state: { cover: { position: 60, tilt: 45, motion: 'stopped' } },
  }),
  sampleEntity('lock.front_door', {
    name: 'Front door',
    area: 'Hallway',
    capabilities: [can('lock')],
    state: { lock: { lockState: 'locked' } },
  }),
  sampleEntity('media_player.living_speaker', {
    name: 'Living room speaker',
    area: 'Living room',
    capabilities: [can('media_player', { hasSeek: true })],
    state: {
      media_player: {
        playback: 'playing',
        volume: 55,
        isMuted: false,
        source: 'Spotify',
        mediaTitle: 'Midnight City',
        mediaArtist: 'M83',
        mediaAlbum: 'Hurry Up, We’re Dreaming',
        mediaImagePath: ALBUM_ART,
        mediaDurationSeconds: 243,
        mediaPositionSeconds: 94,
      },
    },
  }),
  sampleEntity('camera.garden', {
    name: 'Garden',
    area: 'Garden',
    capabilities: [can('camera', { hasSnapshot: true, hasStream: true })],
    state: { camera: { isStreamAvailable: true, isRecording: false } },
  }),
];

/** What the lab draws besides. */
export const CONTROL_VARIANTS: readonly EntityView[] = [
  sampleEntity('climate.living_cooling', {
    name: 'Living room',
    area: 'Thermostat',
    capabilities: [THERMOSTAT],
    state: { thermostat: { ...HEATING, mode: 'cool', action: 'cooling' } },
  }),
  sampleEntity('climate.bathroom', {
    name: 'Bathroom',
    area: 'Thermostat',
    capabilities: [THERMOSTAT],
    state: { thermostat: HEATING_DRY },
  }),
  // A target that cannot be set: a range of one value.
  sampleEntity('climate.hallway', {
    name: 'Hallway',
    area: 'Thermostat',
    capabilities: [
      can('thermostat', { supportedModes: ['heat'], minTemperature: 21.5, maxTemperature: 21.5 }),
    ],
    state: { thermostat: HEATING },
  }),
  sampleEntity('climate.living_heat_only', {
    name: 'Living room',
    area: 'Thermostat',
    capabilities: [
      can('thermostat', { supportedModes: ['heat'], minTemperature: 7, maxTemperature: 30 }),
    ],
    state: { thermostat: HEATING },
  }),
  sampleEntity('climate.living_offline', {
    name: 'Living room',
    area: 'Thermostat',
    capabilities: [THERMOSTAT],
    state: { thermostat: HEATING },
    isAvailable: false,
  }),
  sampleEntity('climate.living_view_only', {
    name: 'Living room',
    area: 'Thermostat',
    capabilities: [THERMOSTAT],
    state: { thermostat: HEATING },
    isViewOnly: true,
  }),
  sampleEntity('cover.living_blinds_closing', {
    name: 'Living room blinds',
    area: 'Living room',
    capabilities: [can('cover', { hasPosition: true, hasTilt: true })],
    state: { cover: { position: 60, tilt: 45, motion: 'closing' } },
  }),
  sampleEntity('cover.garage_door', {
    name: 'Garage door',
    area: 'Garage',
    capabilities: [can('cover', { hasPosition: false })],
    state: { cover: { position: 100, motion: 'stopped' } },
  }),
  sampleEntity('cover.study_blinds', {
    name: 'Study blinds',
    area: 'Study',
    capabilities: [can('cover', { hasPosition: true })],
    state: { cover: { position: 60, motion: 'stopped' } },
    isAvailable: false,
  }),
  sampleEntity('lock.front_door_unlocked', {
    name: 'Front door',
    area: 'Hallway',
    capabilities: [can('lock')],
    state: { lock: { lockState: 'unlocked' } },
  }),
  sampleEntity('lock.front_door_jammed', {
    name: 'Front door',
    area: 'Hallway',
    capabilities: [can('lock')],
    state: { lock: { lockState: 'jammed' } },
  }),
  sampleEntity('lock.front_door_view_only', {
    name: 'Front door',
    area: 'Hallway',
    capabilities: [can('lock')],
    state: { lock: { lockState: 'locked' } },
    isViewOnly: true,
  }),
  sampleEntity('media_player.kitchen_radio', {
    name: 'Kitchen radio',
    area: 'Kitchen',
    capabilities: [can('media_player', { canSkip: false })],
    state: {
      media_player: {
        playback: 'playing',
        volume: 55,
        isMuted: false,
        source: 'Radio',
        mediaTitle: 'Radio Paradise',
        mediaArtist: 'Main mix',
      },
    },
  }),
  sampleEntity('media_player.speaker_idle', {
    name: 'Living room speaker',
    area: 'Living room',
    capabilities: [can('media_player', { hasSeek: true })],
    state: {
      media_player: {
        playback: 'idle',
        volume: 55,
        isMuted: false,
        mediaTitle: 'Midnight City',
        mediaArtist: 'M83',
      },
    },
  }),
  sampleEntity('camera.garden_snapshots', {
    name: 'Garden',
    area: 'Garden',
    capabilities: [can('camera', { hasSnapshot: true, hasStream: false })],
    state: { camera: { isStreamAvailable: false, isRecording: false } },
  }),
  sampleEntity('camera.driveway', {
    name: 'Driveway',
    area: 'Driveway',
    capabilities: [can('camera', { hasSnapshot: true, hasStream: true, hasRecording: true })],
    state: { camera: { isStreamAvailable: true, isRecording: true } },
  }),
];

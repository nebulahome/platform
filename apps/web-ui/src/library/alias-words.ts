/**
 * The words of the alias types and parts, in English, with their keys written out so the
 * catalogues can hold them (contracts names them in English only).
 */
import type { AliasRule, AliasSource, AliasTypeGroup, AliasTypeId } from '@nebulahome/contracts';

import { defineMessage, type Message } from '@/i18n/messages';

/** Each type's name. */
export const TYPE_LABELS: Readonly<Record<AliasTypeId, Message>> = {
  sensor: defineMessage('library.aliasTypes.sensor', 'Sensor'),
  text: defineMessage('library.aliasTypes.text', 'Text'),
  binary_sensor: defineMessage('library.aliasTypes.binary_sensor', 'Binary sensor'),
  device_tracker: defineMessage('library.aliasTypes.device_tracker', 'Device tracker'),
  geo_location: defineMessage('library.aliasTypes.geo_location', 'Geo location'),
  switch: defineMessage('library.aliasTypes.switch', 'Switch'),
  light: defineMessage('library.aliasTypes.light', 'Light'),
  fan: defineMessage('library.aliasTypes.fan', 'Fan'),
  cover: defineMessage('library.aliasTypes.cover', 'Cover'),
  lock: defineMessage('library.aliasTypes.lock', 'Lock'),
  button: defineMessage('library.aliasTypes.button', 'Button'),
  select: defineMessage('library.aliasTypes.select', 'Select'),
  number: defineMessage('library.aliasTypes.number', 'Number'),
  thermostat: defineMessage('library.aliasTypes.thermostat', 'Thermostat'),
  media_player: defineMessage('library.aliasTypes.media_player', 'Media player'),
  camera: defineMessage('library.aliasTypes.camera', 'Camera'),
  image: defineMessage('library.aliasTypes.image', 'Image'),
  vacuum: defineMessage('library.aliasTypes.vacuum', 'Vacuum'),
  lawn_mower: defineMessage('library.aliasTypes.lawn_mower', 'Lawn mower'),
  update: defineMessage('library.aliasTypes.update', 'Update'),
  custom: defineMessage('library.aliasTypes.custom', 'Custom'),
};

/** Each type's name for a group of its aliases. */
export const TYPE_PLURALS: Readonly<Record<AliasTypeId, Message>> = {
  sensor: defineMessage('library.aliasTypePlurals.sensor', 'Sensors'),
  text: defineMessage('library.aliasTypePlurals.text', 'Texts'),
  binary_sensor: defineMessage('library.aliasTypePlurals.binary_sensor', 'Binary sensors'),
  device_tracker: defineMessage('library.aliasTypePlurals.device_tracker', 'Device trackers'),
  geo_location: defineMessage('library.aliasTypePlurals.geo_location', 'Geo locations'),
  switch: defineMessage('library.aliasTypePlurals.switch', 'Switches'),
  light: defineMessage('library.aliasTypePlurals.light', 'Lights'),
  fan: defineMessage('library.aliasTypePlurals.fan', 'Fans'),
  cover: defineMessage('library.aliasTypePlurals.cover', 'Covers'),
  lock: defineMessage('library.aliasTypePlurals.lock', 'Locks'),
  button: defineMessage('library.aliasTypePlurals.button', 'Buttons'),
  select: defineMessage('library.aliasTypePlurals.select', 'Selects'),
  number: defineMessage('library.aliasTypePlurals.number', 'Numbers'),
  thermostat: defineMessage('library.aliasTypePlurals.thermostat', 'Thermostats'),
  media_player: defineMessage('library.aliasTypePlurals.media_player', 'Media players'),
  camera: defineMessage('library.aliasTypePlurals.camera', 'Cameras'),
  image: defineMessage('library.aliasTypePlurals.image', 'Images'),
  vacuum: defineMessage('library.aliasTypePlurals.vacuum', 'Vacuums'),
  lawn_mower: defineMessage('library.aliasTypePlurals.lawn_mower', 'Lawn mowers'),
  update: defineMessage('library.aliasTypePlurals.update', 'Updates'),
  custom: defineMessage('library.aliasTypePlurals.custom', 'Custom'),
};

/** Each part's name, by key. */
export const PART_LABELS: Readonly<Record<string, Message>> = {
  value: defineMessage('library.aliasParts.value', 'Value'),
  on: defineMessage('library.aliasParts.on', 'On / off'),
  zone: defineMessage('library.aliasParts.zone', 'Zone'),
  latitude: defineMessage('library.aliasParts.latitude', 'Latitude'),
  longitude: defineMessage('library.aliasParts.longitude', 'Longitude'),
  accuracy: defineMessage('library.aliasParts.accuracy', 'Accuracy'),
  location_name: defineMessage('library.aliasParts.location_name', 'Place name'),
  distance: defineMessage('library.aliasParts.distance', 'Distance'),
  ip_address: defineMessage('library.aliasParts.ip_address', 'IP address'),
  mac_address: defineMessage('library.aliasParts.mac_address', 'MAC address'),
  host_name: defineMessage('library.aliasParts.host_name', 'Host name'),
  brightness: defineMessage('library.aliasParts.brightness', 'Brightness'),
  color_temp: defineMessage('library.aliasParts.color_temp', 'Colour temperature'),
  color: defineMessage('library.aliasParts.color', 'Colour'),
  white: defineMessage('library.aliasParts.white', 'White channel'),
  effect: defineMessage('library.aliasParts.effect', 'Effect'),
  speed: defineMessage('library.aliasParts.speed', 'Speed'),
  preset: defineMessage('library.aliasParts.preset', 'Preset'),
  oscillating: defineMessage('library.aliasParts.oscillating', 'Oscillating'),
  direction: defineMessage('library.aliasParts.direction', 'Direction'),
  position: defineMessage('library.aliasParts.position', 'Position'),
  motion: defineMessage('library.aliasParts.motion', 'Motion'),
  tilt: defineMessage('library.aliasParts.tilt', 'Tilt'),
  lock_state: defineMessage('library.aliasParts.lock_state', 'Lock state'),
  is_open: defineMessage('library.aliasParts.is_open', 'Latch open'),
  press: defineMessage('library.aliasParts.press', 'Press'),
  option: defineMessage('library.aliasParts.option', 'Option'),
  target_temperature: defineMessage('library.aliasParts.target_temperature', 'Target temperature'),
  mode: defineMessage('library.aliasParts.mode', 'Mode'),
  action: defineMessage('library.aliasParts.action', 'Action'),
  current_temperature: defineMessage(
    'library.aliasParts.current_temperature',
    'Current temperature',
  ),
  target_temperature_low: defineMessage('library.aliasParts.target_temperature_low', 'Target low'),
  target_temperature_high: defineMessage(
    'library.aliasParts.target_temperature_high',
    'Target high',
  ),
  humidity: defineMessage('library.aliasParts.humidity', 'Humidity'),
  target_humidity: defineMessage('library.aliasParts.target_humidity', 'Target humidity'),
  fan_mode: defineMessage('library.aliasParts.fan_mode', 'Fan mode'),
  swing_mode: defineMessage('library.aliasParts.swing_mode', 'Swing'),
  swing_horizontal_mode: defineMessage(
    'library.aliasParts.swing_horizontal_mode',
    'Swing side to side',
  ),
  playback: defineMessage('library.aliasParts.playback', 'Playback'),
  volume: defineMessage('library.aliasParts.volume', 'Volume'),
  muted: defineMessage('library.aliasParts.muted', 'Muted'),
  source: defineMessage('library.aliasParts.source', 'Source'),
  sound_mode: defineMessage('library.aliasParts.sound_mode', 'Sound mode'),
  shuffled: defineMessage('library.aliasParts.shuffled', 'Shuffle'),
  repeat: defineMessage('library.aliasParts.repeat', 'Repeat'),
  media_title: defineMessage('library.aliasParts.media_title', 'Title'),
  media_artist: defineMessage('library.aliasParts.media_artist', 'Artist'),
  media_album: defineMessage('library.aliasParts.media_album', 'Album'),
  media_duration: defineMessage('library.aliasParts.media_duration', 'Duration'),
  media_position: defineMessage('library.aliasParts.media_position', 'Position'),
  media_image: defineMessage('library.aliasParts.media_image', 'Artwork'),
  stream_available: defineMessage('library.aliasParts.stream_available', 'Stream available'),
  recording: defineMessage('library.aliasParts.recording', 'Recording'),
  motion_detection: defineMessage('library.aliasParts.motion_detection', 'Motion detection'),
  snapshot: defineMessage('library.aliasParts.snapshot', 'Snapshot'),
  picture: defineMessage('library.aliasParts.picture', 'Picture'),
  activity: defineMessage('library.aliasParts.activity', 'Activity'),
  resumable: defineMessage('library.aliasParts.resumable', 'Resumable'),
  fan_speed: defineMessage('library.aliasParts.fan_speed', 'Suction'),
  clean_mode: defineMessage('library.aliasParts.clean_mode', 'Clean mode'),
  water_level: defineMessage('library.aliasParts.water_level', 'Water level'),
  rooms: defineMessage('library.aliasParts.rooms', 'Rooms'),
  installed_version: defineMessage('library.aliasParts.installed_version', 'Installed version'),
  latest_version: defineMessage('library.aliasParts.latest_version', 'Latest version'),
  installing: defineMessage('library.aliasParts.installing', 'Installing'),
  progress: defineMessage('library.aliasParts.progress', 'Progress'),
  title: defineMessage('library.aliasParts.title', 'Title'),
  release_summary: defineMessage('library.aliasParts.release_summary', 'Release summary'),
  release_url: defineMessage('library.aliasParts.release_url', 'Release notes'),
};

/** The type picker's groups. */
export const GROUP_LABELS: Readonly<Record<AliasTypeGroup, Message>> = {
  readings: defineMessage('library.aliasTypeGroups.readings', 'Readings'),
  controls: defineMessage('library.aliasTypeGroups.controls', 'Controls'),
  climate: defineMessage('library.aliasTypeGroups.climate', 'Climate'),
  media: defineMessage('library.aliasTypeGroups.media', 'Media and more'),
};

/** Parts added and removed together, by the name they share. */
export const PART_GROUP_LABELS: Readonly<Record<string, Message>> = {
  target_range: defineMessage('library.aliasPartGroups.targetRange', 'Target range'),
};

/** Each source's name. */
export const SOURCE_LABELS: Readonly<Record<AliasSource, Message>> = {
  stored: defineMessage('library.aliasSources.stored', 'Stored'),
  entity: defineMessage('library.aliasSources.entity', 'Entity'),
  entities: defineMessage('library.aliasSources.entities', 'Entities'),
  formula: defineMessage('library.aliasSources.formula', 'Formula'),
  code: defineMessage('library.aliasSources.code', 'Code'),
};

/** How several entities make one value. */
export const RULE_LABELS: Readonly<Record<AliasRule, Message>> = {
  any: defineMessage('library.aliasRules.any', 'Any is on'),
  all: defineMessage('library.aliasRules.all', 'All are on'),
  average: defineMessage('library.aliasRules.average', 'Average'),
  min: defineMessage('library.aliasRules.min', 'Lowest'),
  max: defineMessage('library.aliasRules.max', 'Highest'),
  sum: defineMessage('library.aliasRules.sum', 'Sum'),
  first: defineMessage('library.aliasRules.first', 'First available'),
};

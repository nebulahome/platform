/**
 * The platform's own icons by name, in the language the interface speaks.
 *
 * The catalogue (`@nebulahome/icons`) names each built-in icon in English, and the API serves
 * that name; the interface says it here, by id, so the pickers read in the reader's language. An
 * icon somebody drew keeps the name they gave it.
 */
import { defineMessage, text, type Message } from '@/i18n/messages';

/** The built-in icons' names, by id. */
const NAMES: Readonly<Record<string, Message>> = {
  light: defineMessage('icons.names.light', 'Light'),
  lamp: defineMessage('icons.names.lamp', 'Lamp'),
  switch: defineMessage('icons.names.switch', 'Switch'),
  relay: defineMessage('icons.names.relay', 'Relay'),
  plug: defineMessage('icons.names.plug', 'Plug'),
  power: defineMessage('icons.names.power', 'Power'),
  energy: defineMessage('icons.names.energy', 'Energy'),
  printer: defineMessage('icons.names.printer', 'Printer'),
  sensor: defineMessage('icons.names.sensor', 'Sensor'),
  thermometer: defineMessage('icons.names.thermometer', 'Thermometer'),
  thermostat: defineMessage('icons.names.thermostat', 'Thermostat'),
  humidity: defineMessage('icons.names.humidity', 'Humidity'),
  fan: defineMessage('icons.names.fan', 'Fan'),
  heater: defineMessage('icons.names.heater', 'Heater'),
  'air-conditioner': defineMessage('icons.names.airConditioner', 'Air conditioner'),
  camera: defineMessage('icons.names.camera', 'Camera'),
  speaker: defineMessage('icons.names.speaker', 'Speaker'),
  tv: defineMessage('icons.names.tv', 'TV'),
  lock: defineMessage('icons.names.lock', 'Lock'),
  door: defineMessage('icons.names.door', 'Door'),
  window: defineMessage('icons.names.window', 'Window'),
  blind: defineMessage('icons.names.blind', 'Blind'),
  garage: defineMessage('icons.names.garage', 'Garage'),
  router: defineMessage('icons.names.router', 'Router'),
  motion: defineMessage('icons.names.motion', 'Motion'),
  smoke: defineMessage('icons.names.smoke', 'Smoke'),
  water: defineMessage('icons.names.water', 'Water'),
  battery: defineMessage('icons.names.battery', 'Battery'),
  solar: defineMessage('icons.names.solar', 'Solar'),
  car: defineMessage('icons.names.car', 'Car'),
  'washing-machine': defineMessage('icons.names.washingMachine', 'Washing machine'),
  refrigerator: defineMessage('icons.names.refrigerator', 'Refrigerator'),
  oven: defineMessage('icons.names.oven', 'Oven'),
  vacuum: defineMessage('icons.names.vacuum', 'Vacuum'),
  'lawn-mower': defineMessage('icons.names.lawnMower', 'Lawn mower'),
  sprinkler: defineMessage('icons.names.sprinkler', 'Sprinkler'),
  remote: defineMessage('icons.names.remote', 'Remote'),
  device: defineMessage('icons.names.device', 'Device'),
};

/**
 * An icon's name.
 *
 * @param id - The icon.
 * @param stored - The name the catalogue holds, for an icon this build does not name.
 * @returns The name.
 */
export function iconName(id: string, stored: string): string {
  const known = NAMES[id];

  return known === undefined ? stored : text(known);
}

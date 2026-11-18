/**
 * The samples of the switch, the sensors and the text: what reads a value or an on and off.
 *
 * `READING_SAMPLES` holds one entity per kind of card, the one the Add card catalogue draws (the
 * first of each kind); `READING_VARIANTS` the ones the lab draws besides: the other cases the
 * board `K-All` draws for these kinds, and what `K-Capabilities` and `K-States` draw for them.
 */
import type { EntityView } from '@nebulahome/contracts';

import { can, sampleEntity } from '@/routes/dashboard/samples/sample-entity';

/** One entity per kind of card. */
export const READING_SAMPLES: readonly EntityView[] = [
  sampleEntity('switch.coffee', {
    name: 'Coffee machine',
    area: 'Kitchen',
    capabilities: [can('on_off')],
    state: { on_off: { isOn: true } },
  }),
  sampleEntity('sensor.living_temperature', {
    name: 'Living room',
    area: 'Temperature',
    capabilities: [can('sensor_numeric')],
    state: { sensor_numeric: { value: 21.4 } },
    unit: '°C',
    deviceClass: 'temperature',
  }),
  sampleEntity('binary_sensor.front_door', {
    name: 'Front door',
    area: 'Hallway',
    capabilities: [can('sensor_binary')],
    state: { sensor_binary: { isOn: false } },
    deviceClass: 'door',
  }),
  sampleEntity('sensor.washer', {
    name: 'Washer',
    area: 'Laundry',
    capabilities: [can('sensor_text')],
    state: { sensor_text: { value: 'Rinse · 18 min left' } },
  }),
];

/** What the lab draws besides. */
export const READING_VARIANTS: readonly EntityView[] = [
  // K-All: the switch off, the battery low, the solar power, the humidity, the back door open.
  sampleEntity('switch.coffee_off', {
    name: 'Coffee machine',
    area: 'Kitchen',
    capabilities: [can('on_off')],
    state: { on_off: { isOn: false } },
  }),
  sampleEntity('sensor.front_door_lock_battery', {
    name: 'Front door lock',
    area: 'Battery',
    capabilities: [can('sensor_numeric')],
    state: { sensor_numeric: { value: 18 } },
    unit: '%',
    deviceClass: 'battery',
  }),
  sampleEntity('sensor.solar_power', {
    name: 'Solar inverter',
    area: 'Power',
    capabilities: [can('sensor_numeric')],
    state: { sensor_numeric: { value: 3.42 } },
    unit: 'kW',
    deviceClass: 'power',
  }),
  sampleEntity('sensor.bathroom_humidity', {
    name: 'Bathroom',
    area: 'Humidity',
    capabilities: [can('sensor_numeric')],
    state: { sensor_numeric: { value: 62 } },
    unit: '%',
    deviceClass: 'humidity',
  }),
  sampleEntity('binary_sensor.back_door', {
    name: 'Back door',
    area: 'Kitchen',
    capabilities: [can('sensor_binary')],
    state: { sensor_binary: { isOn: true } },
    deviceClass: 'door',
  }),

  // K-States: out of reach, before the first reading, for someone who may only look.
  sampleEntity('sensor.study_temperature', {
    name: 'Study',
    area: 'Temperature',
    capabilities: [can('sensor_numeric')],
    state: { sensor_numeric: { value: 20.1 } },
    unit: '°C',
    deviceClass: 'temperature',
    isAvailable: false,
  }),
  sampleEntity('sensor.greenhouse_temperature', {
    name: 'Greenhouse',
    area: 'Temperature',
    capabilities: [can('sensor_numeric')],
    state: {},
    unit: '°C',
    deviceClass: 'temperature',
  }),
  sampleEntity('binary_sensor.cellar_door', {
    name: 'Cellar door',
    area: 'Basement',
    capabilities: [can('sensor_binary')],
    state: {},
    deviceClass: 'door',
  }),
  sampleEntity('switch.towel_rail', {
    name: 'Towel rail',
    area: 'Bathroom',
    capabilities: [can('on_off')],
    state: { on_off: { isOn: true } },
    isViewOnly: true,
  }),
];

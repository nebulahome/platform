/**
 * The lights the cards are drawn with: the boards' Island lights, and the lights that can do less
 * (`K-Capabilities`) for the lab.
 */
import type { EntityView } from '@nebulahome/contracts';

import { can, sampleEntity } from '@/routes/dashboard/samples/sample-entity';

/** A lamp that dims, takes a white and a colour: the boards' Island lights. */
export const LIGHT = sampleEntity('light.island', {
  name: 'Island lights',
  area: 'Kitchen',
  capabilities: [
    can('on_off'),
    can('level'),
    can('color_temp', { minMireds: 153, maxMireds: 500 }),
    can('color_hs'),
  ],
  state: {
    on_off: { isOn: true },
    level: { level: 72 },
    color_temp: { mireds: 370, isActive: true },
    color_hs: { hue: 32, saturation: 0 },
  },
});

/** The lights the lab draws besides the catalogue's: one that only dims, one that only switches. */
export const LIGHT_VARIANTS: readonly EntityView[] = [
  sampleEntity('light.reading_lamp', {
    name: 'Reading lamp',
    area: 'Bedroom',
    capabilities: [can('on_off'), can('level')],
    state: { on_off: { isOn: true }, level: { level: 72 } },
  }),
  sampleEntity('light.porch', {
    name: 'Porch light',
    area: 'Outside',
    capabilities: [can('on_off')],
    state: { on_off: { isOn: true } },
  }),
  sampleEntity('light.desk_strip', {
    name: 'Desk strip',
    area: 'Office',
    capabilities: [can('on_off'), can('level'), can('color_hs')],
    state: { on_off: { isOn: true }, level: { level: 45 }, color_hs: { hue: 235, saturation: 51 } },
  }),
  sampleEntity('light.study', {
    name: 'Study lamp',
    area: 'Study',
    capabilities: [can('on_off'), can('level')],
    state: { on_off: { isOn: true }, level: { level: 72 } },
    isAvailable: false,
  }),
];

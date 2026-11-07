/**
 * Every capability's control, in the order a person reaches for them: power first, because it is
 * what is done most; then what shapes the light - its brightness, its white, its colour - then
 * everything else a device can be told.
 *
 * A dashboard's control card draws the one it is about; the entity dialog draws these for a
 * capability that has no body of its own there (`sheet/kinds.tsx`), so nothing is ever blank.
 */
import type { ReactNode } from 'react';

import type { CapabilityName } from '@nebulahome/contracts';

import { ButtonControl } from '@/routes/library/entity/controls/button-control';
import { CameraControl } from '@/routes/library/entity/controls/camera-control';
import { ColorControl } from '@/routes/library/entity/controls/color-control';
import { ColorTempControl } from '@/routes/library/entity/controls/color-temp-control';
import type { ControlProps } from '@/routes/library/entity/controls/control-block';
import { CoverControl } from '@/routes/library/entity/controls/cover-control';
import { CustomControl } from '@/routes/library/entity/controls/custom-control';
import { ImageControl } from '@/routes/library/entity/controls/image-control';
import { LawnMowerControl } from '@/routes/library/entity/controls/lawn-mower-control';
import { LevelControl } from '@/routes/library/entity/controls/level-control';
import { LockControl } from '@/routes/library/entity/controls/lock-control';
import { MediaControl } from '@/routes/library/entity/controls/media-control';
import { NumberControl } from '@/routes/library/entity/controls/number-control';
import { PowerControl } from '@/routes/library/entity/controls/power-control';
import { SelectControl } from '@/routes/library/entity/controls/select-control';
import { ThermostatControl } from '@/routes/library/entity/controls/thermostat-control';
import { UpdateControl } from '@/routes/library/entity/controls/update-control';
import { VacuumControl } from '@/routes/library/entity/controls/vacuum-control';

/** The controls, in the order they are drawn: a dashboard card draws the one it is about. */
export const ENTITY_CONTROLS: readonly (readonly [
  CapabilityName,
  (props: ControlProps) => ReactNode,
])[] = [
  ['image', ImageControl],
  ['lawn_mower', LawnMowerControl],
  ['vacuum', VacuumControl],
  ['on_off', PowerControl],
  ['level', LevelControl],
  ['color_temp', ColorTempControl],
  ['color_hs', ColorControl],
  ['cover', CoverControl],
  ['lock', LockControl],
  ['thermostat', ThermostatControl],
  ['media_player', MediaControl],
  ['camera', CameraControl],
  ['select', SelectControl],
  ['number', NumberControl],
  ['button', ButtonControl],
  ['update', UpdateControl],
  ['custom', CustomControl],
];

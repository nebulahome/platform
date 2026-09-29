/**
 * An entity's Control panel: one block per capability it declares, in the order a person reaches
 * for them.
 *
 * Power first, because it is what is done most; then what shapes the light - its brightness, its
 * white, its colour - then everything else a device can be told; then, for a sensor, the reading
 * itself. Only what the entity declares is drawn.
 *
 * When nothing can be sent, the controls stay on screen but cannot be used, and the panel says
 * why in one line underneath: an unreachable device, a person who may look but not act, or an
 * entity that is not a device at all. A control that silently did nothing would be worse than
 * none; one that vanished would leave the reader wondering whether the page had loaded.
 */
import type { ReactNode } from 'react';

import type { CapabilityName, EntityView } from '@nebula-home/contracts';
import { Panel, PanelNote } from '@nebula-home/ui';

import { hasCapability, isCommandable } from '@/library/entity-control';
import type { Reading } from '@/library/entity-reading';
import { ButtonControl } from '@/routes/library/entity/controls/button-control';
import { CameraControl } from '@/routes/library/entity/controls/camera-control';
import { ColorControl } from '@/routes/library/entity/controls/color-control';
import { ColorTempControl } from '@/routes/library/entity/controls/color-temp-control';
import type { ControlProps, LightColour } from '@/routes/library/entity/controls/control-block';
import { CoverControl } from '@/routes/library/entity/controls/cover-control';
import { CustomControl } from '@/routes/library/entity/controls/custom-control';
import { ImageControl } from '@/routes/library/entity/controls/image-control';
import { LawnMowerControl } from '@/routes/library/entity/controls/lawn-mower-control';
import { LevelControl } from '@/routes/library/entity/controls/level-control';
import { LockControl } from '@/routes/library/entity/controls/lock-control';
import { MediaControl } from '@/routes/library/entity/controls/media-control';
import { NumberControl } from '@/routes/library/entity/controls/number-control';
import { PowerControl } from '@/routes/library/entity/controls/power-control';
import { ReadingControl } from '@/routes/library/entity/controls/reading-control';
import { SelectControl } from '@/routes/library/entity/controls/select-control';
import { ThermostatControl } from '@/routes/library/entity/controls/thermostat-control';
import { UpdateControl } from '@/routes/library/entity/controls/update-control';
import { VacuumControl } from '@/routes/library/entity/controls/vacuum-control';
import { useEntityCommand } from '@/routes/library/entity/use-entity-command';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** The controls, in the order they are drawn. */
const CONTROLS: readonly (readonly [CapabilityName, (props: ControlProps) => ReactNode])[] = [
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

/** What the panel needs. */
export type ControlPanelProps = Omit<ControlProps, 'commander' | 'disabled'> & {
  /** Its reading, in words, for a sensor's block. */
  readonly reading: Reading;

  /** Whether this person may command it and it can be commanded at all. */
  readonly canControl: boolean;
};

/**
 * Says why nothing can be sent, when nothing can.
 *
 * @param entity - The entity.
 * @param reading - Whether it can be reached.
 * @param canControl - Whether this person may command it.
 * @returns One sentence, or null when the controls work.
 */
function whyNot(entity: EntityView, reading: Reading, canControl: boolean): string | null {
  if (entity.source === 'derived') {
    return 'An alias is worked out from other entities; change those instead.';
  }

  if (entity.source === 'system') {
    return 'This reading comes from the machine the platform runs on and takes no commands.';
  }

  if (!entity.isEnabled) {
    return 'This entity is disabled, so it takes no commands.';
  }

  if (!isCommandable(entity)) {
    return null;
  }

  if (!reading.isAvailable) {
    return 'The device cannot be reached right now. The controls come back when it answers.';
  }

  return canControl ? null : 'You can see this entity, but your role does not let you control it.';
}

/**
 * Renders the panel.
 *
 * @param props - See {@link ControlPanelProps}.
 * @returns The panel.
 */
export function ControlPanel(props: ControlPanelProps) {
  const { entity, state, reportedAt, reading, canControl } = props;
  const commander = useEntityCommand(entity.entityId);
  const colour = usePendingValue<LightColour>(
    state.color_hs ?? { hue: 0, saturation: 0 },
    reportedAt,
  );
  const note = whyNot(entity, reading, canControl);
  const controlProps: ControlProps = {
    entity,
    state,
    reportedAt,
    commander,
    disabled: note !== null || !canControl,
    colour,
  };

  return (
    <Panel title="Control">
      {CONTROLS.filter(([capability]) => hasCapability(entity, capability)).map((entry) => {
        const [capability, Control] = entry;

        return <Control key={capability} {...controlProps} />;
      })}
      <ReadingControl entity={entity} state={state} reading={reading} />
      {commander.problem === null ? null : (
        <div className="flex items-start justify-between gap-3 border-t border-border-soft px-4 py-3">
          <p role="alert" className="text-ui text-danger">
            {commander.problem}
          </p>
          <button
            type="button"
            className="shrink-0 text-caption text-foreground-subtle underline-offset-2 hover:text-foreground hover:underline"
            onClick={commander.dismissProblem}
          >
            Dismiss
          </button>
        </div>
      )}
      {note === null ? null : <PanelNote>{note}</PanelNote>}
    </Panel>
  );
}

/**
 * What a sensor reads, large: the figure and its unit, a binary sensor's word, a text.
 *
 * A sensor takes no command, so its block is the reading itself, drawn at the size a person
 * reads a thermometer from across a room. The class says what it measures and the state class
 * how it is measured over time - a meter that only counts up, a level that goes both ways.
 */
import type { CapabilityState, EntityView } from '@nebula-home/contracts';
import { getSensorClass } from '@nebula-home/contracts';

import type { Reading } from '@/library/entity-reading';
import { describeState } from '@/library/entity-reading';
import { ControlBlock } from '@/routes/library/entity/controls/control-block';

/** What the reading needs. */
export type ReadingControlProps = {
  readonly entity: EntityView;
  readonly state: CapabilityState;
  readonly reading: Reading;
};

/**
 * Renders the reading.
 *
 * @param props - See {@link ReadingControlProps}.
 * @returns The block, or nothing for an entity with no reading capability.
 */
export function ReadingControl(props: ReadingControlProps) {
  const { entity, state, reading } = props;
  const figure = reading.sensorFigure;
  const measures = getSensorClass(entity.deviceClass)?.label;

  if (
    state.sensor_numeric !== undefined ||
    entity.capabilities.some((entry) => entry.capability === 'sensor_numeric')
  ) {
    return (
      <ControlBlock title={measures ?? 'Reading'}>
        <p className="flex items-baseline gap-2">
          <span className="font-mono text-reading-lg text-foreground tabular">
            {figure?.figure ?? (state.sensor_numeric === undefined ? '—' : reading.text)}
          </span>
          {figure?.unit === undefined || figure.unit === null ? null : (
            <span className="text-head text-foreground-subtle">{figure.unit}</span>
          )}
        </p>
      </ControlBlock>
    );
  }

  if (
    state.sensor_binary !== undefined ||
    entity.capabilities.some((entry) => entry.capability === 'sensor_binary')
  ) {
    return (
      <ControlBlock title="State">
        <p className="text-reading text-foreground">
          {state.sensor_binary === undefined
            ? '—'
            : describeState({ sensor_binary: state.sensor_binary }, entity)}
        </p>
      </ControlBlock>
    );
  }

  if (state.sensor_text !== undefined) {
    return (
      <ControlBlock title="Text">
        <p className="rounded-field border border-border face-sunk px-3.5 py-3 text-title break-words text-foreground">
          {state.sensor_text.value}
        </p>
      </ControlBlock>
    );
  }

  return null;
}

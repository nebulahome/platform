/**
 * A card for what is told rather than switched: a robot vacuum or mower, a choice from a list, a
 * number, a button, a firmware update, a picture.
 *
 * Each is drawn by the same control its entity page draws - the robot's Start, Pause and Dock,
 * the list's choices, the update's Install - so a card and a page never disagree about what can
 * be done, under the card's heading.
 */
import type { CapabilityName } from '@nebulahome/contracts';
import { CardHeading } from '@nebulahome/ui';

import { hasCapability } from '@/library/entity-control';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import type { EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import type { LightColour } from '@/routes/library/entity/controls/control-block';
import { ENTITY_CONTROLS } from '@/routes/library/entity/controls/control-panel';
import { useEntityCommand } from '@/routes/library/entity/use-entity-command';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** What a control card is about, the first the entity declares. */
const ABOUT: readonly CapabilityName[] = [
  'vacuum',
  'lawn_mower',
  'image',
  'select',
  'number',
  'button',
  'update',
];

/**
 * Renders a control card.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function ControlCard(props: { readonly model: EntityCardModel }) {
  const { model } = props;
  const { entity, state, title, subtitle, reportedAt } = model;
  const commander = useEntityCommand(entity.entityId);
  const colour = usePendingValue<LightColour>(
    state.color_hs ?? { hue: 0, saturation: 0 },
    reportedAt,
  );
  const capability = ABOUT.find((each) => hasCapability(entity, each));
  const Control = ENTITY_CONTROLS.find(([each]) => each === capability)?.[1];

  return (
    <CardFrame label={title}>
      <CardHeading title={title} subtitle={subtitle} />
      <div className="-mx-4 mt-1 min-h-0 grow overflow-y-auto">
        {Control === undefined ? null : (
          <Control
            entity={entity}
            state={state}
            reportedAt={reportedAt}
            commander={commander}
            disabled={!model.canControl}
            colour={colour}
          />
        )}
      </div>
      {commander.problem === null ? null : (
        <p role="alert" className="truncate text-caption text-danger" title={commander.problem}>
          {commander.problem}
        </p>
      )}
    </CardFrame>
  );
}

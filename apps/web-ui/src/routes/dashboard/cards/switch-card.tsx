/**
 * Something that only switches: a relay, a plug, a fan.
 *
 * The tile is the switch and its name; the tall card says whether it is on in a word large enough
 * to read across the room, and since when.
 */
import { CardFrame, CardHeading, Figure, TileRow } from '@/routes/dashboard/cards/card-parts';
import { cardTime, sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { QuickPowerSwitch } from '@/routes/library/entity/quick-power-switch';

/**
 * Renders a switch card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function SwitchCard(props: { readonly model: EntityCardModel }) {
  const { model } = props;
  const { entity, state, title, subtitle, reading, reportedAt } = model;
  const isOn = state.on_off?.isOn ?? false;
  const power = (
    <QuickPowerSwitch
      entityId={entity.entityId}
      name={title}
      isOn={isOn}
      reportedAt={reportedAt}
      disabled={!model.canControl}
    />
  );

  if (sizeKey(model.size) === '1x1') {
    return (
      <CardFrame label={title}>
        <TileRow
          icon={model.icon}
          kind={model.kind}
          isActive={isOn}
          isAvailable={reading.isAvailable}
          title={title}
          subtitle={subtitle}
          tail={power}
        />
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title}>
      <CardHeading title={title} subtitle={subtitle} tail={power} />
      <div className="grow" />
      <div className="flex flex-col gap-1.5">
        <Figure value={isOn ? 'On' : 'Off'} size="medium" />
        {model.changedAt === null ? null : (
          <span className="text-caption text-foreground-muted">
            {isOn ? 'On' : 'Off'} since {cardTime(model.changedAt)}
          </span>
        )}
      </div>
    </CardFrame>
  );
}

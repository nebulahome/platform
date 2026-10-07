/**
 * A blind, a shutter, a garage door: drawn, not described.
 *
 * The tall card draws the window with the blind let down as far as it is closed, then says how
 * open it is and offers the three movements - open, stop, close - because stopping half-way is
 * what people do most after starting one. The tile keeps the movements and the figure.
 */
import { AppIcon, IconButton, CardHeading } from '@nebulahome/ui';

import { CardFrame, TileRow } from '@/routes/dashboard/cards/card-parts';
import { sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { useEntityCommand } from '@/routes/library/entity/use-entity-command';

/** The three movements, with their glyphs. */
const MOVES = [
  { command: 'open', label: 'Open', icon: 'arrow-up-to-line' },
  { command: 'stop', label: 'Stop', icon: 'square' },
  { command: 'close', label: 'Close', icon: 'arrow-down-to-line' },
] as const;

/** How many slats the drawn blind has at its fullest. */
const SLATS = 5;

/**
 * Says where a cover is, in words.
 *
 * @param position - 0 closed, 100 open.
 * @param motion - Whether it is moving, and which way.
 * @returns "Closed", "40% open", "Opening".
 */
function whereItIs(position: number, motion: string): string {
  if (motion === 'opening') {
    return 'Opening';
  }

  if (motion === 'closing') {
    return 'Closing';
  }

  if (position <= 0) {
    return 'Closed';
  }

  return position >= 100 ? 'Open' : `${String(Math.round(position))}% open`;
}

/**
 * Renders a cover card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function CoverCard(props: { readonly model: EntityCardModel }) {
  const { model } = props;
  const { entity, state, title, subtitle, reading } = model;
  const commander = useEntityCommand(entity.entityId);
  const cover = state.cover ?? { position: 0, motion: 'stopped' as const };
  const words = whereItIs(cover.position, cover.motion);
  const disabled = !model.canControl || commander.busy.has('cover');
  const moves = (
    <div className="flex gap-1.5">
      {MOVES.map((move) => (
        <IconButton
          key={move.command}
          variant="raised"
          size="small"
          label={`${move.label} ${title}`}
          className="grow"
          disabled={disabled}
          onClick={() => {
            commander.send('cover', { command: move.command });
          }}
        >
          <AppIcon id={move.icon} size={14} />
        </IconButton>
      ))}
    </div>
  );

  if (sizeKey(model.size) === '1x1') {
    return (
      <CardFrame label={title}>
        <div className="flex h-full flex-col justify-between">
          <TileRow
            icon={model.icon}
            kind={model.kind}
            isActive={cover.position > 0}
            isAvailable={reading.isAvailable}
            title={title}
            subtitle={words}
          />
          {moves}
        </div>
      </CardFrame>
    );
  }

  // The blind covers the window as far as it is closed; a closed one shows every slat.
  const slats = Math.round((SLATS * (100 - cover.position)) / 100);

  return (
    <CardFrame label={title}>
      <CardHeading title={title} subtitle={subtitle} />
      <div
        aria-hidden="true"
        className="mt-3 flex h-18 flex-col justify-start gap-1 rounded-field border border-border bg-gradient-to-b from-tag-blue/25 to-surface-raised p-1.5"
      >
        {[...Array.from({ length: slats }).keys()].map((slat) => (
          <div key={slat} className="h-2 rounded-[2px] bg-foreground-subtle/60 shadow-sm" />
        ))}
      </div>
      <span className="mt-3 text-headline leading-none font-medium tabular">{words}</span>
      <div className="grow" />
      {moves}
    </CardFrame>
  );
}

/**
 * A card drawn as a preview: the real card - the same component the dashboard draws - with a
 * sample of what it shows, in a box of the pixels it has on the grid, scaled down to fit where it
 * is shown. Never a picture, so a preview cannot drift from the card it stands for.
 *
 * A preview is only looked at: it is `inert` and lets no pointer through, so it never sends a
 * command, and its past and pictures come from the samples, never from the hub.
 */
import type { DashboardCard } from '@nebulahome/contracts';

import type { CardSize } from '@/dashboard/card-sizes';
import { GAP_PX, ROW_PX } from '@/dashboard/geometry';
import { SAMPLE_SOURCE } from '@/routes/dashboard/card-samples';
import { CardView } from '@/routes/dashboard/card-view';
import { CardSampleContext } from '@/routes/dashboard/cards/card-sample';
import { DashboardGrid } from '@/routes/dashboard/dashboard-grid';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** How wide a column is where the cards were designed: the width a preview is drawn at. */
export const DESIGN_COLUMN_PX = 267;

/**
 * The pixels a card of a size has on the grid it was designed on.
 *
 * @param size - The size, in cells.
 * @returns Its width and height in pixels.
 */
export function designBox(size: CardSize): { readonly width: number; readonly height: number } {
  return {
    width: size.w * DESIGN_COLUMN_PX + (size.w - 1) * GAP_PX,
    height: size.h * ROW_PX + (size.h - 1) * GAP_PX,
  };
}

/** What a preview needs. */
export type CardPreviewProps = {
  /** The card, pointing at sample entities. */
  readonly card: DashboardCard;

  /** The samples, as the cards read them. */
  readonly data: DashboardData;

  /** The box it must fit in: it is made smaller to fit, never larger. */
  readonly fit: { readonly width: number; readonly height: number };
};

/**
 * Renders a card as a preview.
 *
 * @param props - See {@link CardPreviewProps}.
 * @returns The preview.
 */
export function CardPreview(props: CardPreviewProps) {
  const { card, data, fit } = props;
  const box = designBox(card);
  const scale = Math.min(fit.width / box.width, fit.height / box.height, 1);

  return (
    <div
      aria-hidden="true"
      className="shrink-0"
      /* eslint-disable-next-line react/forbid-dom-props -- the preview takes the room its card does,
      scaled to the box it is shown in. */
      style={{ width: box.width * scale, height: box.height * scale }}
    >
      <div
        inert
        className="pointer-events-none origin-top-left select-none"
        /* eslint-disable-next-line react/forbid-dom-props -- the card at its own pixels, scaled. */
        style={{ width: box.width, height: box.height, transform: `scale(${String(scale)})` }}
      >
        <CardSampleContext value={SAMPLE_SOURCE}>
          {card.type === 'container' ? (
            <DashboardGrid
              layout={{ cards: [{ ...card, x: 0, y: 0 }] }}
              data={data}
              editor={null}
            />
          ) : (
            <CardView card={card} data={data} />
          )}
        </CardSampleContext>
      </div>
    </div>
  );
}

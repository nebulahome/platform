/**
 * A card a package draws, while the package is not there to draw it.
 *
 * The layout keeps a package's card whether or not the package is installed: removing a package
 * - or a restore onto an installation without it - leaves a card that says whose it is and that it
 * cannot be drawn, rather than a hole in the grid or a layout that no longer loads. The package's
 * own drawing takes its place once the package runs.
 */
import type { DashboardPackageCard } from '@nebula-home/contracts';
import { AppIcon } from '@nebula-home/ui';

import { CardFrame } from '@/routes/dashboard/cards/card-parts';

/** What a package's card needs. */
export type PackageCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardPackageCard;
};

/**
 * Renders a package's card that cannot be drawn.
 *
 * @param props - See {@link PackageCardProps}.
 * @returns The card.
 */
export function PackageCard(props: PackageCardProps) {
  const { card } = props;
  const title = card.title ?? `${card.packageId} · ${card.cardId}`;

  return (
    <CardFrame label={title} tone="faint">
      <div className="flex h-full min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-tile border border-border bg-surface-raised text-foreground-subtle"
        >
          <AppIcon id="package" size={18} />
        </span>
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="truncate text-title font-medium tracking-tight">{title}</span>
          <span className="truncate text-caption text-foreground-subtle">
            A card of the {card.packageId} package, which is not running.
          </span>
        </span>
      </div>
    </CardFrame>
  );
}

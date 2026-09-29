/**
 * A card a package draws.
 *
 * The interface draws the frame - the same border, radius and padding as every other card - and
 * the package draws what is inside, with the design system the rest of the dashboard draws with.
 * So a package's card reads as a card of the dashboard, and a package cannot make one that looks
 * like nothing else on it.
 *
 * The layout keeps a package's card whether or not the package is there to draw it: removing a
 * package, stopping it, or restoring onto an installation without it leaves a card that says
 * whose it is and why it cannot be drawn, rather than a hole in the grid or a layout that no
 * longer loads. The package's own drawing takes its place once it runs again.
 */
import type {
  ApiPackage,
  DashboardPackageCard,
  PackageCardSize,
  PackageState,
} from '@nebula-home/contracts';
import { AppIcon } from '@nebula-home/ui';

import { PackageSlot } from '@/packages/package-slot';
import { useInstalledPackages } from '@/packages/use-packages';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';

/** What a package's card needs. */
export type PackageCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardPackageCard;
};

/** What each state that is not running says about the card. */
const NOT_RUNNING: Readonly<Record<Exclude<PackageState, 'running'>, string>> = {
  installed: 'has not started yet',
  starting: 'is starting',
  stopped: 'is stopped',
  failed: 'has failed',
  disabled: 'is switched off',
  'waiting-dependency': 'is waiting for a package it needs',
};

/**
 * The size a package's card is drawn at, by the cells it covers.
 *
 * @param card - The card.
 * @returns The manifest's word for it.
 */
export function packageCardSizeOf(card: Pick<DashboardPackageCard, 'w' | 'h'>): PackageCardSize {
  if (card.w === 1 && card.h === 1) {
    return 'small';
  }

  if (card.h === 1) {
    return 'wide';
  }

  return card.h >= 3 ? 'large' : 'medium';
}

/**
 * What the card says in place of the package's drawing.
 *
 * @param props - Its title and why.
 * @param props.title - What the card is called.
 * @param props.note - Why it is not drawn.
 * @returns The card.
 */
function Placeholder(props: { readonly title: string; readonly note: string }) {
  const { title, note } = props;

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
          <span className="line-clamp-2 text-caption text-foreground-subtle">{note}</span>
        </span>
      </div>
    </CardFrame>
  );
}

/**
 * Why a package's card cannot be drawn now, if it cannot.
 *
 * @param found - The package, if it is installed.
 * @param card - The card.
 * @returns A sentence, or null when it can be drawn.
 */
function whyNotDrawn(found: ApiPackage | undefined, card: DashboardPackageCard): string | null {
  if (found === undefined) {
    return `A card of the ${card.packageId} package, which is not installed.`;
  }

  if (found.state !== 'running') {
    return `${found.name} ${NOT_RUNNING[found.state]}.`;
  }

  if (found.ui?.cards.some((declared) => declared.id === card.cardId) !== true) {
    return `${found.name} ${found.version} no longer has this card.`;
  }

  return null;
}

/**
 * Renders a package's card.
 *
 * @param props - See {@link PackageCardProps}.
 * @returns The card.
 */
export function PackageCard(props: PackageCardProps) {
  const { card } = props;
  const { packages, canRead, isPending } = useInstalledPackages();
  const found = packages.find((each) => each.id === card.packageId);
  const declared = found?.ui?.cards.find((each) => each.id === card.cardId);
  const title = card.title ?? declared?.name ?? `${card.packageId} · ${card.cardId}`;

  if (!canRead) {
    return <Placeholder title={title} note="A package's card, which your role does not show." />;
  }

  if (isPending) {
    return <Placeholder title={title} note="Loading…" />;
  }

  const why = whyNotDrawn(found, card);

  if (why !== null || found === undefined) {
    return <Placeholder title={title} note={why ?? ''} />;
  }

  return (
    <CardFrame label={title}>
      <PackageSlot
        found={found}
        target={{
          kind: 'card',
          props: {
            packageId: card.packageId,
            cardId: card.cardId,
            options: card.options,
            size: packageCardSizeOf(card),
            title: card.title,
          },
        }}
        loading={<span className="sr-only">Loading {title}…</span>}
        renderProblem={(message) => (
          <p role="alert" className="line-clamp-4 text-caption text-danger">
            {found.name} could not draw this card: {message}
          </p>
        )}
      />
    </CardFrame>
  );
}

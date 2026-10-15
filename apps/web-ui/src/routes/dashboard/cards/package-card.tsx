/**
 * A card a package draws.
 *
 * The interface draws the frame - the same cell, border, radius and background as every other
 * card, and its padding unless the card asks for none - and the package draws what is inside: any
 * React, any CSS, scoped to its own elements (PACKAGES_DOCS.md 6.2). The card is given its declared
 * name, its title, its size, its options with their defaults, and whether the dashboard is being
 * edited.
 *
 * The layout keeps a package's card whether or not the package is there to draw it: removing a
 * package, stopping it, or restoring onto an installation without it leaves a card that says
 * whose it is and why it cannot be drawn, rather than a hole in the grid or a layout that no
 * longer loads. The package's own drawing takes its place once it runs again.
 */
import { useTranslation } from 'react-i18next';

import type {
  ApiPackage,
  DashboardPackageCard,
  JsonObject,
  JsonValue,
  PackageCard as DeclaredCard,
  PackageCardSize,
  PackageState,
} from '@nebulahome/contracts';
import type { CardProps } from '@nebulahome/package-sdk/ui';
import { AppIcon } from '@nebulahome/ui';

import { defineMessage, type Message, text, translate } from '@/i18n/messages';
import { PackageSlot } from '@/packages/package-slot';
import { useInstalledPackages } from '@/packages/use-packages';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';

/** What a package's card needs. */
export type PackageCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardPackageCard;

  /** Whether the dashboard is being edited: the card is drawn, never used. */
  readonly isEditing?: boolean;
};

/** What each state that is not running says about the card. */
const NOT_RUNNING: Readonly<Record<Exclude<PackageState, 'running'>, Message>> = {
  installed: defineMessage(
    'dashboard.cards.packageCard.hasNotStartedYet',
    '{{name}} has not started yet.',
  ),
  starting: defineMessage('dashboard.cards.packageCard.isStarting', '{{name}} is starting.'),
  stopped: defineMessage('dashboard.cards.packageCard.isStopped', '{{name}} is stopped.'),
  failed: defineMessage('dashboard.cards.packageCard.hasFailed', '{{name}} has failed.'),
  disabled: defineMessage('dashboard.cards.packageCard.isSwitchedOff', '{{name}} is switched off.'),
  'waiting-dependency': defineMessage(
    'dashboard.cards.packageCard.isWaitingForA',
    '{{name}} is waiting for a package it needs.',
  ),
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
 * A card's options as its inspector left them, each one not set given its declared default.
 *
 * @param declared - The card, as the package declares it.
 * @param options - What the layout stores.
 * @returns The options.
 */
export function packageCardOptionsOf(declared: DeclaredCard, options: JsonObject): JsonObject {
  const filled: Record<string, JsonValue> = { ...options };

  for (const field of declared.options) {
    if (filled[field.key] === undefined && 'default' in field && field.default !== undefined) {
      filled[field.key] = field.default;
    }
  }

  return filled;
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
    return translate(
      'dashboard.cards.packageCard.cardOfThePackageid',
      'A card of the {{packageId}} package, which is not installed.',
      { packageId: card.packageId },
    );
  }

  if (found.state !== 'running') {
    return text(NOT_RUNNING[found.state], { name: found.name });
  }

  if (found.ui?.cards.some((declared) => declared.id === card.cardId) !== true) {
    return translate(
      'dashboard.cards.packageCard.nameVersionNoLonger',
      '{{name}} {{version}} no longer has this card.',
      { name: found.name, version: found.version },
    );
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
  const { t } = useTranslation();

  const { card, isEditing = false } = props;
  const { packages, canRead, isPending } = useInstalledPackages();
  const found = packages.find((each) => each.id === card.packageId);
  const declared = found?.ui?.cards.find((each) => each.id === card.cardId);
  const title = card.title ?? declared?.name ?? `${card.packageId} · ${card.cardId}`;

  if (!canRead) {
    return (
      <Placeholder
        title={title}
        note={t(
          'dashboard.cards.packageCard.packageSCardWhich',
          "A package's card, which your role does not show.",
        )}
      />
    );
  }

  if (isPending) {
    return <Placeholder title={title} note={t('common.loading', 'Loading…')} />;
  }

  const why = whyNotDrawn(found, card);

  if (why !== null || found === undefined || declared === undefined) {
    return <Placeholder title={title} note={why ?? ''} />;
  }

  return (
    <CardFrame label={title} {...(declared.padding === 'none' ? { className: 'p-0' } : {})}>
      <PackageSlot
        found={found}
        className="h-full"
        target={{
          kind: 'card',
          props: {
            packageId: card.packageId,
            cardId: card.cardId,
            name: declared.name,
            title: card.title,
            size: packageCardSizeOf(card),
            // The options are the card's own fields, which its inspector holds to their types.
            options: packageCardOptionsOf(declared, card.options) as CardProps['options'],
            isEditing,
          },
        }}
        loading={
          <span className="sr-only">
            {t('dashboard.cards.packageCard.loadingTitle', 'Loading {{title}}…', { title })}
          </span>
        }
        renderProblem={(message) => (
          <p role="alert" className="line-clamp-4 text-caption text-danger">
            {t(
              'dashboard.cards.packageCard.nameCouldNotDraw',
              '{{name}} could not draw this card: {{message}}',
              { name: found.name, message },
            )}
          </p>
        )}
      />
    </CardFrame>
  );
}

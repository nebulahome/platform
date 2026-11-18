/**
 * A tile that goes somewhere (`K-New`, Shortcut): a page of the platform, a package's page, or a
 * web address. The whole tile is the link; an address outside the hub opens in a new tab and says
 * so with the outward arrow, the others with the arrow that goes on.
 */
import { useTranslation } from 'react-i18next';

import type { DashboardShortcutCard } from '@nebulahome/contracts';
import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { NAV_PAGES } from '@/components/sidebar';
import { text } from '@/i18n/messages';
import { Caption } from '@/routes/dashboard/cards/card-kit';
import { CardFrame, type CardTap } from '@/routes/dashboard/cards/card-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What the card needs. */
export type ShortcutCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardShortcutCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/** How a shortcut's chip is drawn, by where it goes. */
const TONES = {
  page: 'bg-primary/14 text-primary',
  package: 'bg-cyan/14 text-cyan',
  url: 'bg-violet/14 text-violet',
} as const;

/**
 * The host of a web address, as the tile writes it.
 *
 * @param url - The address.
 * @returns "192.168.1.1", or the address itself when it does not read.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Renders a shortcut.
 *
 * @param props - See {@link ShortcutCardProps}.
 * @returns The card.
 */
export function ShortcutCard(props: ShortcutCardProps) {
  const { t } = useTranslation();

  const { card, data } = props;
  const { target } = card;
  const page =
    target.kind === 'page'
      ? NAV_PAGES.find((each) => target.path === each.to || target.path.startsWith(`${each.to}/`))
      : undefined;
  const found = target.kind === 'package' ? data.packageById.get(target.packageId) : undefined;
  const host = target.kind === 'url' ? hostOf(target.url) : '';
  const name =
    card.title ??
    (target.kind === 'page'
      ? page === undefined
        ? target.path
        : text(page.label)
      : target.kind === 'package'
        ? (found?.name ?? target.packageId)
        : host);
  const icon: UiIconId =
    target.kind === 'page'
      ? (page?.icon ?? 'layout-dashboard')
      : target.kind === 'package'
        ? 'package'
        : 'globe';
  const kind =
    target.kind === 'page'
      ? t('dashboard.cards.shortcutCard.page', 'Page')
      : target.kind === 'package'
        ? t('dashboard.cards.shortcutCard.package', 'Package · {{name}}', {
            name: found?.name ?? target.packageId,
          })
        : t('dashboard.cards.shortcutCard.webAddress', 'Web address');
  const tap: CardTap =
    target.kind === 'url'
      ? { kind: 'away', href: target.url, label: name }
      : {
          kind: 'open',
          to: target.kind === 'page' ? target.path : `/packages/${target.packageId}`,
          label: name,
        };

  return (
    <CardFrame label={name} tap={tap}>
      <div className="flex h-8 shrink-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-field',
            TONES[target.kind],
          )}
        >
          <AppIcon id={icon} size={16} />
        </span>
        <span className="flex min-w-0 grow flex-col">
          <span className="truncate text-ui leading-[18px] font-medium">{name}</span>
          <span className="truncate text-caption leading-4 text-foreground-subtle">{kind}</span>
        </span>
        <span
          aria-hidden="true"
          className="inline-flex shrink-0 text-foreground-subtle transition-transform duration-150 group-hover:translate-x-0.5"
        >
          <AppIcon id={target.kind === 'url' ? 'external-link' : 'chevron-right'} size={16} />
        </span>
      </div>
      <div className="grow" />
      {target.kind === 'url' ? (
        <span className="truncate font-mono text-caption text-foreground-subtle">{host}</span>
      ) : (
        <Caption>
          {target.kind === 'page' ? target.path : (found?.description ?? target.packageId)}
        </Caption>
      )}
    </CardFrame>
  );
}

/**
 * The pieces every settings page is built from, drawn as the settings boards draw them.
 *
 * - **SettingsPage**: the breadcrumb (Settings › Group › Page), the page's icon chip, title and
 *   one line, then its blocks 28px apart.
 * - **HeroCard**: the state of the page at the top - the profile, the last backup, the host -
 *   on a `border-strong` card lit faintly in `primary`.
 * - **SettingsSection**: a mono label (with an action beside it) over a card of rows.
 * - **SettingsRow**: a title, one line under it, the control on the right; the control wraps under
 *   the text when the column is narrow. A row with a `searchId` is where the settings search can
 *   send somebody: opened with `?highlight=<id>`, it scrolls into view, outlined in `primary` with
 *   a "From search" pill, until a few seconds pass or the page is clicked.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { AppIcon, cn, Pill } from '@nebulahome/ui';

import { text } from '@/i18n/messages';
import { settingsPageAt } from '@/routes/settings/settings-tree';

/** How long a row found by the search stays lit. */
const HIGHLIGHT_MS = 4000;

/** What a settings page needs. */
export type SettingsPageProps = {
  /** Its entry in the tree, which gives the breadcrumb, the icon, the title and the line. */
  readonly path: string;

  /** For a page under the entry, such as Recent calls under Webhooks: its own title and line. */
  readonly sub?: { readonly title: string; readonly description: string };

  /** The blocks. */
  readonly children: ReactNode;
};

/**
 * Renders a settings page's header and its blocks.
 *
 * @param props - See {@link SettingsPageProps}.
 * @returns The page.
 */
export function SettingsPage(props: SettingsPageProps) {
  const { t } = useTranslation();
  const { path, sub, children } = props;
  const found = settingsPageAt(path);

  if (found === undefined) {
    return children;
  }

  const { group, page } = found;
  const crumbs: { label: string; to?: string }[] = [
    { label: t('settings.title', 'Settings'), to: '/settings' },
    ...(group.isLeaf ? [] : [{ label: text(group.label), to: group.pages[0]?.path ?? path }]),
    sub === undefined ? { label: text(page.label) } : { label: text(page.label), to: page.path },
    ...(sub === undefined ? [] : [{ label: sub.title }]),
  ];

  return (
    <div className="flex flex-col gap-7 pt-1">
      <div className="flex flex-col gap-3 pb-1">
        <nav
          aria-label={t('settings.breadcrumb', 'Breadcrumb')}
          className="flex flex-wrap items-center gap-1.5 text-caption text-foreground-subtle"
        >
          {crumbs.map((crumb, index) => (
            <span key={crumb.label} className="flex items-center gap-1.5">
              {index === 0 ? null : <AppIcon id="chevron-right" size={12} />}
              {crumb.to === undefined ? (
                <span aria-current="page" className="text-foreground">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.to}
                  className="text-foreground-muted transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              )}
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-3.5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-inner border border-primary/22 bg-primary/14 text-primary">
            <AppIcon id={page.icon} size={22} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-headline-lg font-medium text-foreground">
              {sub?.title ?? text(page.label)}
            </h2>
            <span className="text-ui text-foreground-subtle">
              {sub?.description ?? text(page.description)}
            </span>
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}

/** What a hero card needs. */
export type HeroCardProps = {
  /** On the left: an avatar, or an icon chip from {@link HeroIcon}. */
  readonly leading: ReactNode;

  /** The state, in a few words. */
  readonly title: ReactNode;

  /** A line under it. */
  readonly subtitle?: ReactNode;

  /** The buttons on the right. */
  readonly actions?: ReactNode;
};

/**
 * Renders the card at the top of a page that has a state to show.
 *
 * @param props - See {@link HeroCardProps}.
 * @returns The card.
 */
export function HeroCard(props: HeroCardProps) {
  const { leading, title, subtitle, actions } = props;

  return (
    <div className="hero-glow flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-border-strong px-5 py-4.5 shadow-edge">
      {leading}
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2.5 text-title font-medium text-foreground">
          {title}
        </span>
        {subtitle === undefined ? null : (
          <span className="text-caption text-foreground-subtle">{subtitle}</span>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/**
 * The icon chip a hero card leads with.
 *
 * @param props - The icon.
 * @param props.icon - Which.
 * @returns The chip.
 */
export function HeroIcon(props: { readonly icon: Parameters<typeof AppIcon>[0]['id'] }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-tile bg-primary/14 text-primary">
      <AppIcon id={props.icon} size={20} />
    </span>
  );
}

/** What a section needs. */
export type SettingsSectionProps = {
  /** The mono label above the card. */
  readonly label: ReactNode;

  /** A button beside the label, such as Sign out everywhere. */
  readonly action?: ReactNode;

  /** The rows, or anything else that sits in the card. */
  readonly children: ReactNode;

  /** Leaves the card out, for content that draws its own (a grid of tiles, a hero). */
  readonly isBare?: boolean;

  /** Extra classes for the card. */
  readonly className?: string;
};

/**
 * Renders a labelled card of rows.
 *
 * @param props - See {@link SettingsSectionProps}.
 * @returns The section.
 */
export function SettingsSection(props: SettingsSectionProps) {
  const { label, action, children, isBare = false, className } = props;

  return (
    <section className="flex flex-col gap-3">
      <div
        className={cn(
          'flex items-center justify-between gap-4 px-1',
          action === undefined ? 'min-h-4.5' : 'min-h-9',
        )}
      >
        <h3 className="font-mono text-label whitespace-nowrap text-foreground-subtle uppercase">
          {label}
        </h3>
        {action}
      </div>
      {isBare ? children : <SettingsCard className={className}>{children}</SettingsCard>}
    </section>
  );
}

/**
 * The card rows sit in: `surface`, `border`, 16px round, the lit top edge.
 *
 * @param props - The rows.
 * @param props.children - What is in it.
 * @param props.className - Extra classes.
 * @returns The card.
 */
export function SettingsCard(props: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        'rounded-card border border-border bg-surface px-4 shadow-edge',
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

/** What a row needs. */
export type SettingsRowProps = {
  /** What the setting is. */
  readonly title: ReactNode;

  /** One line under it: what it does, or what it costs. */
  readonly note?: ReactNode;

  /** Before the text: an icon chip, an avatar. */
  readonly leading?: ReactNode;

  /** The control, on the right. */
  readonly control?: ReactNode;

  /** Content under the row, the whole width: a form, a list of codes. */
  readonly children?: ReactNode;

  /** The id the settings search sends somebody to, for a row worth finding. */
  readonly searchId?: string;
};

/**
 * Renders one row of a settings card.
 *
 * @param props - See {@link SettingsRowProps}.
 * @returns The row.
 */
export function SettingsRow(props: SettingsRowProps) {
  const { t } = useTranslation();
  const { title, note, leading, control, children, searchId } = props;
  const [params] = useSearchParams();
  const row = useRef<HTMLDivElement>(null);
  const isTarget = searchId !== undefined && params.get('highlight') === searchId;

  // Each visit from the search carries its own `at`, so finding the same row twice lights it twice.
  const visit = `${params.get('highlight') ?? ''}@${params.get('at') ?? ''}`;
  const [dimmed, setDimmed] = useState<string | null>(null);
  const isLit = isTarget && dimmed !== visit;

  useEffect(() => {
    if (!isTarget) {
      return undefined;
    }

    row.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });

    /** Puts the light out. */
    const dim = (): void => {
      setDimmed(visit);
    };
    const timer = globalThis.setTimeout(dim, HIGHLIGHT_MS);

    globalThis.document.addEventListener('pointerdown', dim, { once: true });

    return () => {
      globalThis.clearTimeout(timer);
      globalThis.document.removeEventListener('pointerdown', dim);
    };
  }, [isTarget, visit]);

  return (
    <div
      ref={row}
      id={searchId}
      className={cn(
        'scroll-mt-24 border-t border-border py-3.5 transition-all duration-700 first:border-t-0',
        isLit &&
          '-mx-3 rounded-tile border-transparent bg-primary/8 px-3 ring-1 ring-primary ring-inset',
        isLit && '[&+*]:border-t-transparent',
      )}
    >
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
        <div className="flex min-w-0 flex-[1_1_220px] items-center gap-3">
          {leading}
          <div className="flex min-w-0 flex-col gap-0.75">
            <span className="flex flex-wrap items-center gap-2 text-title text-foreground">
              {title}
              {isLit ? (
                <Pill tone="accent" className="h-5 px-2 text-label">
                  {t('settings.search.fromSearch', 'From search')}
                </Pill>
              ) : null}
            </span>
            {note === undefined ? null : (
              <span className="text-ui-sm leading-snug text-foreground-subtle">{note}</span>
            )}
          </div>
        </div>
        {control === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{control}</div>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * A line at the foot of a card, under its rows: what the rows cannot say on their own.
 *
 * @param props - The text.
 * @param props.children - What it says.
 * @param props.tone - `danger` for a problem rather than an explanation.
 * @returns The note.
 */
export function SettingsNote(props: {
  readonly children: ReactNode;
  readonly tone?: 'danger' | 'warning';
}) {
  return (
    <p
      role={props.tone === undefined ? undefined : 'alert'}
      className={cn(
        'border-t border-border py-3 text-caption first:border-t-0',
        props.tone === 'danger'
          ? 'text-danger'
          : props.tone === 'warning'
            ? 'text-warning'
            : 'text-foreground-subtle',
      )}
    >
      {props.children}
    </p>
  );
}

/**
 * The icon chip a row leads with: a session's device, a location's folder.
 *
 * @param props - The icon.
 * @param props.children - The glyph.
 * @returns The chip.
 */
export function RowIcon(props: { readonly children: ReactNode }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-field border border-border-strong bg-surface-raised text-foreground-muted">
      {props.children}
    </span>
  );
}

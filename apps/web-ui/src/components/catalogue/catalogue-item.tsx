/**
 * An item's own page inside an install dialog: who it is and who publishes it, the marks of how it
 * works, what the Community Hub says of it, what it is, what it works with, and - before anything
 * is downloaded - what installing it does.
 *
 * What installing does is a list of facts the caller worked out from real data: the packages that
 * go in with it, what it talks over, what it needs, whether it ships code. The page draws them; it
 * invents none.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import type { InstallEffect } from '@/lib/install-effects';

/** What the page needs. */
export type CatalogueItemProps = {
  /** The logo, or a monogram: 80px. */
  readonly logo: ReactNode;

  readonly name: string;

  /** Who publishes it: "by nebulahome". */
  readonly by: string | null;

  /** The marks under the name: Official, Local network, a wire. */
  readonly chips: ReactNode;

  /** The line of figures: stars, installs, version, the last release. */
  readonly stats: ReactNode;

  /** What it is. */
  readonly description: string;

  /** The devices or services it works with; nothing when it names none. */
  readonly worksWith?: readonly string[] | undefined;

  /** What installing it does. */
  readonly effects: readonly InstallEffect[];

  /** Below: what is installed, why it cannot be, a confirmation, an error. */
  readonly children?: ReactNode;
};

/**
 * Renders an item's page.
 *
 * @param props - See {@link CatalogueItemProps}.
 * @returns The page.
 */
export function CatalogueItem(props: CatalogueItemProps) {
  const { t } = useTranslation();
  const { logo, name, by, chips, stats, description, worksWith = [], effects, children } = props;

  return (
    <div className="flex flex-col gap-5 px-7.5 pt-7 pb-8">
      <div className="flex items-start gap-5">
        {logo}
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="text-display font-medium break-words text-foreground">{name}</h3>
          {by === null ? null : <span className="text-ui-sm text-foreground-subtle">{by}</span>}
          <div className="mt-1 flex flex-wrap items-center gap-2">{chips}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-border py-3.5 text-ui-sm text-foreground-muted">
        {stats}
      </div>

      {description === '' ? null : (
        <p className="text-ui leading-relaxed text-foreground-muted">{description}</p>
      )}

      {worksWith.length === 0 ? null : (
        <section className="flex flex-col gap-2.5">
          <h4 className="font-mono text-label text-foreground-subtle uppercase">
            {t('catalogue.worksWith', 'Works with')}
          </h4>
          <ul className="flex flex-wrap gap-2">
            {worksWith.map((model) => (
              <li
                key={model}
                className="rounded-chip bg-surface-raised px-3 py-1.5 text-ui-sm text-foreground-muted"
              >
                {model}
              </li>
            ))}
          </ul>
        </section>
      )}

      {effects.length === 0 ? null : (
        <section className="flex flex-col">
          <h4 className="pb-2.5 font-mono text-label text-foreground-subtle uppercase">
            {t('catalogue.whatInstallingDoes', 'What installing does')}
          </h4>
          <ul className="flex flex-col">
            {effects.map((effect) => (
              <li
                key={effect.title}
                className="flex items-start gap-3.5 border-t border-border py-3"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-7.5 shrink-0 items-center justify-center rounded-field bg-surface-raised',
                    effect.tone === 'warning' ? 'text-warning' : 'text-foreground-muted',
                  )}
                >
                  <AppIcon id={effect.icon} size={15} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-ui font-medium text-foreground">{effect.title}</span>
                  <span className="text-ui-sm text-foreground-subtle">{effect.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {children}
    </div>
  );
}

/** What a mark under the name needs. */
export type CatalogueChipProps = {
  /** A glyph before the words; a dot for the accent. */
  readonly icon?: UiIconId;

  /** Accent for Official, warning for what needs the internet. */
  readonly tone?: 'neutral' | 'accent' | 'warning';

  readonly children: ReactNode;
};

/**
 * One mark under an item's name.
 *
 * @param props - See {@link CatalogueChipProps}.
 * @returns The mark.
 */
export function CatalogueChip(props: CatalogueChipProps) {
  const { icon, tone = 'neutral', children } = props;

  return (
    <span
      className={cn(
        'inline-flex h-6.5 items-center gap-1.5 rounded-pill border px-2.5 text-ui-sm whitespace-nowrap',
        tone === 'accent' && 'border-primary/40 bg-primary-soft text-primary',
        tone === 'warning' && 'border-warning-line text-warning',
        tone === 'neutral' && 'border-border-strong text-foreground-muted',
      )}
    >
      {icon === undefined ? (
        tone === 'accent' ? (
          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
        ) : null
      ) : (
        <AppIcon id={icon} size={13} />
      )}
      {children}
    </span>
  );
}

/** What a figure of the stats line needs. */
export type CatalogueStatProps = {
  /** Its glyph. */
  readonly icon: UiIconId;

  /** The figure, in mono. */
  readonly value: ReactNode;

  /** The words after it. */
  readonly label?: ReactNode;

  /** A colour for the glyph: the star's warmth. */
  readonly iconClassName?: string;
};

/**
 * One figure of an item's stats line.
 *
 * @param props - See {@link CatalogueStatProps}.
 * @returns The figure.
 */
export function CatalogueStat(props: CatalogueStatProps) {
  const { icon, value, label, iconClassName } = props;

  return (
    <span className="flex items-center gap-1.5 tabular">
      <AppIcon id={icon} size={14} className={iconClassName ?? 'text-foreground-subtle'} />
      <span className="font-mono font-medium text-foreground">{value}</span>
      {label === undefined ? null : <span>{label}</span>}
    </span>
  );
}

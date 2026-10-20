/**
 * The linked tag: one device reached two ways, said in one pill - a chain and the two transports'
 * marks. On a device's or an entity's page it carries the word **Linked** and sits in the tag row;
 * in a list it follows the name without it. Every tag in a row has one shape, the status pill's: 24px
 * high and fully round.
 *
 * On an entity's row it can also unlink: hovered or focused, it turns into **Unlink**, in the
 * danger colour, and pressing it asks.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** What the tag needs. */
export type LinkedTagProps = {
  /** The two transports' marks, 16px squares, the device's own first. */
  readonly marks: readonly ReactNode[];

  /** The transports by name, for the tag's title: "Shelly", "Matter". */
  readonly transports: readonly string[];

  /** Whether the word Linked is written: on a page, not in a list. */
  readonly isLabelled?: boolean;

  /** Unlinks, for a tag that offers it on hover. */
  readonly onUnlink?: () => void;

  readonly className?: string;
};

/**
 * Renders the tag.
 *
 * @param props - See {@link LinkedTagProps}.
 * @returns The tag.
 */
export function LinkedTag(props: LinkedTagProps) {
  const { t } = useTranslation();
  const { marks, transports, isLabelled = false, onUnlink, className } = props;
  const named = transports.join(t('ui.linkedTag.and', ' and '));
  const title = t('ui.linkedTag.title', 'Linked: one device, reached through {{transports}}', {
    transports: named,
  });
  const label = t('ui.linkedTag.label', 'Linked: {{transports}}', { transports: named });

  const linked = (
    <>
      <AppIcon id="link-2" size={13} className="shrink-0 text-primary" />
      {isLabelled ? (
        <span className="ml-px text-caption text-foreground">
          {t('ui.linkedTag.linked', 'Linked')}
        </span>
      ) : null}
      <span className="flex items-center" aria-hidden="true">
        {marks.map((mark, index) => (
          <span
            // The marks are the transports', in order, and never reordered.
            // eslint-disable-next-line react/no-array-index-key -- see above
            key={index}
            className={cn(
              'flex overflow-hidden rounded-check',
              isLabelled ? 'size-4' : 'size-3.5',
              // Each laps the one before it, cut out of it by a ring of the ground.
              index > 0 && '-ml-0.5 ring-2 ring-surface',
            )}
          >
            {mark}
          </span>
        ))}
      </span>
    </>
  );

  const shape = cn(
    'inline-flex shrink-0 items-center gap-1.25 rounded-pill border pr-0.75 pl-2 align-middle',
    isLabelled ? 'h-6' : 'h-5.5',
  );
  const look = 'border-primary/40 bg-linear-to-r from-primary/16 to-violet/10';

  if (onUnlink === undefined) {
    return (
      <span title={title} aria-label={label} className={cn(shape, look, className)}>
        {linked}
      </span>
    );
  }

  return (
    <button
      type="button"
      title={t('ui.linkedTag.unlink', 'Unlink')}
      aria-label={t('ui.linkedTag.unlinkNamed', 'Unlink: {{transports}}', { transports: named })}
      onClick={(event) => {
        // The row behind it opens the entity; the tag only unlinks.
        event.stopPropagation();
        onUnlink();
      }}
      className={cn(
        'group',
        shape,
        look,
        'hover:border-danger/60 hover:bg-danger/10 hover:bg-none focus-visible:border-danger/60 focus-visible:bg-danger/10 focus-visible:bg-none focus-visible:outline-none',
        className,
      )}
    >
      <span className="flex items-center gap-1.25 group-hover:hidden group-focus-visible:hidden">
        {linked}
      </span>
      <span className="hidden items-center gap-1 pr-1.25 text-caption text-danger group-hover:flex group-focus-visible:flex">
        <AppIcon id="unlink-2" size={13} />
        {t('ui.linkedTag.unlink', 'Unlink')}
      </span>
    </button>
  );
}

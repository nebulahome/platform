/**
 * A banner across the top of a page or a block: something to know before using what is under it.
 * The dashboard editor's "Everyone who uses Home sees the change" (`accent`); the automations'
 * "Nothing runs these yet" (`warning`); a failure that stops the page (`danger`).
 *
 * A soft ground of its colour with a 1px edge of the same, a glyph that says which kind it is, the
 * sentence, and room on the right for the one action it asks for.
 */
import type { ReactNode } from 'react';

import type { UiIconId } from '../icons/ui-set.js';
import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** What kind of thing the banner says. */
export type NoteTone = 'accent' | 'warning' | 'danger';

/** The look of each kind. */
const TONES: Record<
  NoteTone,
  { readonly icon: UiIconId; readonly box: string; readonly glyph: string }
> = {
  accent: {
    icon: 'info',
    box: 'border-primary-ring bg-primary-soft',
    glyph: 'text-primary',
  },
  warning: {
    icon: 'triangle-alert',
    box: 'border-warning-line bg-warning-soft',
    glyph: 'text-warning',
  },
  danger: {
    icon: 'circle-x',
    box: 'border-danger-line bg-danger-soft',
    glyph: 'text-danger',
  },
};

/** What a banner needs. */
export type NoteProps = {
  /** What kind of thing it says. */
  readonly tone: NoteTone;

  /** The sentence, with its first words in weight 500 when they name the fact. */
  readonly children: ReactNode;

  /** The one action it asks for. */
  readonly action?: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders a banner.
 *
 * @param props - See {@link NoteProps}.
 * @returns The banner.
 */
export function Note(props: NoteProps) {
  const { tone, children, action, className } = props;
  const look = TONES[tone];

  return (
    <div
      role={tone === 'accent' ? 'note' : 'status'}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-inner border px-4 py-3',
        look.box,
        className,
      )}
    >
      <AppIcon id={look.icon} size={16} className={cn('shrink-0', look.glyph)} />
      <p className="min-w-0 grow text-ui text-foreground">{children}</p>
      {action}
    </div>
  );
}

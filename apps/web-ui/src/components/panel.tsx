/**
 * The titled group of rows every settings page is made of.
 *
 * Two components rather than one that takes an array of rows: a row's control is arbitrary
 * markup, several of them span the whole width instead of sitting on the right, and a data
 * structure describing all of that would be a worse language for it than JSX already is.
 *
 * The divider between rows is drawn by the row and not by the panel, because the panel does not
 * know how many children it has - `:last-child` does.
 */
import type { ReactNode } from 'react';

import { cn } from '@nebula-home/ui';

/** What a panel needs. */
export type PanelProps = {
  /** The heading, set in the small capitals every group header uses. */
  readonly title: string;

  /** A control in the header, such as the button that adds a row. */
  readonly action?: ReactNode;

  /** The rows. */
  readonly children: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders a titled group.
 *
 * @param props - See {@link PanelProps}.
 * @returns The panel.
 */
export function Panel(props: PanelProps) {
  const { title, action, children, className } = props;

  return (
    <section className={cn('rounded-panel border border-border bg-surface', className)}>
      <header className="flex h-[46px] items-center justify-between gap-4 border-b border-border px-4">
        <h2 className="text-[11px] font-medium tracking-[0.09em] text-foreground-subtle uppercase">
          {title}
        </h2>
        {action}
      </header>

      {children}
    </section>
  );
}

/** What one row needs. */
export type PanelRowProps = {
  /** What the setting is. */
  readonly title: ReactNode;

  /** A line under it saying what it does, or what it costs. */
  readonly note?: ReactNode;

  /** The control, on the right. */
  readonly control?: ReactNode;

  /**
   * Content below the title and the control, spanning the whole width.
   *
   * For the rows that open into something: a form, a list of recovery codes, a secret.
   */
  readonly children?: ReactNode;
};

/**
 * Renders one row.
 *
 * @param props - See {@link PanelRowProps}.
 * @returns The row.
 */
export function PanelRow(props: PanelRowProps) {
  const { title, note, control, children } = props;

  return (
    <div className="border-b border-surface-raised px-4 py-3.5 last:border-b-0">
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <span className="text-[13.5px] font-medium text-foreground">{title}</span>
          {note === undefined ? null : (
            <span className="text-xs leading-snug text-foreground-subtle">{note}</span>
          )}
        </div>

        {control}
      </div>

      {children === undefined ? null : <div className="mt-3.5">{children}</div>}
    </div>
  );
}

/** What a note needs. */
export type PanelNoteProps = {
  /** What the reader should know. */
  readonly children: ReactNode;
};

/**
 * A line of explanation at the foot of a panel.
 *
 * Used for the things a person has to be told rather than shown: that a constraint exists, or
 * that a page's settings live in this browser and nowhere else.
 *
 * @param props - See {@link PanelNoteProps}.
 * @returns The note.
 */
export function PanelNote(props: PanelNoteProps) {
  const { children } = props;

  return (
    <p className="border-t border-surface-raised px-4 py-3 text-[11.5px] leading-relaxed text-foreground-subtle">
      {children}
    </p>
  );
}

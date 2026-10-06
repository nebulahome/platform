/**
 * The titled group of rows a settings page is made of.
 *
 * A panel and its rows are separate components rather than one that takes an array: a row's
 * control is arbitrary markup, several of them span the whole width instead of sitting on the
 * right, and a data structure describing all of that would be a worse language for it than JSX
 * already is.
 *
 * Flat: a `surface` fill on a `border` edge, 18px round. The head is the panel's title and no
 * divider; each row draws the line above it, so the first row's line sets the title apart.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

const panel = cva('rounded-panel border border-border', {
  variants: {
    /**
     * How much the panel is meant to be noticed.
     *
     * `raised` is the default and the one a page is built from. `flat` is for a panel inside
     * another surface, where the second shadow would only say that somebody nested two cards.
     */
    elevation: {
      raised: 'bg-surface',
      flat: 'bg-surface',
    },
  },
  defaultVariants: { elevation: 'raised' },
});

/** What a panel needs. */
export type PanelProps = VariantProps<typeof panel> & {
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
  const { title, action, elevation, children, className } = props;

  return (
    <section className={cn(panel({ elevation }), className)}>
      <header className="flex min-h-12 items-center justify-between gap-3 px-5.5 pt-4 pb-3">
        <h2 className="text-subhead font-medium text-foreground">{title}</h2>
        {action}
      </header>

      {children}
    </section>
  );
}

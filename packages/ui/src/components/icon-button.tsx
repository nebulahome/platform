/**
 * A button that is only a glyph.
 *
 * Separate from {@link Button} rather than a variant of it, because the two disagree about the
 * one thing that matters: a button with a label is named by its text and an icon button has no
 * text to be named by. Making `label` required here is the whole point of the file - a variant
 * could only ask for it politely, and `aria-label` on an icon button is not optional
 * (RULES.md 15.4).
 *
 * The label says what pressing it does, not what state the control is in. "Hide" on a hidden
 * password is the kind of label that makes people press it to find out.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn.js';

const iconButton = cva(
  'press-scale inline-flex shrink-0 items-center justify-center rounded-pill border ' +
    'border-transparent disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        /** Sits on a surface and looks like a control. */
        raised:
          'border-border-strong bg-surface-raised text-foreground-muted hover:enabled:bg-surface-high hover:enabled:text-foreground',

        /** No face at all until it is pointed at. For a button inside a field or a row. */
        bare: 'text-foreground-muted hover:enabled:bg-surface-high hover:enabled:text-foreground',

        /** A destructive action reduced to its glyph. */
        danger: 'text-foreground-subtle hover:enabled:bg-danger-soft hover:enabled:text-danger',

        /** The one action of a row, reduced to its glyph. */
        primary: 'bg-primary text-primary-foreground hover:enabled:bg-primary-hover',
      },
      size: {
        /** Inside a field or a chip. */
        small: 'size-6',

        /** Beside a control, in a row, or in a panel header. */
        medium: 'size-8',

        /** On its own, beside a button. */
        large: 'size-control',
      },
    },
    defaultVariants: { variant: 'bare', size: 'medium' },
  },
);

/** What an icon button accepts, on top of the native attributes. */
export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> &
  VariantProps<typeof iconButton> & {
    /** What pressing it does. Required: there is no text to read instead. */
    readonly label: string;

    /** The glyph. */
    readonly children: ReactNode;
  };

/**
 * Renders an icon-only button.
 *
 * @param props - See {@link IconButtonProps}.
 * @returns The button.
 */
export function IconButton(props: IconButtonProps) {
  const { variant, size, label, className, children, ...rest } = props;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(iconButton({ variant, size }), className)}
      {...rest}
    >
      {children}
    </button>
  );
}

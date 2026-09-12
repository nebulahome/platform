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
  'press-scale inline-flex shrink-0 items-center justify-center ' +
    'disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        /** Sits on a surface and looks like a control. */
        raised:
          'face-raised rounded-chip border border-border-strong text-foreground-muted hover:text-foreground',

        /** No face at all until it is pointed at. For a button inside a field or a row. */
        bare: 'rounded-chip text-foreground-subtle hover:bg-surface-raised hover:text-foreground',

        /** A destructive action reduced to its glyph. */
        danger: 'rounded-chip text-foreground-subtle hover:bg-danger/10 hover:text-danger',
      },
      size: {
        /** Inside a field or a table row. */
        small: 'size-7',

        /** Beside a control, or in a panel header. */
        medium: 'size-control-sm',

        /** On its own. */
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

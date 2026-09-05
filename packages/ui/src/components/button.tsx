/**
 * The one button.
 *
 * Three intents and two sizes, which is every button the authentication screens and the rail
 * need. A fourth variant should be added when a screen needs one, not in advance.
 *
 * `busy` rather than a separate spinner the caller places: a button that is waiting must also
 * stop being clickable, and keeping those two facts in one prop is what stops them diverging.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn.js';

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors ' +
    'disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        ghost:
          'border border-border bg-surface text-foreground-muted hover:bg-surface-raised ' +
          'hover:text-foreground',
        danger: 'border border-danger/40 bg-transparent text-danger hover:bg-danger/10',
      },
      size: {
        medium: 'h-10 px-4 text-[13.5px]',
        large: 'h-11 w-full px-4 text-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'medium' },
  },
);

/** What a button accepts, on top of the native attributes. */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & {
    /** Shows a spinner and disables the button. */
    readonly isBusy?: boolean;

    /** The label. */
    readonly children: ReactNode;
  };

/**
 * Renders a button.
 *
 * Destructured in the body rather than in the signature, and every component in the interface
 * does the same. Each prop is already documented on {@link ButtonProps}; repeating all of them
 * as `@param props.x` lines would be the same text in two places, and the copy that drifts is
 * always the one further from the type.
 *
 * @param props - See {@link ButtonProps}.
 * @returns The button.
 */
export function Button(props: ButtonProps) {
  const { variant, size, isBusy = false, disabled, className, children, ...rest } = props;

  return (
    <button
      type="button"
      disabled={disabled === true || isBusy}
      aria-busy={isBusy}
      className={cn(button({ variant, size }), className)}
      {...rest}
    >
      {isBusy ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}

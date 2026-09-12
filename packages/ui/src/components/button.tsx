/**
 * The one button.
 *
 * Three intents and three sizes. The intent says what pressing it means and the size says where
 * it sits - `compact` in a table row, `default` in a panel, `large` as the one thing a form is
 * for. A fourth intent should be added when a screen needs one, not in advance.
 *
 * `busy` rather than a separate spinner the caller places: a button that is waiting must also
 * stop being clickable, and keeping those two facts in one prop is what stops them diverging.
 *
 * The faces come from the theme rather than from a fill and a border written out here. A raised
 * control is a gradient, a lit top edge and a shadow that have to change together, and the light
 * theme replaces all three at once - which is only possible while they have one name.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn.js';

const button = cva(
  'press inline-flex items-center justify-center gap-2 rounded-field font-medium ' +
    'disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none',
  {
    variants: {
      variant: {
        /** The one thing the screen is for. */
        primary: 'face-primary text-primary-foreground',

        /**
         * Everything else.
         *
         * It used to be `bg-surface`, the same colour as the panel it sits on, so its only edge
         * was a border the same weight as every divider. A control sits one step above what it
         * sits on, or it is not a control.
         */
        ghost: 'face-raised border border-border-strong text-foreground',

        /** Destroys something. Outlined rather than filled: it should not attract the eye. */
        danger: 'rounded-field border border-danger/40 bg-danger/8 text-danger hover:bg-danger/15',
      },
      size: {
        /** In a table row or a panel header, beside other row controls. */
        compact: 'h-control-sm px-3 text-ui',

        /** In a form or a dialog footer. */
        medium: 'h-control px-4 text-ui',

        /** The single action a sign-in screen exists for. */
        large: 'h-control-lg w-full px-4 text-title',
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

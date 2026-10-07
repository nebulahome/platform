/**
 * The one button: always a pill.
 *
 * Four intents and three sizes. The intent says what pressing it means and the size says where
 * it sits - `compact` (30px) in a header or a row, `medium` (36px) in a toolbar, a form or a
 * footer, `large` (46px, full width) as the single action of an auth screen.
 *
 * `busy` rather than a separate spinner the caller places: a button that is waiting must also
 * stop being clickable, and keeping those two facts in one prop is what stops them diverging.
 *
 * Flat: a fill, an edge where the intent has one, no gradient and no shadow. Pressed, it sinks a
 * pixel (`press`).
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import { cn } from '../lib/cn.js';

const button = cva(
  'press inline-flex shrink-0 items-center justify-center gap-2 rounded-pill border ' +
    'border-transparent font-medium whitespace-nowrap ' +
    'disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        /** The one thing the screen is for: one per view. */
        primary: 'bg-primary text-primary-foreground hover:enabled:bg-primary-hover',

        /** Everything else that does something. */
        ghost:
          'border-border-strong bg-surface-raised text-foreground hover:enabled:bg-surface-high',

        /** Destroys something. Outlined rather than filled: it should not attract the eye. */
        danger: 'border-danger-line bg-transparent text-danger hover:enabled:bg-danger-soft',

        /** Cancel, Back, Skip for now: no face until it is pointed at. */
        bare: 'bg-transparent text-foreground-muted hover:enabled:bg-surface-raised hover:enabled:text-foreground',
      },
      size: {
        /** In a header or a row, beside other row controls. */
        compact: 'h-control-sm px-3 text-ui-sm',

        /** In a toolbar, a form or a dialog footer. */
        medium: 'h-control px-3.5 text-ui',

        /** The single action an auth screen exists for. */
        large: 'h-control-xl w-full px-5 text-title',
      },
    },
    compoundVariants: [
      {
        // A large primary that cannot be pressed yet says so by its fill, not by fading.
        variant: 'primary',
        size: 'large',
        className: 'disabled:bg-surface-high disabled:text-foreground-subtle disabled:opacity-100',
      },
    ],
    defaultVariants: { variant: 'primary', size: 'medium' },
  },
);

/** What a button accepts, on top of the native attributes. */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & {
    /** Shows a spinner and disables the button. */
    readonly isBusy?: boolean;

    /** The element, for a menu to give the focus back to. */
    readonly ref?: Ref<HTMLButtonElement>;

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

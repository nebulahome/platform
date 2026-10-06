/**
 * The look of anything a person types into or opens.
 *
 * A text input, a password input and a dropdown button are three different controls that must be
 * one shape: the same height, the same recess, the same focus ring, and the same two things
 * happening when the value is wrong. Written out three times they were already three different
 * shades of nearly-right, and the dropdown had drifted a pixel and a half taller than the field
 * above it.
 *
 * A field is a `surface-raised` fill on a `border-strong` edge, 10px round - a rounded rectangle,
 * where a control that performs an action is a pill. Focused, its edge turns `primary` with the
 * focus halo; wrong, `danger`. On the sign-in sky the large field is a veil over the glass.
 */
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The classes for a control that takes input.
 *
 * @param options - The variants to apply.
 * @returns The class string.
 */
export const controlFace = cva(
  'w-full rounded-field border bg-surface-raised text-foreground transition duration-150 ' +
    'placeholder:text-foreground-subtle focus-visible:shadow-focus focus-visible:outline-none ' +
    'disabled:cursor-not-allowed disabled:bg-rail disabled:text-foreground-subtle',
  {
    variants: {
      size: {
        /** Beside a row's title, where the row is one line tall. */
        compact: 'h-control-sm px-3 text-ui-sm',

        /** In a form. */
        medium: 'h-control-field px-3 text-ui',

        /** On an authentication screen: a veil over the glass card. */
        large: 'h-control-lg rounded-tile bg-veil px-3.5 text-title',
      },
      isInvalid: {
        true: 'border-danger focus-visible:border-danger',
        false: 'border-border-strong focus-visible:border-primary',
      },
    },
    defaultVariants: { size: 'medium', isInvalid: false },
  },
);

/** The variants {@link controlFace} accepts. */
export type ControlFaceVariants = VariantProps<typeof controlFace>;

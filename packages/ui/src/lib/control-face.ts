/**
 * The look of anything a person types into or opens.
 *
 * A text input, a password input and a dropdown button are three different controls that must be
 * one shape: the same height, the same recess, the same focus ring, and the same two things
 * happening when the value is wrong. Written out three times they were already three different
 * shades of nearly-right, and the dropdown had drifted a pixel and a half taller than the field
 * above it.
 *
 * A field is *sunk* rather than merely bordered. That is the one visual fact separating a control
 * that takes input from a control that performs an action: the first reads as cut into the page,
 * the second as sitting on it.
 */
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The classes for a control that takes input.
 *
 * @param options - The variants to apply.
 * @returns The class string.
 */
export const controlFace = cva(
  'face-sunk w-full rounded-field border text-foreground transition-colors ' +
    'placeholder:text-foreground-disabled ' +
    'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none ' +
    'disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      size: {
        /** Beside a row's title, where the row is one line tall. */
        compact: 'h-control-sm px-3 text-ui',

        /** In a settings form. */
        medium: 'h-control px-3.5 text-ui',

        /** On an authentication screen, where the field is most of the page. */
        large: 'h-control-lg px-3.5 text-title',
      },
      isInvalid: {
        true: 'border-danger focus-visible:border-danger focus-visible:ring-danger/25',
        false: 'border-border focus-visible:border-primary',
      },
    },
    defaultVariants: { size: 'medium', isInvalid: false },
  },
);

/** The variants {@link controlFace} accepts. */
export type ControlFaceVariants = VariantProps<typeof controlFace>;

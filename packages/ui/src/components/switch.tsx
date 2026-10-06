/**
 * Something that is on or off, and turns the other way when pressed.
 *
 * A `button` with `role="switch"` rather than a checkbox: pressing it is an action that happens
 * now - a relay closes - not a box ticked on a form that is saved later, and a switch is what a
 * screen reader announces for that ("on, switch"). Space and Enter press it as they press any
 * button.
 *
 * The state is carried by position as well as by colour: the knob sits at the right when it is
 * on, so the switch still reads in a theme, a light or an eye that loses the accent (RULES.md
 * 15.5). The label is required for the same reason an icon button's is - there is no text inside
 * to name it by.
 */
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/cn.js';

const track = cva(
  'relative inline-flex shrink-0 items-center rounded-pill transition-colors duration-150 ' +
    'disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        /** Beside a name in a row. */
        small: 'h-5 w-8.5',

        /** On its own, as the control of a panel row. */
        medium: 'h-6 w-10',
      },
      isOn: {
        true: 'bg-primary',
        false: 'bg-control',
      },
    },
    defaultVariants: { size: 'medium', isOn: false },
  },
);

const knob = cva(
  'pointer-events-none absolute top-0.75 left-0.75 rounded-full ' +
    'transition duration-180 ease-out',
  {
    variants: {
      size: {
        small: 'size-3.5',
        medium: 'size-4.5',
      },
      isOn: {
        true: 'bg-knob',
        false: 'translate-x-0 bg-foreground-muted',
      },
    },
    compoundVariants: [
      { size: 'small', isOn: true, className: 'translate-x-3.5' },
      { size: 'medium', isOn: true, className: 'translate-x-4' },
    ],
    defaultVariants: { size: 'medium', isOn: false },
  },
);

/** What a switch needs. */
export type SwitchProps = Omit<VariantProps<typeof track>, 'isOn'> & {
  /** What it switches: "Kitchen ceiling", "Power". */
  readonly label: string;

  /** Whether it is on. */
  readonly isOn: boolean;

  /** Called with the state it should turn to. */
  readonly onChange: (isOn: boolean) => void;

  /** Whether it can be pressed at all. */
  readonly disabled?: boolean;

  /** Whether a change it asked for is still on its way; it cannot be pressed meanwhile. */
  readonly isBusy?: boolean;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders a switch.
 *
 * @param props - See {@link SwitchProps}.
 * @returns The switch.
 */
export function Switch(props: SwitchProps) {
  const { label, isOn, onChange, size, disabled = false, isBusy = false, className } = props;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={label}
      aria-busy={isBusy || undefined}
      title={label}
      disabled={disabled || isBusy}
      className={cn(track({ size, isOn }), isBusy && 'cursor-progress', className)}
      onClick={() => {
        onChange(!isOn);
      }}
    >
      <span aria-hidden="true" className={knob({ size, isOn })} />
    </button>
  );
}

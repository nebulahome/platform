/**
 * The props of the design system's components a package may draw with, and the object the
 * interface lends to implement them ({@link ComponentsHost}).
 *
 * Written out rather than taken from the design system, so the contract is what is here and not
 * whatever the interface's components happen to accept: a parity test checks that each of these
 * is accepted by the interface's own component.
 */
import type {
  ButtonHTMLAttributes,
  ComponentType,
  InputHTMLAttributes,
  ReactNode,
  SVGProps,
} from 'react';

/** What a button does: the one thing a screen is for, anything else, or a destructive action. */
export type ButtonVariant = 'primary' | 'ghost' | 'danger';

/** A button's size. */
export type ButtonSize = 'compact' | 'medium' | 'large';

/** A button: a native button's attributes, a variant and a size. */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;

  /** Draws a spinner and refuses presses while true. */
  readonly isBusy?: boolean;

  readonly children: ReactNode;
};

/** A button with an icon and no text, named by `label`. */
export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  readonly variant?: 'bare' | 'danger';
  readonly size?: 'small' | 'medium' | 'large';

  /** What pressing it does, for a screen reader and the tooltip. */
  readonly label: string;

  /** The glyph: an `Icon`. */
  readonly children: ReactNode;
};

/** A catalogue icon, by the ids `icon` fields take. */
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'id' | 'width' | 'height' | 'viewBox'> & {
  readonly id: string;

  /** In pixels; 20 when not said. */
  readonly size?: number;
};

/** What a badge means. */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/** A short state. */
export type BadgeProps = {
  readonly tone?: BadgeTone;
  readonly size?: 'small' | 'medium';
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
};

/** A titled section. */
export type PanelProps = {
  readonly title: string;

  /** `flat` for a panel inside another. */
  readonly elevation?: 'raised' | 'flat';

  /** What sits in the title's row: a button. */
  readonly action?: ReactNode;

  readonly children: ReactNode;
  readonly className?: string;
};

/** A row of a panel: a title, a note under it, a control opposite. */
export type PanelRowProps = {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly control?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
};

/** A note under a panel. */
export type PanelNoteProps = {
  readonly children: ReactNode;
};

/** A card's two-line heading. */
export type CardHeadingProps = {
  readonly title: string;
  readonly subtitle?: string | null | undefined;

  /** What sits opposite: a switch, a badge. */
  readonly tail?: ReactNode;

  /** Draws the title quieter, for something that cannot be read. */
  readonly isMuted?: boolean;
};

/** A reading as a number and its unit. */
export type FigureProps = {
  /** The number, already written. */
  readonly value: string;

  readonly unit?: string | null | undefined;
  readonly size?: 'large' | 'medium' | 'small';

  /** A colour for the number, when what it measures has one. */
  readonly color?: string | undefined;
};

/** A state at a glance. */
export type StatusDotProps = {
  readonly tone: 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

  /** What it means, for the tooltip and a screen reader. */
  readonly title: string;

  /** Pulses while something is being done. */
  readonly isBusy?: boolean;
};

/** How far something has come. */
export type ProgressBarProps = {
  /** 0 to 100; null pulses the whole bar. */
  readonly percent: number | null;

  /** What it is, for a screen reader. */
  readonly label: string;
};

/** An explanation behind a small `i`. */
export type HintProps = {
  readonly text: string;
  readonly className?: string;
};

/** A labelled text input: an input's attributes, a label, and what it says under it. */
export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'size'> & {
  readonly label: string;
  readonly isLabelHidden?: boolean;
  readonly size?: 'compact' | 'medium' | 'large';
  readonly error?: string | undefined;
  readonly warning?: string | undefined;
  readonly hint?: ReactNode;
};

/** One choice of a select or a segmented control. */
export type ControlOption<TValue extends string = string> = {
  readonly value: TValue;
  readonly label: string;
};

/** A labelled choice from a list. */
export type SelectFieldProps = {
  readonly label: string;
  readonly isLabelHidden?: boolean;
  readonly options: readonly ControlOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly size?: 'compact' | 'medium' | 'large';
  readonly error?: string | undefined;
  readonly hint?: ReactNode;
  readonly className?: string;
};

/** On or off. */
export type SwitchProps = {
  readonly label: string;
  readonly isOn: boolean;
  readonly onChange: (isOn: boolean) => void;
  readonly size?: 'small' | 'medium';
  readonly disabled?: boolean;
  readonly isBusy?: boolean;
  readonly className?: string;
};

/** One of a few, side by side. */
export type SegmentedProps<TValue extends string = string> = {
  readonly label: string;
  readonly options: readonly ControlOption<TValue>[];
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
  readonly size?: 'compact' | 'medium';
  readonly disabled?: boolean;
  readonly className?: string;
};

/** A value in a range. */
export type SliderProps = {
  readonly label: string;
  readonly isLabelHidden?: boolean;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;

  /** The value, written: `40 %`. */
  readonly display: string;

  readonly onChange: (value: number) => void;

  /** Once the knob is let go. */
  readonly onCommit?: ((value: number) => void) | undefined;

  readonly fill?: 'accent' | 'warm';
  readonly disabled?: boolean;
  readonly className?: string;
};

/** A value by steps. */
export type StepperProps = {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;

  /**
   * Writes a value.
   *
   * @param value - The value.
   * @returns It, written.
   */
  readonly format: (value: number) => string;

  readonly onChange: (value: number) => void;
  readonly disabled?: boolean;
  readonly className?: string;
};

/** A colour of the tag palette. */
export type TagColor =
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'pink';

/** A coloured tag. */
export type TagChipProps = {
  readonly color: TagColor;
  readonly children: string;
  readonly size?: 'small' | 'medium';

  /** Shows a remove button that calls this. */
  readonly onRemove?: (() => void) | undefined;

  readonly className?: string;
};

/** A dialog, drawn inside the package's scope. */
export type ModalProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: ReactNode;
  readonly size?: 'small' | 'medium' | 'large';
  readonly closesOnBackdrop?: boolean;
  readonly children: ReactNode;

  /** Its buttons. */
  readonly footer?: ReactNode;
};

/** What `cn` joins: classes, conditions, lists of them. */
export type ClassValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | readonly ClassValue[]
  | Readonly<Record<string, unknown>>;

/** What the interface lends to implement `/components`. */
export type ComponentsHost = {
  readonly Button: ComponentType<ButtonProps>;
  readonly IconButton: ComponentType<IconButtonProps>;
  readonly Icon: ComponentType<IconProps>;
  readonly Badge: ComponentType<BadgeProps>;
  readonly Panel: ComponentType<PanelProps>;
  readonly PanelRow: ComponentType<PanelRowProps>;
  readonly PanelNote: ComponentType<PanelNoteProps>;
  readonly CardHeading: ComponentType<CardHeadingProps>;
  readonly Figure: ComponentType<FigureProps>;
  readonly StatusDot: ComponentType<StatusDotProps>;
  readonly ProgressBar: ComponentType<ProgressBarProps>;
  readonly Hint: ComponentType<HintProps>;
  readonly TextField: ComponentType<TextFieldProps>;
  readonly SelectField: ComponentType<SelectFieldProps>;
  readonly Switch: ComponentType<SwitchProps>;
  readonly Segmented: ComponentType<SegmentedProps>;
  readonly Slider: ComponentType<SliderProps>;
  readonly Stepper: ComponentType<StepperProps>;
  readonly TagChip: ComponentType<TagChipProps>;
  readonly Modal: ComponentType<ModalProps>;
  readonly cn: (...classes: readonly ClassValue[]) => string;
};

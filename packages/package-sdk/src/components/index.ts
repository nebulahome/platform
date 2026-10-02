/**
 * `@nebulahome/package-sdk/components`: the part of the interface's design system a package may
 * draw with (PACKAGES_DOCS.md 7.1), lent at run time like React. A convenience, never a
 * constraint: a package may draw anything, with any CSS.
 */
import { createElement, type ReactElement } from 'react';

import { COMPONENTS_MODULE, hostMember } from '../host.js';

import type {
  BadgeProps,
  ButtonProps,
  CardHeadingProps,
  ClassValue,
  FigureProps,
  HintProps,
  IconButtonProps,
  IconProps,
  ModalProps,
  PanelNoteProps,
  PanelProps,
  PanelRowProps,
  ProgressBarProps,
  SegmentedProps,
  SelectFieldProps,
  SliderProps,
  StatusDotProps,
  StepperProps,
  SwitchProps,
  TagChipProps,
  TextFieldProps,
} from './types.js';

export type * from './types.js';

/**
 * An action.
 *
 * @param props - A native button's attributes, a variant and a size.
 * @returns The button.
 */
export function Button(props: ButtonProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'Button', '1.0'), props);
}

/**
 * An action with an icon and no text.
 *
 * @param props - What it does, its glyph, its variant and size.
 * @returns The button.
 */
export function IconButton(props: IconButtonProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'IconButton', '1.0'), props);
}

/**
 * A catalogue icon.
 *
 * @param props - Its id and size.
 * @returns The icon.
 */
export function Icon(props: IconProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'Icon', '1.0'), props);
}

/**
 * A short state.
 *
 * @param props - Its tone, size and text.
 * @returns The badge.
 */
export function Badge(props: BadgeProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'Badge', '1.0'), props);
}

/**
 * A titled section.
 *
 * @param props - Its title, action and content.
 * @returns The panel.
 */
export function Panel(props: PanelProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'Panel', '1.0'), props);
}

/**
 * A row of a panel.
 *
 * @param props - Its title, note and control.
 * @returns The row.
 */
export function PanelRow(props: PanelRowProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'PanelRow', '1.0'), props);
}

/**
 * A note under a panel.
 *
 * @param props - What it says.
 * @returns The note.
 */
export function PanelNote(props: PanelNoteProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'PanelNote', '1.0'), props);
}

/**
 * A card's two-line heading, as the dashboard's own cards draw it.
 *
 * @param props - Its title, subtitle and tail.
 * @returns The heading.
 */
export function CardHeading(props: CardHeadingProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'CardHeading', '1.0'), props);
}

/**
 * A reading as a number and its unit.
 *
 * @param props - The number, its unit and size.
 * @returns The figure.
 */
export function Figure(props: FigureProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'Figure', '1.0'), props);
}

/**
 * A state at a glance.
 *
 * @param props - Its tone and meaning.
 * @returns The dot.
 */
export function StatusDot(props: StatusDotProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'StatusDot', '1.0'), props);
}

/**
 * How far something has come.
 *
 * @param props - The percentage and what it is.
 * @returns The bar.
 */
export function ProgressBar(props: ProgressBarProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'ProgressBar', '1.0'), props);
}

/**
 * An explanation behind a small `i`.
 *
 * @param props - The explanation.
 * @returns The hint.
 */
export function Hint(props: HintProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'Hint', '1.0'), props);
}

/**
 * A labelled text input.
 *
 * @param props - An input's attributes, its label and what it says under it.
 * @returns The field.
 */
export function TextField(props: TextFieldProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'TextField', '1.0'), props);
}

/**
 * A labelled choice from a list.
 *
 * @param props - Its label, options and value.
 * @returns The field.
 */
export function SelectField(props: SelectFieldProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'SelectField', '1.0'), props);
}

/**
 * On or off.
 *
 * @param props - Its label and state.
 * @returns The switch.
 */
export function Switch(props: SwitchProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'Switch', '1.0'), props);
}

/**
 * One of a few, side by side.
 *
 * @param props - Its label, options and value.
 * @returns The control.
 */
export function Segmented<TValue extends string>(props: SegmentedProps<TValue>): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'Segmented', '1.0'), {
    ...props,
    /**
     * Hands the choice on, as the value it is.
     *
     * @param value - The choice.
     */
    onChange: (value: string) => {
      const chosen = props.options.find((option) => option.value === value);

      if (chosen !== undefined) {
        props.onChange(chosen.value);
      }
    },
  });
}

/**
 * A value in a range.
 *
 * @param props - Its label, range, value and how it is written.
 * @returns The slider.
 */
export function Slider(props: SliderProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'Slider', '1.0'), props);
}

/**
 * A value by steps.
 *
 * @param props - Its label, range, step and how it is written.
 * @returns The stepper.
 */
export function Stepper(props: StepperProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'Stepper', '1.0'), props);
}

/**
 * A coloured tag.
 *
 * @param props - Its colour and text.
 * @returns The tag.
 */
export function TagChip(props: TagChipProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'TagChip', '1.0'), props);
}

/**
 * A dialog, drawn inside the package's scope.
 *
 * @param props - Whether it is open, its title, content and buttons.
 * @returns The dialog.
 */
export function Modal(props: ModalProps): ReactElement {
  return createElement(hostMember(COMPONENTS_MODULE, 'Modal', '1.0'), props);
}

/**
 * Joins class names, resolving Tailwind conflicts: the later class wins.
 *
 * @param classes - Classes, conditions, lists of them.
 * @returns The class names.
 */
export function cn(...classes: readonly ClassValue[]): string {
  return hostMember(COMPONENTS_MODULE, 'cn', '1.0')(...classes);
}

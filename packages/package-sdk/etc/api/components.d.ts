import { ft as EntityDomain, pt as EntityId } from "./chunks/json.js";
import { l as EntityView } from "./chunks/types.js";
import { ButtonHTMLAttributes, ComponentType, InputHTMLAttributes, ReactElement, ReactNode, SVGProps } from "react";
//#region src/components/types.d.ts
/** What a button does: the one thing a screen is for, anything else, or a destructive action. */
type ButtonVariant = 'primary' | 'ghost' | 'danger';
/** A button's size. */
type ButtonSize = 'compact' | 'medium' | 'large';
/** A button: a native button's attributes, a variant and a size. */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Draws a spinner and refuses presses while true. */
  readonly isBusy?: boolean;
  readonly children: ReactNode;
};
/** A button with an icon and no text, named by `label`. */
type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  readonly variant?: 'bare' | 'danger';
  readonly size?: 'small' | 'medium' | 'large';
  /** What pressing it does, for a screen reader and the tooltip. */
  readonly label: string;
  /** The glyph: an `Icon`. */
  readonly children: ReactNode;
};
/** A catalogue icon, by the ids `icon` fields take. */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'id' | 'width' | 'height' | 'viewBox'> & {
  readonly id: string;
  /** In pixels; 20 when not said. */
  readonly size?: number;
};
/** What a badge means. */
type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
/** A short state. */
type BadgeProps = {
  readonly tone?: BadgeTone;
  readonly size?: 'small' | 'medium';
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
};
/** A titled section. */
type PanelProps = {
  readonly title: string;
  /** `flat` for a panel inside another. */
  readonly elevation?: 'raised' | 'flat';
  /** What sits in the title's row: a button. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
};
/** A row of a panel: a title, a note under it, a control opposite. */
type PanelRowProps = {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly control?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
};
/** A note under a panel. */
type PanelNoteProps = {
  readonly children: ReactNode;
};
/** A card's two-line heading. */
type CardHeadingProps = {
  readonly title: string;
  readonly subtitle?: string | null | undefined;
  /** What sits opposite: a switch, a badge. */
  readonly tail?: ReactNode;
  /** Draws the title quieter, for something that cannot be read. */
  readonly isMuted?: boolean;
};
/** A reading as a number and its unit. */
type FigureProps = {
  /** The number, already written. */
  readonly value: string;
  readonly unit?: string | null | undefined;
  readonly size?: 'large' | 'medium' | 'small';
  /** A colour for the number, when what it measures has one. */
  readonly color?: string | undefined;
};
/** A state at a glance. */
type StatusDotProps = {
  readonly tone: 'success' | 'warning' | 'danger' | 'neutral' | 'accent';
  /** What it means, for the tooltip and a screen reader. */
  readonly title: string;
  /** Pulses while something is being done. */
  readonly isBusy?: boolean;
};
/** How far something has come. */
type ProgressBarProps = {
  /** 0 to 100; null pulses the whole bar. */
  readonly percent: number | null;
  /** What it is, for a screen reader. */
  readonly label: string;
};
/** An explanation behind a small `i`. */
type HintProps = {
  readonly text: string;
  readonly className?: string;
};
/** A labelled text input: an input's attributes, a label, and what it says under it. */
type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'size'> & {
  readonly label: string;
  readonly isLabelHidden?: boolean;
  readonly size?: 'compact' | 'medium' | 'large';
  readonly error?: string | undefined;
  readonly warning?: string | undefined;
  readonly hint?: ReactNode;
};
/** One choice of a select or a segmented control. */
type ControlOption<TValue extends string = string> = {
  readonly value: TValue;
  readonly label: string;
};
/** A labelled choice from a list. */
type SelectFieldProps = {
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
type SwitchProps = {
  readonly label: string;
  readonly isOn: boolean;
  readonly onChange: (isOn: boolean) => void;
  readonly size?: 'small' | 'medium';
  readonly disabled?: boolean;
  readonly isBusy?: boolean;
  readonly className?: string;
};
/** One of a few, side by side. */
type SegmentedProps<TValue extends string = string> = {
  readonly label: string;
  readonly options: readonly ControlOption<TValue>[];
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
  readonly size?: 'compact' | 'medium';
  readonly disabled?: boolean;
  readonly className?: string;
};
/** A value in a range. */
type SliderProps = {
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
type StepperProps = {
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
type TagColor = 'red' | 'orange' | 'amber' | 'yellow' | 'lime' | 'green' | 'teal' | 'cyan' | 'blue' | 'indigo' | 'violet' | 'pink';
/** A coloured tag. */
type TagChipProps = {
  readonly color: TagColor;
  readonly children: string;
  readonly size?: 'small' | 'medium';
  /** Shows a remove button that calls this. */
  readonly onRemove?: (() => void) | undefined;
  readonly className?: string;
};
/** A dialog, drawn inside the package's scope. */
type ModalProps = {
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
/** One icon of the catalogue, chosen from the interface's icon picker. Since SDK 1.7. */
type IconFieldProps = {
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /** The icon's id, or null for none yet. */
  readonly value: string | null;
  /** Called with the id of the icon picked. */
  readonly onChange: (id: string) => void;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
};
/** One entity of the house, chosen from the interface's entity picker. Since SDK 1.7. */
type EntityFieldProps = {
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /** The entity's address, or empty for none yet. */
  readonly value: EntityId;
  /** Called with the address chosen; empty when the field was cleared. */
  readonly onChange: (entityId: EntityId) => void;
  /** Only entities of these domains may be chosen; any of the house when not said. */
  readonly domains?: readonly EntityDomain[] | undefined;
  /**
   * Only entities this says yes to are offered, on top of `domains`: a power sensor in W, say.
   * Since SDK 1.11.
   */
  readonly accept?: ((entity: EntityView) => boolean) | undefined;
  /** Whether it may be left empty, which offers to clear it. */
  readonly isOptional?: boolean;
  readonly size?: 'compact' | 'medium';
  /** What the picker asks: "Which light?". */
  readonly pickerTitle?: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly disabled?: boolean;
};
/**
 * The interface's entity picker on its own: a dialog that finds entities by floor, room and
 * device, or by typing. Since SDK 1.7.
 */
type EntityPickerProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** What the dialog asks; "Which one?" when not said. */
  readonly title?: string;
  /** The addresses already chosen, drawn as chosen when it opens. */
  readonly value?: readonly EntityId[];
  /** Only entities of these domains may be chosen; any of the house when not said. */
  readonly domains?: readonly EntityDomain[] | undefined;
  /** Only entities this says yes to are offered, on top of `domains`. Since SDK 1.11. */
  readonly accept?: ((entity: EntityView) => boolean) | undefined;
  /** Whether several may be chosen at once. */
  readonly isMultiple?: boolean;
  /** Called with the addresses chosen, once the choice is confirmed. */
  readonly onChoose: (entityIds: readonly EntityId[]) => void;
};
/** A box ticked on a form that is saved, or confirmed, later. Since SDK 1.10. */
type CheckboxProps = {
  /** What ticking it says. */
  readonly label: ReactNode;
  /** A line under the label: what it costs or means. */
  readonly note?: ReactNode;
  readonly isChecked: boolean;
  /** Whether it stands for a group partly ticked: drawn with a dash. */
  readonly isMixed?: boolean;
  /** On the right: how many ticking it would show. */
  readonly count?: ReactNode;
  readonly onChange: (isChecked: boolean) => void;
  /** `warning`: ticking it accepts something that asks for care. */
  readonly tone?: 'primary' | 'warning';
  readonly disabled?: boolean;
  readonly className?: string;
};
/** One choice of a radio group. Since SDK 1.10. */
type RadioOption<TValue extends string = string> = {
  readonly value: TValue;
  readonly label: ReactNode;
  /** A line under it: what it means. */
  readonly note?: ReactNode;
};
/** One choice of a few, each with a line saying what it means. Since SDK 1.10. */
type RadioGroupProps<TValue extends string = string> = {
  readonly label: string;
  readonly isLabelHidden?: boolean;
  readonly options: readonly RadioOption<TValue>[];
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
  readonly className?: string;
};
/** A line of words over a control while it is hovered or focused. Since SDK 1.10. */
type TooltipProps = {
  readonly text: string;
  /** Which side it opens towards; over the control when not said, under it without room above. */
  readonly side?: 'top' | 'bottom';
  /**
   * The control it hangs off: one element that takes `aria-describedby`, and has a name of its
   * own - a tooltip adds to a name, it is never the name.
   */
  readonly children: ReactElement<{
    'aria-describedby'?: string | undefined;
  }>;
  /** Extra classes for the bubble. */
  readonly className?: string;
};
/** A run of days, both ends included, as `2026-06-21`: `from` is never after `to`. Since SDK 1.10. */
type DayRange = {
  readonly from: string;
  readonly to: string;
};
/** What one day, or a run of days, is picked with. Since SDK 1.10. */
type DayPick = {
  /** One day; the default. */
  readonly mode?: 'single';
  /** The day picked, `2026-06-21`, or null for none yet. */
  readonly value: string | null;
  /** Called with the day picked, `2026-06-21`. */
  readonly onChange: (day: string) => void;
} | {
  /**
   * A run of days. The first day pressed is where it starts, and stays so: each press after it
   * moves the other end, and pressing it again lets it go. A date field stays open meanwhile.
   */
  readonly mode: 'range';
  /** The run picked, or null for none yet. */
  readonly value: DayRange | null;
  /** Called with the run at every press, or null once its starting day is let go. */
  readonly onChange: (range: DayRange | null) => void;
  /** The most days the run may hold, both ends counted; any when not said. */
  readonly maxDays?: number | undefined;
};
/** A month of days to pick one day, or a run of days, from. Since SDK 1.10. */
type CalendarProps = DayPick & {
  /** The first day that may be picked. */
  readonly min?: string | undefined;
  /** The last day that may be picked. */
  readonly max?: string | undefined;
  readonly className?: string;
};
/** One day, or a run of days, chosen from a calendar the field opens under it. Since SDK 1.10. */
type DateFieldProps = DayPick & {
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /** The first day that may be picked. */
  readonly min?: string | undefined;
  /** The last day that may be picked. */
  readonly max?: string | undefined;
  readonly size?: 'compact' | 'medium' | 'large';
  readonly disabled?: boolean;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
};
/**
 * A name with its icon beside it, under one label: the 44 px icon button that opens the
 * interface's icon picker, and the name's input. Since SDK 1.10.
 */
type NameIconFieldProps = {
  /** What the field is for; "Name" when not said. */
  readonly label?: string;
  /** The name as it stands. */
  readonly value: string;
  /** Called with the name as typed. */
  readonly onChange: (value: string) => void;
  /** The icon's id, or null for none yet. */
  readonly icon: string | null;
  /** Called with the id of the icon picked. */
  readonly onIconChange: (id: string) => void;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  /** Whether the name may not be left blank. */
  readonly required?: boolean;
};
/** What `cn` joins: classes, conditions, lists of them. */
type ClassValue = string | number | bigint | boolean | null | undefined | readonly ClassValue[] | Readonly<Record<string, unknown>>;
/** What the interface lends to implement `/components`. */
type ComponentsHost = {
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
  /** Since 1.7. */
  readonly IconField: ComponentType<IconFieldProps>;
  /** Since 1.7. */
  readonly EntityField: ComponentType<EntityFieldProps>;
  /** Since 1.7. */
  readonly EntityPicker: ComponentType<EntityPickerProps>;
  /** Since 1.10. */
  readonly Checkbox: ComponentType<CheckboxProps>;
  /** Since 1.10. */
  readonly RadioGroup: ComponentType<RadioGroupProps>;
  /** Since 1.10. */
  readonly Tooltip: ComponentType<TooltipProps>;
  /** Since 1.10. */
  readonly Calendar: ComponentType<CalendarProps>;
  /** Since 1.10. */
  readonly DateField: ComponentType<DateFieldProps>;
  /** Since 1.10. */
  readonly NameIconField: ComponentType<NameIconFieldProps>;
  readonly cn: (...classes: readonly ClassValue[]) => string;
};
//#endregion
//#region src/components/index.d.ts
/**
 * An action.
 *
 * @param props - A native button's attributes, a variant and a size.
 * @returns The button.
 */
export declare function Button(props: ButtonProps): ReactElement;
/**
 * An action with an icon and no text.
 *
 * @param props - What it does, its glyph, its variant and size.
 * @returns The button.
 */
export declare function IconButton(props: IconButtonProps): ReactElement;
/**
 * A catalogue icon.
 *
 * @param props - Its id and size.
 * @returns The icon.
 */
export declare function Icon(props: IconProps): ReactElement;
/**
 * A short state.
 *
 * @param props - Its tone, size and text.
 * @returns The badge.
 */
export declare function Badge(props: BadgeProps): ReactElement;
/**
 * A titled section.
 *
 * @param props - Its title, action and content.
 * @returns The panel.
 */
export declare function Panel(props: PanelProps): ReactElement;
/**
 * A row of a panel.
 *
 * @param props - Its title, note and control.
 * @returns The row.
 */
export declare function PanelRow(props: PanelRowProps): ReactElement;
/**
 * A note under a panel.
 *
 * @param props - What it says.
 * @returns The note.
 */
export declare function PanelNote(props: PanelNoteProps): ReactElement;
/**
 * A card's two-line heading, as the dashboard's own cards draw it.
 *
 * @param props - Its title, subtitle and tail.
 * @returns The heading.
 */
export declare function CardHeading(props: CardHeadingProps): ReactElement;
/**
 * A reading as a number and its unit.
 *
 * @param props - The number, its unit and size.
 * @returns The figure.
 */
export declare function Figure(props: FigureProps): ReactElement;
/**
 * A state at a glance.
 *
 * @param props - Its tone and meaning.
 * @returns The dot.
 */
export declare function StatusDot(props: StatusDotProps): ReactElement;
/**
 * How far something has come.
 *
 * @param props - The percentage and what it is.
 * @returns The bar.
 */
export declare function ProgressBar(props: ProgressBarProps): ReactElement;
/**
 * An explanation behind a small `i`.
 *
 * @param props - The explanation.
 * @returns The hint.
 */
export declare function Hint(props: HintProps): ReactElement;
/**
 * A labelled text input.
 *
 * @param props - An input's attributes, its label and what it says under it.
 * @returns The field.
 */
export declare function TextField(props: TextFieldProps): ReactElement;
/**
 * A labelled choice from a list.
 *
 * @param props - Its label, options and value.
 * @returns The field.
 */
export declare function SelectField(props: SelectFieldProps): ReactElement;
/**
 * On or off.
 *
 * @param props - Its label and state.
 * @returns The switch.
 */
export declare function Switch(props: SwitchProps): ReactElement;
/**
 * One of a few, side by side.
 *
 * @param props - Its label, options and value.
 * @returns The control.
 */
export declare function Segmented<TValue extends string>(props: SegmentedProps<TValue>): ReactElement;
/**
 * A value in a range.
 *
 * @param props - Its label, range, value and how it is written.
 * @returns The slider.
 */
export declare function Slider(props: SliderProps): ReactElement;
/**
 * A value by steps.
 *
 * @param props - Its label, range, step and how it is written.
 * @returns The stepper.
 */
export declare function Stepper(props: StepperProps): ReactElement;
/**
 * A coloured tag.
 *
 * @param props - Its colour and text.
 * @returns The tag.
 */
export declare function TagChip(props: TagChipProps): ReactElement;
/**
 * A dialog, drawn inside the package's scope.
 *
 * @param props - Whether it is open, its title, content and buttons.
 * @returns The dialog.
 */
export declare function Modal(props: ModalProps): ReactElement;
/**
 * One icon of the catalogue, chosen with the interface's icon picker: a button with the icon,
 * opening a searchable grid of the catalogue under it.
 *
 * @param props - Its label and the icon's id.
 * @returns The field.
 */
export declare function IconField(props: IconFieldProps): ReactElement;
/**
 * One entity of the house, chosen with the interface's entity picker: a field showing the
 * entity, opening the picker when pressed.
 *
 * @param props - Its label, the entity's address and the domains it may be chosen from.
 * @returns The field.
 */
export declare function EntityField(props: EntityFieldProps): ReactElement;
/**
 * The interface's entity picker, for one entity or several: a dialog that finds them by floor,
 * room and device, or by typing.
 *
 * @param props - Whether it is open, what is chosen, and what may be.
 * @returns The dialog.
 */
export declare function EntityPicker(props: EntityPickerProps): ReactElement;
/**
 * A box ticked on a form that is saved, or confirmed, later - where a `Switch` is an action that
 * happens now. Since 1.10.
 *
 * @param props - Its label, whether it is ticked, and what ticking it does.
 * @returns The labelled box.
 */
export declare function Checkbox(props: CheckboxProps): ReactElement;
/**
 * One choice of a few, each with a line saying what it means. Since 1.10.
 *
 * @param props - Its label, options and value.
 * @returns The group.
 */
export declare function RadioGroup<TValue extends string>(props: RadioGroupProps<TValue>): ReactElement;
/**
 * A line of words over a control while it is hovered or focused. Since 1.10.
 *
 * @param props - What it says, which side it opens towards, and the control it hangs off.
 * @returns The control, and the bubble while it shows.
 */
export declare function Tooltip(props: TooltipProps): ReactElement;
/**
 * A month of days to pick one day from, as a plain `2026-06-21` - or, with `mode="range"`, a run
 * of days, at most `maxDays` long. Since 1.10.
 *
 * @param props - What is picked, and the first and last day that may be.
 * @returns The calendar.
 */
export declare function Calendar(props: CalendarProps): ReactElement;
/**
 * One day, or with `mode="range"` a run of days, chosen from a calendar: a field saying it in
 * words, opening the calendar under it. Since 1.10.
 *
 * @param props - Its label, what is picked, and the first and last day that may be.
 * @returns The field.
 */
export declare function DateField(props: DateFieldProps): ReactElement;
/**
 * A name with its icon beside it, under one label: the interface's icon button and picker, and
 * the name's input. Since 1.10.
 *
 * @param props - The name, the icon's id, and what changes each.
 * @returns The field.
 */
export declare function NameIconField(props: NameIconFieldProps): ReactElement;
/**
 * Joins class names, resolving Tailwind conflicts: the later class wins.
 *
 * @param classes - Classes, conditions, lists of them.
 * @returns The class names.
 */
export declare function cn(...classes: readonly ClassValue[]): string;
//#endregion
export type { BadgeProps, BadgeTone, ButtonProps, ButtonSize, ButtonVariant, CalendarProps, CardHeadingProps, CheckboxProps, ClassValue, ComponentsHost, ControlOption, DateFieldProps, DayPick, DayRange, EntityFieldProps, EntityPickerProps, FigureProps, HintProps, IconButtonProps, IconFieldProps, IconProps, ModalProps, NameIconFieldProps, PanelNoteProps, PanelProps, PanelRowProps, ProgressBarProps, RadioGroupProps, RadioOption, SegmentedProps, SelectFieldProps, SliderProps, StatusDotProps, StepperProps, SwitchProps, TagChipProps, TagColor, TextFieldProps, TooltipProps };
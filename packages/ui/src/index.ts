/**
 * Public entry point of the NebulaHome design system.
 *
 * Only what more than one screen uses lives here. A component a single page needs belongs to
 * that page until a second one wants it - a design system assembled in advance is a set of
 * guesses about screens nobody has drawn yet.
 *
 * What is here arrived by that rule rather than in advance of it: every one of these was already
 * being used by several screens from inside the application, where the settings section and the
 * authentication screens had each grown their own copy of the same idea. Moving them out is what
 * makes a change to a badge a change to every badge.
 *
 * `PasswordField` is deliberately *not* exported: it knows the password rules, which are a
 * product decision rather than a shape, so it stays in the application.
 *
 * Icons are exported, but as ids rather than glyphs. Every icon the interface shows is a
 * catalogue icon drawn by `CatalogueIcon`; the ones the chrome itself uses are the ids in
 * `UI_ICON_IDS`, each bundled with its drawing so the sign-in page has a lock before anybody has
 * signed in, and replaced by the catalogue's answer once somebody has. Nothing here draws a
 * glyph of its own.
 */
export { AppIcon, type AppIconProps } from './components/app-icon.js';
export { Badge, type BadgeProps, type BadgeTone } from './components/badge.js';
export {
  ColorWheel,
  colourAt,
  wheelColour,
  type ColorWheelProps,
  type WheelColour,
} from './components/color-wheel.js';
export { Button, type ButtonProps } from './components/button.js';
export { CardHeading, type CardHeadingProps } from './components/card-heading.js';
export { CatalogueIcon, type CatalogueIconProps } from './components/catalogue-icon.js';
export { ColorSwatches, type ColorSwatchesProps } from './components/color-swatches.js';
export { FieldShell, type FieldIds, type FieldShellProps } from './components/field-shell.js';
export { Figure, type FigureProps } from './components/figure.js';
export { Hint, type HintProps, type HintSide } from './components/hint.js';
export { IconButton, type IconButtonProps } from './components/icon-button.js';
export { Logo, type LogoProps } from './components/logo.js';
export { Modal, type ModalProps } from './components/modal.js';
export { Panel, type PanelProps } from './components/panel.js';
export { PanelNote, type PanelNoteProps } from './components/panel-note.js';
export { PanelRow, type PanelRowProps } from './components/panel-row.js';
export { ProgressBar, type ProgressBarProps } from './components/progress-bar.js';
export { Segmented, type SegmentedOption, type SegmentedProps } from './components/segmented.js';
export { Slider, sliderPercent, type SliderProps } from './components/slider.js';
export { StatusDot, type StatusDotProps, type StatusDotTone } from './components/status-dot.js';
export { Stepper, stepValue, type StepperProps } from './components/stepper.js';
export { Switch, type SwitchProps } from './components/switch.js';
export {
  SelectField,
  type SelectFieldProps,
  type SelectOption,
} from './components/select-field.js';
export { TagChip, type TagChipProps } from './components/tag-chip.js';
export { TextField, type TextFieldProps } from './components/text-field.js';
export { TAG_FILL_CLASSES } from './lib/tag-colors.js';
export {
  IconOverridesProvider,
  useIconOverride,
  type IconDrawing,
  type IconOverrides,
  type IconOverridesProviderProps,
} from './icons/icon-overrides.js';
export { BUILTIN_UI_FRAME, BUILTIN_UI_NODES, UI_ICON_IDS, type UiIconId } from './icons/ui-set.js';
export {
  hostFor,
  placeUnder,
  useAnchoredPlacement,
  type AnchoredList,
  type Placement,
} from './lib/anchored-list.js';
export { cn } from './lib/cn.js';
export { controlFace, type ControlFaceVariants } from './lib/control-face.js';

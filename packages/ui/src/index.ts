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
 * Two things are deliberately *not* exported. `PasswordField` stays in the application because it
 * knows the password rules, which are a product decision rather than a shape. The icon set stays
 * there too: a design system that owns the glyphs starts owning the vocabulary of the screens as
 * well, and the one glyph a control here needs is drawn in the file that needs it.
 */
export { Badge, type BadgeProps, type BadgeTone } from './components/badge.js';
export { Button, type ButtonProps } from './components/button.js';
export { FieldShell, type FieldIds, type FieldShellProps } from './components/field-shell.js';
export { IconButton, type IconButtonProps } from './components/icon-button.js';
export { Logo, type LogoProps } from './components/logo.js';
export { Modal, type ModalProps } from './components/modal.js';
export { Panel, type PanelProps } from './components/panel.js';
export { PanelNote, type PanelNoteProps } from './components/panel-note.js';
export { PanelRow, type PanelRowProps } from './components/panel-row.js';
export { Segmented, type SegmentedOption, type SegmentedProps } from './components/segmented.js';
export {
  SelectField,
  type SelectFieldProps,
  type SelectOption,
} from './components/select-field.js';
export { TextField, type TextFieldProps } from './components/text-field.js';
export { cn } from './lib/cn.js';
export { controlFace, type ControlFaceVariants } from './lib/control-face.js';

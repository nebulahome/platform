/**
 * The facade props against the design system's own: whatever a package passes through the SDK,
 * the interface's component accepts.
 */
import type { ComponentProps } from 'react';
import { describe, expectTypeOf, it } from 'vitest';

import type * as Ui from '@nebulahome/ui';

import type {
  BadgeProps,
  ButtonProps,
  CardHeadingProps,
  FigureProps,
  HintProps,
  IconButtonProps,
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

describe('the facade props', () => {
  it('are accepted by the design system’s components', () => {
    expectTypeOf<ButtonProps>().toExtend<ComponentProps<typeof Ui.Button>>();
    expectTypeOf<IconButtonProps>().toExtend<ComponentProps<typeof Ui.IconButton>>();
    expectTypeOf<BadgeProps>().toExtend<ComponentProps<typeof Ui.Badge>>();
    expectTypeOf<PanelProps>().toExtend<ComponentProps<typeof Ui.Panel>>();
    expectTypeOf<PanelRowProps>().toExtend<ComponentProps<typeof Ui.PanelRow>>();
    expectTypeOf<PanelNoteProps>().toExtend<ComponentProps<typeof Ui.PanelNote>>();
    expectTypeOf<CardHeadingProps>().toExtend<ComponentProps<typeof Ui.CardHeading>>();
    expectTypeOf<FigureProps>().toExtend<ComponentProps<typeof Ui.Figure>>();
    expectTypeOf<StatusDotProps>().toExtend<ComponentProps<typeof Ui.StatusDot>>();
    expectTypeOf<ProgressBarProps>().toExtend<ComponentProps<typeof Ui.ProgressBar>>();
    expectTypeOf<HintProps>().toExtend<ComponentProps<typeof Ui.Hint>>();
    expectTypeOf<TextFieldProps>().toExtend<ComponentProps<typeof Ui.TextField>>();
    expectTypeOf<SelectFieldProps>().toExtend<ComponentProps<typeof Ui.SelectField>>();
    expectTypeOf<SwitchProps>().toExtend<ComponentProps<typeof Ui.Switch>>();
    expectTypeOf<SegmentedProps>().toExtend<Ui.SegmentedProps<string>>();
    expectTypeOf<SliderProps>().toExtend<ComponentProps<typeof Ui.Slider>>();
    expectTypeOf<StepperProps>().toExtend<ComponentProps<typeof Ui.Stepper>>();
    expectTypeOf<TagChipProps>().toExtend<ComponentProps<typeof Ui.TagChip>>();
    expectTypeOf<ModalProps>().toExtend<ComponentProps<typeof Ui.Modal>>();
  });
});

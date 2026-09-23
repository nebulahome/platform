/**
 * The member state fields: toggling on/off and dragging level rewrite the target state.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CapabilityState } from '@nebula-home/contracts';

import { SceneMemberFields } from './scene-member-fields';

describe('SceneMemberFields', () => {
  it('toggles on_off and reports the new target state', () => {
    const onChange = vi.fn<(targetState: CapabilityState) => void>();

    render(
      <SceneMemberFields
        targetState={{ on_off: { isOn: false }, level: { level: 40 } }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'On' }));

    expect(onChange).toHaveBeenCalledWith({
      on_off: { isOn: true },
      level: { level: 40 },
    });
  });

  it('moves the level range and reports the new target state', () => {
    const onChange = vi.fn<(targetState: CapabilityState) => void>();

    render(
      <SceneMemberFields
        targetState={{ on_off: { isOn: true }, level: { level: 40 } }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '75' } });

    expect(onChange).toHaveBeenCalledWith({
      on_off: { isOn: true },
      level: { level: 75 },
    });
  });
});

/**
 * A robot mower's block, a setting picked from a list and a setting that is a number: what each
 * offers for the state it is in, and what it sends.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CapabilityState, EntityView } from '@nebulahome/contracts';

import { LawnMowerControl } from '@/routes/library/entity/controls/lawn-mower-control';
import { NumberControl } from '@/routes/library/entity/controls/number-control';
import { SelectControl } from '@/routes/library/entity/controls/select-control';
import { VacuumControl } from '@/routes/library/entity/controls/vacuum-control';
import type { EntityCommander } from '@/routes/library/entity/use-entity-command';
import { anEntity } from '@/testing/fixtures';

/**
 * A commander that records what it was asked.
 *
 * @returns The commander, and its `send`.
 */
function commander(): {
  readonly commander: EntityCommander;
  readonly send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();

  return {
    send,
    commander: { send, busy: new Set(), problem: null },
  };
}

/**
 * The props a control is drawn with.
 *
 * @param entity - The entity.
 * @param state - Its state.
 * @param given - The commander.
 * @returns The props.
 */
function propsOf(
  entity: EntityView,
  state: CapabilityState,
  given: ReturnType<typeof commander>,
): Parameters<typeof LawnMowerControl>[0] {
  return { entity, state, reportedAt: null, commander: given.commander, disabled: false };
}

/** A GOAT, as its bundle declares it. */
const MOWER = anEntity({
  entityId: 'lawn_mower.ecovacs_goat_g1_800_mower',
  domain: 'lawn_mower',
  name: 'Mower',
  capabilities: [
    { capability: 'lawn_mower', params: { canPause: true, canStop: true, canDock: true } },
  ],
});

describe('LawnMowerControl', () => {
  it('starts a docked mower, and has nothing to pause or send home', () => {
    const given = commander();

    render(
      <LawnMowerControl
        {...propsOf(MOWER, { lawn_mower: { activity: 'docked', isResumable: false } }, given)}
      />,
    );

    expect(screen.getByText('In its station')).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pause' }).disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Back to station' }).disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'End job' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Start mowing' }));

    expect(given.send).toHaveBeenCalledWith('lawn_mower', { command: 'start' });
  });

  it('resumes a paused job, and ends one only once asked twice', () => {
    const given = commander();

    render(
      <LawnMowerControl
        {...propsOf(MOWER, { lawn_mower: { activity: 'paused', isResumable: false } }, given)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'End job' }));

    expect(given.send).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('from the beginning');

    fireEvent.click(screen.getByRole('button', { name: 'End the job?' }));

    expect(given.send).toHaveBeenCalledWith('lawn_mower', { command: 'stop' });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDefined();
  });

  it('carries on a job a fault stopped, rather than mowing the lawn again', () => {
    const given = commander();
    const goat = anEntity({
      ...MOWER,
      capabilities: [
        {
          capability: 'lawn_mower',
          params: { canPause: true, canStop: true, canDock: true, canResume: true },
        },
      ],
    });

    render(
      <LawnMowerControl
        {...propsOf(goat, { lawn_mower: { activity: 'error', isResumable: true } }, given)}
      />,
    );

    expect(screen.getByText('Stopped by a fault')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Start mowing' })).toBeNull();
    expect(screen.getByRole('button', { name: 'End job' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    expect(given.send).toHaveBeenCalledWith('lawn_mower', { command: 'resume' });
  });

  it('starts a mower a fault stopped with no job to carry on', () => {
    const given = commander();

    render(
      <LawnMowerControl
        {...propsOf(MOWER, { lawn_mower: { activity: 'error', isResumable: true } }, given)}
      />,
    );

    // It declared no resume of its own: there is nothing but a start to offer.
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'End job' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start mowing' })).toBeDefined();
  });
});

describe('VacuumControl', () => {
  const DEEBOT = anEntity({
    entityId: 'vacuum.ecovacs_deebot_x1_omni_vacuum',
    domain: 'vacuum',
    name: 'Vacuum',
    capabilities: [
      {
        capability: 'vacuum',
        params: {
          canPause: true,
          canStop: true,
          canDock: true,
          canLocate: true,
          canCleanRooms: true,
          canResume: true,
        },
      },
    ],
  });

  it('carries on a job a fault stopped, and still ends it', () => {
    const given = commander();

    render(
      <VacuumControl
        {...propsOf(DEEBOT, { vacuum: { activity: 'error', rooms: [], isResumable: true } }, given)}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Clean everywhere' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    fireEvent.click(screen.getByRole('button', { name: 'End job' }));

    expect(given.send).toHaveBeenNthCalledWith(1, 'vacuum', { command: 'resume' });
    expect(given.send).toHaveBeenNthCalledWith(2, 'vacuum', { command: 'stop' });
  });

  it('cleans everywhere once the job is over', () => {
    const given = commander();

    render(
      <VacuumControl
        {...propsOf(
          DEEBOT,
          { vacuum: { activity: 'error', rooms: [], isResumable: false } },
          given,
        )}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clean everywhere' }));

    expect(given.send).toHaveBeenCalledWith('vacuum', { command: 'start' });
  });
});

describe('SelectControl', () => {
  const EFFICIENCY = anEntity({
    entityId: 'select.goat_mowing_efficiency',
    domain: 'select',
    name: 'Mowing efficiency',
    capabilities: [
      {
        capability: 'select',
        params: {
          options: [
            { value: 'quick', label: 'Quick' },
            { value: 'delicate', label: 'Delicate' },
          ],
        },
      },
    ],
  });

  it('shows a short list in sight, and sends the choice', () => {
    const given = commander();

    render(<SelectControl {...propsOf(EFFICIENCY, { select: { option: 'quick' } }, given)} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Delicate' }));

    expect(given.send).toHaveBeenCalledWith('select', {
      command: 'select_option',
      option: 'delicate',
    });
  });
});

describe('NumberControl', () => {
  it('steps a short range, in the entity’s unit', () => {
    const given = commander();
    const angle = anEntity({
      entityId: 'number.goat_cut_direction',
      domain: 'number',
      name: 'Cut direction',
      unitOfMeasurement: '°',
      capabilities: [{ capability: 'number', params: { min: 0, max: 180, step: 15 } }],
    });

    render(<NumberControl {...propsOf(angle, { number: { value: 90 } }, given)} />);

    expect(screen.getAllByText('90°').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Raise Cut direction' }));

    expect(given.send).toHaveBeenCalledWith('number', { command: 'set_value', value: 105 });
  });
});

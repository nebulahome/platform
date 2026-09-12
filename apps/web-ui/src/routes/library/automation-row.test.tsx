/**
 * One automation, as the list draws it.
 *
 * The case that matters most is the malformed one. `definition` is a `jsonb` column that existed
 * before anything validated it, so a row written by an earlier build — or by hand, or by a
 * migration — can hold anything at all. A row that throws on it takes the whole list down with
 * it, and the page then shows nothing rather than showing the other nine automations, which is
 * the failure people report as "automations is broken".
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { entityIdSchema, type AutomationView } from '@nebula-home/contracts';

import { AutomationRow } from './automation-row';

/**
 * An entity address, as the type system insists on having one.
 *
 * @param value - The address.
 * @returns The same address, as an address.
 */
const entity = (value: string) => entityIdSchema.parse(value);

/** A rule that says something. */
const AUTOMATION: AutomationView = {
  id: '00000000-0000-4000-8000-000000000001',
  key: 'evening_lights',
  name: 'Evening lights',
  description: '',
  definition: {
    triggers: [{ type: 'time', at: { kind: 'solar', event: 'sunset', offsetMinutes: -15 } }],
    conditions: [{ type: 'state', entityId: entity('person.mattia'), state: 'home' }],
    actions: [
      {
        type: 'command',
        entityId: entity('light.hallway_ceiling'),
        capability: 'on_off',
        params: {},
      },
    ],
  },
  definitionVersion: 1,
  mode: 'single',
  maxRuntimeMs: 300_000,
  isEnabled: true,
  lastTriggeredAt: null,
};

/**
 * Renders one row with the handlers stubbed.
 *
 * @param automation - What to draw.
 * @returns The two handlers, for asserting against.
 */
function renderRow(automation: AutomationView) {
  const onToggle = vi.fn();
  const onDelete = vi.fn();

  render(
    <AutomationRow
      automation={automation}
      isBusy={false}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  );

  return { onToggle, onDelete };
}

describe('AutomationRow', () => {
  it('reads the whole chain on one line', () => {
    renderRow(AUTOMATION);

    expect(screen.getByText('15 min before sunset')).toBeTruthy();
    expect(screen.getByText('1 condition')).toBeTruthy();
    expect(screen.getByText('on_off hallway ceiling')).toBeTruthy();
  });

  it('offers to turn off what is on, and says which it is', () => {
    const { onToggle } = renderRow(AUTOMATION);
    const button = screen.getByRole('button', { name: 'Turn off' });

    // Announced as well as drawn: the label says what pressing it does and `aria-pressed` says
    // what state it is in, which are two different questions.
    expect(button.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(button);

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('offers to turn on what is off', () => {
    const { onToggle } = renderRow({ ...AUTOMATION, isEnabled: false });

    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(onToggle).toHaveBeenCalledWith(true);
    expect(screen.getByText('Off')).toBeTruthy();
  });

  it('says a rule has never run rather than leaving the column empty', () => {
    renderRow(AUTOMATION);

    expect(screen.getByText('never run')).toBeTruthy();
  });

  it('does not offer to run one, because nothing would', () => {
    renderRow(AUTOMATION);

    // The engine is not built. A Run button here would post to an endpoint that does not exist.
    expect(screen.queryByRole('button', { name: /run/i })).toBeNull();
  });

  it('draws a row whose definition it cannot read, instead of taking the list down', () => {
    renderRow({ ...AUTOMATION, definition: { nonsense: true } });

    expect(screen.getByText('Evening lights')).toBeTruthy();
    expect(screen.getByText(/not in a shape this build understands/)).toBeTruthy();
  });

  it('survives a definition that is not even an object', () => {
    expect(() => {
      renderRow({ ...AUTOMATION, definition: {} });
    }).not.toThrow();
  });
});

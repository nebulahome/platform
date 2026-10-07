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
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { entityIdSchema, type AutomationView } from '@nebulahome/contracts';

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
  const onEdit = vi.fn();
  const onToggle = vi.fn();
  const onDelete = vi.fn();

  render(
    <MemoryRouter>
      <AutomationRow
        automation={automation}
        isBusy={false}
        onEdit={onEdit}
        onToggle={onToggle}
        onDelete={onDelete}
      />
    </MemoryRouter>,
  );

  return { onEdit, onToggle, onDelete };
}

describe('AutomationRow', () => {
  it('reads the whole chain on one line', () => {
    renderRow(AUTOMATION);

    expect(screen.getAllByText('15 min before sunset').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 condition').length).toBeGreaterThan(0);
    expect(screen.getAllByText('on_off hallway ceiling').length).toBeGreaterThan(0);
  });

  it('turns it off from its switch, which says whether it is on', () => {
    const { onToggle } = renderRow(AUTOMATION);
    const enabled = screen.getByRole('switch', { name: 'Evening lights enabled' });

    expect(enabled.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(enabled);

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('turns on what is off', () => {
    const { onToggle } = renderRow({ ...AUTOMATION, isEnabled: false });

    fireEvent.click(screen.getByRole('switch', { name: 'Evening lights enabled' }));

    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('opens the rule from its name, and edits or deletes it from its menu', () => {
    const { onEdit } = renderRow(AUTOMATION);

    expect(screen.getByRole('link', { name: 'Evening lights' }).getAttribute('href')).toBe(
      '/automations/00000000-0000-4000-8000-000000000001',
    );

    fireEvent.click(screen.getByRole('button', { name: 'More for Evening lights' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('says a rule has never run rather than leaving the column empty', () => {
    renderRow(AUTOMATION);

    expect(screen.getAllByText('Not run yet').length).toBeGreaterThan(0);
  });

  it('does not offer to run one, because nothing would', () => {
    renderRow(AUTOMATION);

    // The engine is not built. A Run button here would post to an endpoint that does not exist.
    expect(screen.queryByRole('button', { name: /run/i })).toBeNull();
  });

  it('draws a row whose definition it cannot read, instead of taking the list down', () => {
    renderRow({ ...AUTOMATION, definition: { nonsense: true } });

    expect(screen.getByText('Evening lights')).toBeTruthy();
    expect(screen.getAllByText(/not in a shape this build understands/).length).toBeGreaterThan(0);
  });

  it('survives a definition that is not even an object', () => {
    expect(() => {
      renderRow({ ...AUTOMATION, definition: {} });
    }).not.toThrow();
  });
});

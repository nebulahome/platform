/**
 * The Then blocks: a block clicked is selected and lights the blocks inside it; a field, a
 * switch or a button inside it is the field's, not a selection; Escape lets it go. And the blocks
 * that hold others draw their branches and add to them.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type AutomationAction } from '@nebulahome/contracts';

import { BlockSelectionProvider } from '@/lib/block-selection';

import { ActionList } from './action-blocks';

/** An if/else that turns a lamp on, or else waits. */
const IF_ELSE: AutomationAction = {
  type: 'if',
  condition: {
    type: 'numeric',
    entityId: entityIdSchema.parse('sensor.lux'),
    operator: 'lt',
    value: 50,
  },
  then: [{ type: 'scene', sceneKey: 'evening' }],
  else: [{ type: 'wait_duration', durationMs: 60_000 }],
};

/**
 * The list, holding its own actions as the editor does.
 *
 * @param props - What it starts with.
 * @param props.initial - The actions.
 * @returns The list.
 */
function Harness(props: { readonly initial: readonly AutomationAction[] }) {
  const [actions, setActions] = useState(props.initial);

  return (
    <ActionList
      actions={actions}
      onChange={(next) => {
        setActions(next);
      }}
    />
  );
}

/**
 * Renders the list inside the editor's providers.
 *
 * @param actions - What it starts with.
 */
function renderList(actions: readonly AutomationAction[]): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  client.setQueryData(['library', 'entities'], []);

  render(
    <QueryClientProvider client={client}>
      <BlockSelectionProvider>
        <Harness initial={actions} />
      </BlockSelectionProvider>
    </QueryClientProvider>,
  );
}

/**
 * The block whose kind reads a label.
 *
 * @param kind - The kind, as the card reads it.
 * @returns The block element.
 * @throws {Error} When no block reads it.
 */
function blockOf(kind: string): HTMLElement {
  const label = screen.getAllByText(kind)[0];
  const block = label?.closest('[data-block]');

  if (!(block instanceof HTMLElement)) {
    throw new Error(`No block reads ${kind}`);
  }

  return block;
}

describe('selecting a block', () => {
  it('selects the block whose title is clicked, and lights its branches', () => {
    renderList([IF_ELSE]);

    const block = blockOf('If / else');

    expect(block.hasAttribute('data-selected')).toBe(false);
    fireEvent.click(screen.getByText(/^If Sensor lux|^If Lux/u));
    expect(blockOf('If / else').hasAttribute('data-selected')).toBe(true);
  });

  it('selects only the innermost block a click lands in', () => {
    renderList([IF_ELSE]);

    fireEvent.click(screen.getByText('Evening'));

    expect(blockOf('Apply a scene').hasAttribute('data-selected')).toBe(true);
    expect(blockOf('If / else').hasAttribute('data-selected')).toBe(false);
  });

  it('leaves the selection alone when a control inside the block is used', () => {
    renderList([IF_ELSE]);

    fireEvent.click(screen.getByText('Evening'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove else' }));

    expect(blockOf('Apply a scene').hasAttribute('data-selected')).toBe(true);
  });

  it('lets the selection go on Escape', () => {
    renderList([IF_ELSE]);

    fireEvent.click(screen.getByText('Evening'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(blockOf('Apply a scene').hasAttribute('data-selected')).toBe(false);
  });
});

describe('the blocks that hold others', () => {
  it('draws Then and Else, and takes else away', () => {
    renderList([IF_ELSE]);

    expect(screen.getByText('Then')).toBeTruthy();
    expect(screen.getByText('Else')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove else' }));

    expect(screen.queryByText('Else')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add else' })).toBeTruthy();
  });

  it('adds a case to a switch, under Otherwise', () => {
    renderList([
      {
        type: 'switch',
        entityId: entityIdSchema.parse('select.washer'),
        cases: [{ value: 'done', actions: [] }],
      },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Add a case' }));

    expect(screen.getAllByText(/^When "/u)).toHaveLength(2);
    expect(screen.getByText('Otherwise')).toBeTruthy();
  });

  it('adds a block from the picker at the foot of a branch', () => {
    renderList([IF_ELSE]);

    fireEvent.click(screen.getByRole('button', { name: 'Add to else' }));
    fireEvent.click(screen.getByRole('option', { name: /End this run/u }));

    expect(screen.getAllByText('End this run').length).toBeGreaterThan(0);
  });

  it('says a block the engine cannot run yet is not available', () => {
    renderList([{ type: 'notify', channel: 'push', message: 'Hello' }]);

    expect(screen.getByText(/not available yet/u)).toBeTruthy();
  });
});

/**
 * The Then blocks: a block clicked is selected and lights the blocks inside it; a field, a
 * switch or a button inside it is the field's, not a selection; Escape lets it go. The blocks
 * that hold others draw their branches and add to them; every block's ⋯ menu renames it and turns
 * it off; and a block moved with the keyboard walks into the branches of the block beside it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type AutomationAction } from '@nebulahome/contracts';

import { BlockDragProvider } from '@/lib/block-drag';
import { BlockUiProvider } from '@/lib/block-ui';
import { emptyDraft, type AutomationDraft } from '@/library/automation-draft';
import { moveBlock, stepBlock } from '@/library/block-path';

import { ActionList } from './action-blocks';

/** An if/else that applies a scene, or else waits. */
const IF_ELSE: AutomationAction = {
  type: 'if',
  conditions: [
    {
      type: 'entity',
      entityId: entityIdSchema.parse('sensor.lux'),
      match: { kind: 'numeric', operator: 'lt', value: 50 },
    },
  ],
  then: [{ type: 'scene', sceneKey: 'evening' }],
  else: [{ type: 'wait_duration', durationMs: 60_000 }],
};

/** The blocks as they now stand, for a test to read. */
const seen: { then: readonly AutomationAction[] } = { then: [] };

/**
 * The list, holding a draft as the editor does, with the editor's way of moving blocks.
 *
 * @param props - What it starts with.
 * @param props.initial - The blocks.
 * @returns The list.
 */
function Harness(props: { readonly initial: readonly AutomationAction[] }) {
  const [draft, setDraft] = useState<AutomationDraft>({ ...emptyDraft(), then: props.initial });

  useEffect(() => {
    seen.then = draft.then;
  });

  return (
    <BlockDragProvider
      onMove={(from, to) => {
        setDraft((current) => moveBlock(current, from, to) ?? current);
      }}
      onStep={(from, step) => {
        const stepped = stepBlock(draft, from, step);

        if (stepped !== null) {
          setDraft(stepped.draft);
        }

        return stepped?.at ?? null;
      }}
    >
      <ActionList
        items={draft.then}
        path="then"
        onChange={(then) => {
          setDraft({ ...draft, then });
        }}
      />
    </BlockDragProvider>
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
      <BlockUiProvider>
        <Harness initial={actions} />
      </BlockUiProvider>
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

    expect(blockOf('If / else').hasAttribute('data-selected')).toBe(false);
    fireEvent.click(screen.getByText(/^If Lux below 50/u));
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
  it('draws its conditions, Then and Else, and takes else away', () => {
    renderList([IF_ELSE]);

    expect(screen.getByText('Conditions')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a condition' })).toBeTruthy();
    expect(screen.getByText('Then')).toBeTruthy();
    expect(screen.getByText('Else')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove else' }));

    expect(screen.queryByText('Else')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add else' })).toBeTruthy();
    expect(seen.then[0]).not.toHaveProperty('else');
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

  it('calls the Add of a list "Add a block"', () => {
    renderList([]);

    expect(screen.getByRole('button', { name: 'Add a block' })).toBeTruthy();
  });

  it('gives a parallel block a branch, each its own list', () => {
    renderList([{ type: 'parallel', branches: [[{ type: 'stop' }], []] }]);

    fireEvent.click(screen.getByRole('button', { name: 'Add a branch' }));

    expect(screen.getByText('Branch 3')).toBeTruthy();
    expect(seen.then[0]).toEqual({ type: 'parallel', branches: [[{ type: 'stop' }], [], []] });
  });

  it('says a block the engine cannot run yet is not available', () => {
    renderList([{ type: 'notify', channel: 'push', message: 'Hello' }]);

    expect(screen.getByText(/not available yet/u)).toBeTruthy();
  });
});

describe('the ⋯ menu', () => {
  it('renames a block, which then reads as its name', () => {
    renderList([{ type: 'scene', sceneKey: 'evening' }]);

    fireEvent.click(screen.getByRole('button', { name: 'More for Apply a scene' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/u }));

    const field = screen.getByRole('textbox', { name: /name/iu });

    fireEvent.change(field, { target: { value: 'Lights down' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(screen.getByText('Lights down')).toBeTruthy();
    expect(seen.then[0]).toEqual({ type: 'scene', sceneKey: 'evening', name: 'Lights down' });
  });

  it('turns a block off and on, keeping it', () => {
    renderList([{ type: 'scene', sceneKey: 'evening' }]);

    fireEvent.click(screen.getByRole('button', { name: 'More for Apply a scene' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Turn off/u }));

    expect(blockOf('Apply a scene').hasAttribute('data-disabled')).toBe(true);
    expect(within(blockOf('Apply a scene')).getByText('Off')).toBeTruthy();
    expect(seen.then[0]).toEqual({ type: 'scene', sceneKey: 'evening', isEnabled: false });

    fireEvent.click(screen.getByRole('button', { name: 'More for Apply a scene' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Turn on/u }));

    expect(seen.then[0]).toEqual({ type: 'scene', sceneKey: 'evening' });
  });

  it('keeps Test out of reach without the right to run it', () => {
    renderList([{ type: 'scene', sceneKey: 'evening' }]);

    fireEvent.click(screen.getByRole('button', { name: 'More for Apply a scene' }));

    expect(screen.getByRole('menuitem', { name: /Test/u }).hasAttribute('disabled')).toBe(true);
  });
});

describe('moving with the keyboard', () => {
  it('walks a block out of Then and into Else', () => {
    renderList([IF_ELSE]);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Apply a scene' }), {
      key: 'ArrowDown',
    });

    expect(seen.then[0]).toMatchObject({
      type: 'if',
      then: [],
      else: [
        { type: 'scene', sceneKey: 'evening' },
        { type: 'wait_duration', durationMs: 60_000 },
      ],
    });
  });

  it('walks a block out of the If it is in', () => {
    renderList([IF_ELSE]);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Apply a scene' }), {
      key: 'ArrowUp',
    });

    expect(seen.then.map((action) => action.type)).toEqual(['scene', 'if']);
  });
});

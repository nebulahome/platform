/**
 * The tag field: chips for what is on the row, a box to type in, and a list of what could go on.
 *
 * Every behaviour here is one that a screenshot cannot show has broken: the keys, what the list
 * offers, and the path from a typed name to a tag that did not exist a moment ago.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TagView } from '@nebula-home/contracts';

import { TagField } from './tag-field';

/**
 * A tag, for lists that vary one of them.
 *
 * @param id - Its id, and its key.
 * @param name - What it is called.
 * @returns The tag.
 */
function tag(id: string, name: string): TagView {
  return { id, key: id, name, color: 'teal', icon: null, deviceCount: 0, entityCount: 0 };
}

const TAGS = [tag('a', 'Exterior'), tag('b', 'Energy monitored'), tag('c', 'Extra')];

/**
 * Renders the field with some tags on the row.
 *
 * @param value - Which tag ids start on the row.
 * @param canCreate - Whether a new tag may be made from what is typed.
 * @returns The callbacks it was given.
 */
function renderField(value: string[] = ['b'], canCreate = true) {
  const onChange = vi.fn();
  const onCreate = vi.fn((name: string): Promise<TagView> =>
    Promise.resolve({
      id: 'new',
      key: 'new',
      name,
      color: 'pink',
      icon: null,
      deviceCount: 0,
      entityCount: 0,
    }),
  );

  render(
    <TagField
      value={value}
      onChange={onChange}
      tags={TAGS}
      canCreate={canCreate}
      onCreate={onCreate}
    />,
  );

  return { onChange, onCreate };
}

describe('TagField', () => {
  it('shows the tags on the row as chips, each with a cross that takes it off', () => {
    const { onChange } = renderField(['a', 'b']);

    expect(screen.getByText('Exterior')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Exterior' }));

    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('offers the tags not yet on the row when the box is focused, and puts one on', () => {
    const { onChange } = renderField(['b']);
    const input = screen.getByRole('combobox', { name: 'Tags' });

    fireEvent.focus(input);

    const options = screen.getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual(['Exterior', 'Extra']);

    fireEvent.click(options[1] ?? input);

    expect(onChange).toHaveBeenCalledWith(['b', 'c']);
  });

  it('narrows the list to what is typed, and Enter puts the highlighted one on', () => {
    const { onChange } = renderField([]);
    const input = screen.getByRole('combobox', { name: 'Tags' });

    fireEvent.change(input, { target: { value: 'monit' } });

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Energy monitored',
      'Create tag “monit”',
    ]);

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('draws a chosen tag by the icon it was given', () => {
    render(
      <TagField
        value={['a']}
        onChange={vi.fn()}
        tags={[{ ...tag('a', 'Exterior'), icon: 'sun' }]}
        icons={
          new Map([
            [
              'sun',
              {
                id: 'sun',
                name: 'Sun',
                keywords: [],
                origin: 'builtin',
                isOverridden: false,
                node: [['rect', { x: '2', y: '2', width: '20', height: '20' }]],
                frame: { x: 0, y: 0, size: 24 },
              },
            ],
          ])
        }
        canCreate={false}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByTitle('Exterior').querySelector('svg rect')).toBeTruthy();
  });

  it('takes the last chip off on Backspace in an empty box', () => {
    const { onChange } = renderField(['a', 'b']);

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Tags' }), { key: 'Backspace' });

    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  it('shuts the list on Escape without taking the dialog behind it down', () => {
    renderField([]);
    const input = screen.getByRole('combobox', { name: 'Tags' });
    const onDocumentKeyDown = vi.fn();

    document.addEventListener('keydown', onDocumentKeyDown);
    fireEvent.focus(input);
    expect(screen.queryByRole('listbox')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onDocumentKeyDown).not.toHaveBeenCalled();
    document.removeEventListener('keydown', onDocumentKeyDown);
  });

  it('makes a tag from a name no tag has, in the colour picked, and puts it on', async () => {
    const { onChange, onCreate } = renderField(['b']);
    const input = screen.getByRole('combobox', { name: 'Tags' });

    fireEvent.change(input, { target: { value: 'Garden' } });
    fireEvent.click(screen.getByRole('option', { name: 'Create tag “Garden”' }));

    fireEvent.click(screen.getByRole('radio', { name: 'pink' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Garden' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('Garden', 'pink');
      expect(onChange).toHaveBeenCalledWith(['b', 'new']);
    });
  });

  it('puts Cancel before Create, at the right, like every other form', () => {
    renderField(['b']);
    const input = screen.getByRole('combobox', { name: 'Tags' });

    fireEvent.change(input, { target: { value: 'Garden' } });
    fireEvent.click(screen.getByRole('option', { name: 'Create tag “Garden”' }));

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const create = screen.getByRole('button', { name: 'Create Garden' });

    // The dialogs' footers read Cancel then the primary action, flush right. The row used to
    // read the other way round, and sat at the left.
    expect(cancel.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancel.parentElement?.className).toContain('justify-end');
  });

  it('offers no new tag when the name is one a tag has, or when making one is not allowed', () => {
    renderField([], false);
    const input = screen.getByRole('combobox', { name: 'Tags' });

    fireEvent.change(input, { target: { value: 'Garden' } });

    expect(screen.queryByRole('option', { name: /create tag/iu })).toBeNull();
  });
});

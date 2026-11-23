import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Popover } from './popover.js';
import { SelectField } from './select-field.js';

describe('Popover', () => {
  beforeAll(() => {
    // jsdom has no scrolling; the select brings its active option into view.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('stays open for a press on its select’s options, portalled out of it, and shuts outside', () => {
    const anchor = createRef<HTMLButtonElement>();
    const onClose = vi.fn();

    render(
      <>
        <button ref={anchor} type="button">
          Anchor
        </button>
        <Popover anchor={anchor} isOpen onClose={onClose} label="New event">
          <SelectField
            label="Calendar"
            value="house"
            onChange={() => undefined}
            options={[
              { value: 'house', label: 'House' },
              { value: 'bobby', label: 'Bobby' },
            ]}
          />
        </Popover>
        <p>Elsewhere</p>
      </>,
    );

    fireEvent.click(screen.getByRole('combobox', { name: /Calendar/ }));
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Bobby' }));

    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByText('Elsewhere'));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shuts for a press whose own handler stops it, and for Escape with the focus elsewhere', () => {
    const anchor = createRef<HTMLButtonElement>();
    const onClose = vi.fn();

    render(
      <>
        <button ref={anchor} type="button">
          Anchor
        </button>
        <Popover anchor={anchor} isOpen onClose={onClose} label="Event">
          <p>Inside</p>
        </Popover>
        <button
          type="button"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          A block
        </button>
      </>,
    );

    fireEvent.pointerDown(screen.getByText('A block'));

    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(screen.getByText('Inside'), { key: 'Escape' });

    // Inside, the panel takes it alone: once more, not twice.
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('stays open for a press in a popover opened from inside it', () => {
    const outer = createRef<HTMLButtonElement>();
    const inner = createRef<HTMLButtonElement>();
    const onClose = vi.fn();

    /**
     * The model's popover with its icon picker, opened once its button is there.
     *
     * @param props - Whether the picker is open.
     * @param props.isPicking - Whether the picker is open.
     * @returns Both.
     */
    function Both(props: { readonly isPicking: boolean }) {
      return (
        <>
          <button ref={outer} type="button">
            Add a model
          </button>
          <Popover anchor={outer} isOpen onClose={onClose} label="New model">
            <button ref={inner} type="button">
              Icon
            </button>
          </Popover>
          <Popover anchor={inner} isOpen={props.isPicking} onClose={() => undefined} label="Icons">
            <button type="button">Leaf</button>
          </Popover>
        </>
      );
    }
    const { rerender } = render(<Both isPicking={false} />);

    rerender(<Both isPicking />);
    fireEvent.pointerDown(screen.getByText('Leaf'));

    expect(onClose).not.toHaveBeenCalled();
  });
});

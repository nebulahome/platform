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
});

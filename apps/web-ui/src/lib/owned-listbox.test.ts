import { describe, expect, it } from 'vitest';

import { isOwnedListbox } from './owned-listbox';

/**
 * A sheet holding a combobox, and a listbox portalled elsewhere that the combobox controls.
 *
 * @returns The sheet, an element inside the owned list, and an element inside a stray one.
 */
function fixture(): { sheet: HTMLElement; owned: HTMLElement; stray: HTMLElement } {
  document.body.innerHTML = `
    <div id="sheet"><button role="combobox" aria-controls="vendors"></button></div>
    <ul role="listbox" id="vendors"><li role="option"><span id="owned">Shelly</span></li></ul>
    <ul role="listbox" id="other"><li role="option"><span id="stray">Elsewhere</span></li></ul>
  `;

  const byId = (id: string): HTMLElement => {
    const found = document.getElementById(id);

    if (found === null) {
      throw new Error(`No element ${id}`);
    }

    return found;
  };

  return { sheet: byId('sheet'), owned: byId('owned'), stray: byId('stray') };
}

describe('isOwnedListbox', () => {
  it('recognises a press inside the list a combobox in the sheet controls', () => {
    const { sheet, owned } = fixture();

    expect(isOwnedListbox(sheet, owned)).toBe(true);
  });

  it('does not claim a list nothing in the sheet controls', () => {
    const { sheet, stray } = fixture();

    expect(isOwnedListbox(sheet, stray)).toBe(false);
  });

  it('does not claim a press outside any list', () => {
    const { sheet } = fixture();

    expect(isOwnedListbox(sheet, document.body)).toBe(false);
  });
});

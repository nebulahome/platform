// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { loadBuiltinIcons } from '@nebula-home/icons';

import { BUILTIN_UI_NODES, UI_ICON_IDS } from './ui-set.js';

describe('the icons the interface draws itself with', () => {
  it('are all in the catalogue, so each can be listed and drawn afresh from Settings', () => {
    // The rule the interface lives by: an icon is an id in the catalogue, never a component.
    // This is what enforces it for the ones the chrome uses.
    const builtin = new Set(loadBuiltinIcons().map((icon) => icon.id));

    for (const id of UI_ICON_IDS) {
      expect(builtin.has(id), `${id} is not a catalogue icon`).toBe(true);
    }
  });

  it('each ship a drawing for when the catalogue has not been asked yet', () => {
    for (const id of UI_ICON_IDS) {
      expect(BUILTIN_UI_NODES[id].length, `${id} has no drawing`).toBeGreaterThan(0);
    }
  });

  it('are the same drawings the catalogue serves', () => {
    // Two copies of lucide - the one the browser bundles and the one the server reads - must be
    // the same version, or an id would draw one thing before sign-in and another after.
    const served = new Map(loadBuiltinIcons().map((icon) => [icon.id, icon.node]));

    for (const id of UI_ICON_IDS) {
      expect(BUILTIN_UI_NODES[id]).toEqual(served.get(id));
    }
  });
});

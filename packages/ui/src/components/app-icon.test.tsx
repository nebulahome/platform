import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IconOverridesProvider, type IconOverrides } from '../icons/icon-overrides.js';
import { BUILTIN_UI_NODES } from '../icons/ui-set.js';

import { AppIcon } from './app-icon.js';
import { CatalogueIcon } from './catalogue-icon.js';

describe('CatalogueIcon', () => {
  it('draws the node inside the frame, in the current colour', () => {
    const { container } = render(
      <CatalogueIcon
        node={[['circle', { cx: '12', cy: '12', r: '4' }]]}
        frame={{ x: 0, y: 0, size: 24 }}
      />,
    );
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('circle')?.getAttribute('r')).toBe('4');
  });

  it('scales the stroke with the frame, so a big drawing keeps the same line as a small one', () => {
    // A file drawn in 512 units with a 1.75 stroke would be a hairline. The line every icon
    // shares is 1.75 of the 24 box, whatever box the drawing came in.
    const { container } = render(
      <CatalogueIcon node={[['path', { d: 'M0 0h512' }]]} frame={{ x: 0, y: 0, size: 512 }} />,
    );

    expect(container.querySelector('svg')?.getAttribute('stroke-width')).toBe(
      String((1.75 * 512) / 24),
    );
  });

  it("keeps an uploaded drawing's own attributes without React objecting to their names", () => {
    // An upload arrives with SVG's names for its attributes; React wants its own, and warns
    // about every other spelling on every render. What reaches the DOM is the SVG name again.
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => {
      // Kept quiet: the point is whether it is called at all.
    });
    const { container } = render(
      <CatalogueIcon
        node={[['path', { d: 'M0 0h10', 'stroke-width': '3', 'stroke-linecap': 'square' }]]}
        frame={{ x: 0, y: 0, size: 24 }}
      />,
    );
    const path = container.querySelector('path');

    expect(path?.getAttribute('stroke-width')).toBe('3');
    expect(path?.getAttribute('stroke-linecap')).toBe('square');
    expect(complaints).not.toHaveBeenCalled();
    complaints.mockRestore();
  });
});

describe('AppIcon', () => {
  it('draws the built-in icon for an id', () => {
    const { container } = render(<AppIcon id="check" />);

    expect(container.querySelectorAll('path')).toHaveLength(BUILTIN_UI_NODES.check.length);
  });

  it('draws the override instead, once the catalogue has provided one', () => {
    const overrides: IconOverrides = new Map([
      [
        'check',
        { node: [['circle', { cx: '1', cy: '1', r: '1' }]], frame: { x: 0, y: 0, size: 2 } },
      ],
    ]);
    const { container } = render(
      <IconOverridesProvider value={overrides}>
        <AppIcon id="check" />
      </IconOverridesProvider>,
    );

    expect(container.querySelector('circle')).not.toBeNull();
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 2 2');
  });

  it('is sized by the caller and carries a class through', () => {
    const { container } = render(<AppIcon id="check" size={15} className="rotate-180" />);
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('width')).toBe('15');
    expect(svg?.getAttribute('class')).toContain('rotate-180');
  });
});

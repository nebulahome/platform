/**
 * The formula field's painted copy: what it colours, and what it marks as wrong.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AliasFormulaField, formulaSegments } from './alias-formula-field';

describe('formulaSegments', () => {
  const colors = new Map([
    ['t1', 'red'],
    ['t2', 'teal'],
  ] as const);

  it('covers the formula exactly, so the copy lies under the typed text', () => {
    const value = '(t1 + t2)\n/ 3';

    expect(
      formulaSegments(value, colors)
        .map((segment) => segment.text)
        .join(''),
    ).toBe(value);
  });

  it('draws each variable as a chip in its source’s colour, and nothing else as one', () => {
    const segments = formulaSegments('(t1 + t2) / 3', colors);
    const chips = segments.filter((segment) => segment.className.includes('token-halo'));

    expect(chips.map((chip) => chip.text)).toEqual(['t1', 't2']);
    expect(chips[0]?.className).toContain('text-tag-red');
    expect(chips[1]?.className).toContain('text-tag-teal');
  });

  it('marks a name no source has, and a character the formula cannot hold', () => {
    const segments = formulaSegments('t1 + t3 # 2', colors);

    expect(segments.find((segment) => segment.text === 't3')?.isUnknown).toBe(true);
    expect(segments.find((segment) => segment.text === '#')?.className).toContain('text-danger');
    expect(segments.find((segment) => segment.text === 't1')?.isUnknown).toBe(false);
  });
});

describe('AliasFormulaField', () => {
  it('is a text area that takes several lines, and says what is wrong with the formula', () => {
    const onChange = vi.fn();

    render(
      <AliasFormulaField
        value="t1 +"
        onChange={onChange}
        sources={[{ variableName: 't1', color: 'red' }]}
        error="The formula ends too soon."
      />,
    );

    const field = screen.getByLabelText('Formula');

    expect(field.tagName).toBe('TEXTAREA');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('The formula ends too soon.')).toBeTruthy();

    fireEvent.change(field, { target: { value: 't1 +\n2' } });
    expect(onChange).toHaveBeenCalledWith('t1 +\n2');
  });
});

import { describe, expect, it } from 'vitest';

import { cn } from './cn.js';
import { controlFace } from './control-face.js';

describe('cn', () => {
  it('keeps a type step beside a text colour, in either order', () => {
    expect(cn('text-ui', 'text-foreground')).toBe('text-ui text-foreground');
    expect(cn('text-foreground', 'text-caption')).toBe('text-foreground text-caption');
  });

  it('keeps the size of a field whose text is made transparent', () => {
    // The formula field draws its text underneath and makes the input's own transparent. Losing
    // `text-ui` there set the two layers in different sizes.
    const classes = cn(controlFace({ size: 'medium' }), 'text-transparent').split(' ');

    expect(classes).toContain('text-ui');
    expect(classes).toContain('text-transparent');
    expect(classes).not.toContain('text-foreground');
  });

  it('lets a later type step replace an earlier one', () => {
    expect(cn('text-ui', 'text-reading')).toBe('text-reading');
    expect(cn('text-ui-sm', 'text-display')).toBe('text-display');
  });

  it('resolves the theme radii and shadows against the stock ones', () => {
    expect(cn('rounded-field', 'rounded-full')).toBe('rounded-full');
    expect(cn('', 'shadow-none')).toBe('shadow-none');
  });
});

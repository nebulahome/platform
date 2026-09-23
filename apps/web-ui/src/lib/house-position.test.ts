import { describe, expect, it } from 'vitest';

import { parsePosition, positionText } from '@/lib/house-position';

describe('parsePosition', () => {
  it('reads two coordinates', () => {
    expect(parsePosition('45.4642', ' 9.19 ')).toEqual({
      position: { latitude: 45.4642, longitude: 9.19 },
    });
  });

  it('reads two blanks as no position', () => {
    expect(parsePosition('', '  ')).toEqual({ position: null });
  });

  it('refuses one coordinate without the other', () => {
    expect(parsePosition('45.4642', '')).toEqual({
      problem: 'A position needs both a latitude and a longitude.',
    });
  });

  it('refuses what is not a number, and what is off the globe', () => {
    expect(parsePosition('north', '9.19')).toEqual({
      problem: 'The latitude must be a number between -90 and 90.',
    });
    expect(parsePosition('45', '181')).toEqual({
      problem: 'The longitude must be a number between -180 and 180.',
    });
  });
});

describe('positionText', () => {
  it('writes a coordinate as it was, and nothing for none', () => {
    expect(positionText(9.19)).toBe('9.19');
    expect(positionText(null)).toBe('');
  });
});

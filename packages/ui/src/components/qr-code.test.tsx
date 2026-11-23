import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QrCode, qrPath } from './qr-code.js';

describe('QrCode', () => {
  it('draws a square code with its quiet zone and the three finder squares', () => {
    const { size, path } = qrPath('webcal://192.168.1.20:8080/api/calendar/0123456789abcdef.ics');

    // Version 4 or more for a link this long: 33 modules, plus four on each side.
    expect(size).toBeGreaterThanOrEqual(33 + 8);
    expect((size - 8 - 17) % 4).toBe(0);

    // The top-left finder's corner is dark, the quiet zone round it is not.
    expect(path).toContain('M4 4h1v1h-1z');
    expect(path).not.toContain('M3 3h1v1h-1z');
  });

  it('gives the same text the same code', () => {
    expect(qrPath('hello').path).toBe(qrPath('hello').path);
    expect(qrPath('hello').path).not.toBe(qrPath('hellp').path);
  });

  it('is an image with its label', () => {
    render(<QrCode value="webcal://hub/api/calendar/x.ics" label="Code to subscribe" />);

    expect(screen.getByRole('img', { name: 'Code to subscribe' })).toBeTruthy();
  });
});

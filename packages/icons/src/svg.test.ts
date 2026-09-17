import { describe, expect, it } from 'vitest';

import { IconSvgError, parseIconSvg, suggestIconId } from './svg.js';

describe('parseIconSvg', () => {
  it('reads the elements a line icon is drawn with, in drawing order', () => {
    // Declared the way a line icon file is: painted by stroke on the root, so every shape
    // says so itself once the root is gone.
    const parsed = parseIconSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="4"/><path d="M4 4h16"/></svg>',
    );

    expect(parsed.node).toEqual([
      ['circle', { cx: '12', cy: '12', r: '4', fill: 'none', stroke: 'currentColor' }],
      ['path', { d: 'M4 4h16', fill: 'none', stroke: 'currentColor' }],
    ]);
  });

  it('reads a square viewBox as the frame the file was drawn in', () => {
    const parsed = parseIconSvg('<svg viewBox="0 0 24 24"><path d="M4 4h16"/></svg>');

    expect(parsed.viewBox).toEqual({ x: 0, y: 0, size: 24 });
  });

  it('squares a viewBox that is not, around its centre', () => {
    // The frame is always square. A wide file is framed by its longer side, centred, so the
    // drawing lands in the middle of the box rather than in a corner.
    const parsed = parseIconSvg('<svg viewBox="0 0 40 20"><path d="M0 10h40"/></svg>');

    expect(parsed.viewBox).toEqual({ x: 0, y: -10, size: 40 });
  });

  it('leaves the frame unknown when the file says nothing about its size', () => {
    expect(parseIconSvg('<svg><path d="M4 4h16"/></svg>').viewBox).toBeNull();
  });

  it('flattens a group by carrying its transform onto what it holds', () => {
    // The interface renders a flat list. A group is only ever a transform applied to its
    // children, so the transform moves down and the group goes.
    const parsed = parseIconSvg(
      '<svg viewBox="0 0 24 24" stroke="currentColor"><g transform="translate(2 2)"><g transform="scale(0.5)"><path d="M0 0h4" transform="rotate(45)"/></g><rect x="1" y="1" width="2" height="2"/></g></svg>',
    );

    expect(parsed.node).toEqual([
      [
        'path',
        { d: 'M0 0h4', transform: 'translate(2 2) scale(0.5) rotate(45)', stroke: 'currentColor' },
      ],
      [
        'rect',
        {
          x: '1',
          y: '1',
          width: '2',
          height: '2',
          transform: 'translate(2 2)',
          stroke: 'currentColor',
        },
      ],
    ]);
  });

  it('turns every colour into the current one, and keeps none as none', () => {
    // An icon takes the colour of the text beside it, the way every built-in one does. A file
    // painted black would be black on a dark page; a shape painted none must stay unpainted.
    const parsed = parseIconSvg(
      '<svg viewBox="0 0 24 24"><path d="M4 4h16" stroke="#000" fill="none"/><circle cx="1" cy="1" r="1" fill="rgb(0,0,0)"/></svg>',
    );

    expect(parsed.node).toEqual([
      ['path', { d: 'M4 4h16', stroke: 'currentColor', fill: 'none' }],
      ['circle', { cx: '1', cy: '1', r: '1', fill: 'currentColor' }],
    ]);
  });

  it('drops attributes a drawing has no use for', () => {
    const parsed = parseIconSvg(
      '<svg viewBox="0 0 24 24" stroke="currentColor"><path d="M4 4h16" id="a" class="b" style="stroke:red" data-x="1"/></svg>',
    );

    expect(parsed.node).toEqual([['path', { d: 'M4 4h16', stroke: 'currentColor' }]]);
  });

  it('paints a file that says nothing about colour as a filled icon, the way a browser would', () => {
    // A file with no fill and no stroke anywhere is drawn filled, black, by every browser.
    // Left alone it would become an outline inside the interface's stroked svg.
    const parsed = parseIconSvg('<svg viewBox="0 0 24 24"><path d="M4 4h16v16z"/></svg>');

    expect(parsed.node).toEqual([['path', { d: 'M4 4h16v16z', fill: 'currentColor' }]]);
  });

  it('skips a title, a description and a defs block without reading into them', () => {
    const parsed = parseIconSvg(
      '<svg viewBox="0 0 24 24" stroke="currentColor"><title>Boiler</title><desc>a boiler</desc><defs><path d="M0 0h1"/></defs><path d="M4 4h16"/></svg>',
    );

    expect(parsed.node).toEqual([['path', { d: 'M4 4h16', stroke: 'currentColor' }]]);
  });

  it('refuses an element that is not a shape, naming it', () => {
    for (const markup of [
      '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>',
      '<svg viewBox="0 0 24 24"><image href="x.png"/></svg>',
      '<svg viewBox="0 0 24 24"><use href="#a"/></svg>',
      '<svg viewBox="0 0 24 24"><foreignObject/></svg>',
      '<svg viewBox="0 0 24 24"><text>hi</text></svg>',
    ]) {
      expect(() => parseIconSvg(markup)).toThrow(IconSvgError);
    }

    expect(() => parseIconSvg('<svg><image href="x.png"/></svg>')).toThrow(/image/u);
  });

  it('refuses an attribute that could reach out of the drawing', () => {
    expect(() =>
      parseIconSvg('<svg viewBox="0 0 24 24"><path d="M0 0" onclick="alert(1)"/></svg>'),
    ).toThrow(/onclick/u);
  });

  it('refuses a file that is not an svg', () => {
    expect(() => parseIconSvg('<html><body/></html>')).toThrow(IconSvgError);
    expect(() => parseIconSvg('not markup at all')).toThrow(IconSvgError);
  });

  it('refuses a drawing with nothing in it', () => {
    expect(() => parseIconSvg('<svg viewBox="0 0 24 24"><g/></svg>')).toThrow(/nothing/u);
  });

  it('refuses a drawing with more elements than an icon has', () => {
    const shapes = '<circle cx="1" cy="1" r="1"/>'.repeat(501);

    expect(() => parseIconSvg(`<svg viewBox="0 0 24 24">${shapes}</svg>`)).toThrow(/501/u);
  });

  it('reads a file with an xml declaration, a doctype and comments around the drawing', () => {
    const parsed = parseIconSvg(
      '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><!-- made by hand --><svg viewBox="0 0 24 24"><!-- a shape --><path d="M4 4h16"/></svg>',
    );

    expect(parsed.node).toHaveLength(1);
  });
});

describe('suggestIconId', () => {
  it('turns a name into the id shape', () => {
    expect(suggestIconId('Boiler')).toBe('boiler');
    expect(suggestIconId('3D printer (studio)')).toBe('3d-printer-studio');
    expect(suggestIconId('  Heat   pump  ')).toBe('heat-pump');
  });

  it('gives nothing for a name with nothing to use', () => {
    expect(suggestIconId('***')).toBe('');
  });

  it('keeps the id inside its length', () => {
    expect(suggestIconId('x'.repeat(80))).toHaveLength(64);
  });
});

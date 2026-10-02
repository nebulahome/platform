import { describe, expect, it } from 'vitest';

import { scopeCss } from './scope-css.js';

/** The scope of the package `weather`. */
const SCOPE = ':where([data-nebula-package="weather"])';

describe('a package’s stylesheet, scoped', () => {
  it('applies each rule inside the package’s own elements, at the weight it was written', () => {
    expect(scopeCss('.card, h2 > .title { color: red }', 'weather')).toBe(
      `${SCOPE} .card, ${SCOPE} h2 > .title { color: red }`,
    );
  });

  it('turns the document’s root into the scope’s, inside at-rules too', () => {
    expect(
      scopeCss(':root { --gap: 4px } @media (width > 600px) { body .x { gap: 1px } }', 'weather'),
    ).toBe(`${SCOPE} { --gap: 4px } @media (width > 600px) { ${SCOPE} .x { gap: 1px } }`);
  });

  it('leaves keyframes, nested rules and registered properties as they are', () => {
    const css =
      '@keyframes spin { from { rotate: 0 } to { rotate: 1turn } } @property --tw-x { syntax: "*"; inherits: false } .a { &:hover { color: red } }';

    expect(scopeCss(css, 'weather')).toBe(
      `@keyframes spin { from { rotate: 0 } to { rotate: 1turn } } @property --tw-x { syntax: "*"; inherits: false } ${SCOPE} .a { &:hover { color: red } }`,
    );
  });
});

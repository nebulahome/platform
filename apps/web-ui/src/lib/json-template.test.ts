import { describe, expect, it } from 'vitest';

import { formatJsonTemplate } from './json-template';

describe('formatJsonTemplate', () => {
  it('indents a body, keeping each token where it was, as a value or inside a string', () => {
    expect(
      formatJsonTemplate('{"w":{{ power }},"door":"{{door}}","say":"it is {{ temp }} now"}'),
    ).toBe('{\n  "w": {{ power }},\n  "door": "{{door}}",\n  "say": "it is {{ temp }} now"\n}');
  });

  it('says a body that is not JSON is not', () => {
    expect(formatJsonTemplate('{ "w": {{ power }}, }')).toBeNull();
    expect(formatJsonTemplate('')).toBeNull();
  });
});

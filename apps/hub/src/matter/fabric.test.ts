import { describe, expect, it } from 'vitest';

import { jsonValueSchema } from '@nebulahome/contracts';

import { jsonSafe } from './fabric.js';

describe('jsonSafe', () => {
  it("drops a struct's absent field and keeps 64-bit numbers, so a claim stores as JSON", () => {
    // As the controller caches a node's fabrics (0/62/1): field 3 is optional, and left undefined.
    const cached = { '0/62/1': [{ 1: 1n, 2: 4701n, 3: undefined, 254: 2 }], '0/40/2': 2n ** 64n };
    const safe = jsonSafe(cached);

    expect(safe).toStrictEqual({
      '0/62/1': [{ 1: 1, 2: 4701, 254: 2 }],
      '0/40/2': '18446744073709551616',
    });
    expect(jsonValueSchema.safeParse(safe).success).toBe(true);
  });
});

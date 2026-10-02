/**
 * A package's settings as its components read them: what was saved, with the defaults and the
 * secrets as whether one is saved; and, before anything is read, what the declaration gives.
 */
import { describe, expect, it } from 'vitest';

import { defineSettings, field } from '@nebulahome/package-sdk';

import { declaredSettingsOf, visibleSettingsOf } from '@/packages/sdk-ui';

describe('visibleSettingsOf', () => {
  it('fills the defaults in, and reads a secret as whether one is saved', () => {
    expect(
      visibleSettingsOf(
        { interval: 4, token: { $sealed: true } },
        {
          transport: {
            constants: {},
            fields: [
              {
                key: 'interval',
                type: 'number',
                label: 'Tick every',
                isRequired: false,
                isInteger: true,
                default: 10,
              },
              {
                key: 'city',
                type: 'text',
                label: 'City',
                isRequired: false,
                maxLength: 512,
                default: 'Turin',
              },
              { key: 'token', type: 'secret', label: 'Token', isRequired: false, maxLength: 512 },
              { key: 'other', type: 'secret', label: 'Other', isRequired: false, maxLength: 512 },
            ],
          },
          options: { constants: {}, fields: [] },
        },
      ),
    ).toEqual({ interval: 4, city: 'Turin', token: true, other: false });
  });
});

describe('declaredSettingsOf', () => {
  it('gives each declared default, and no secret, before anything is read', () => {
    const settings = defineSettings({
      interval: field.number({ label: 'Tick every', default: 10 }),
      city: field.text({ label: 'City' }),
      token: field.secret({ label: 'Token' }),
    });

    expect(declaredSettingsOf(settings)).toEqual({ interval: 10, token: false });
    expect(declaredSettingsOf(undefined)).toEqual({});
  });
});

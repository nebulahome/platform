/**
 * The server's declaration: what `defineServer` stamps, and the types a context gives `start`
 * from the package's own declarations.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { defineEntityType, defineSettings, field, SDK_VERSION } from '../index.js';

import { defineServer, type ServerContext } from './index.js';

const settings = defineSettings({
  city: field.text({ label: 'City', isRequired: true }),
  refreshMinutes: field.number({ label: 'Refresh every', default: 30, isLive: true }),
});

const note = defineEntityType({
  id: 'note',
  name: 'Note',
  icon: 'sticky-note',
  state: {
    text: field.text({ label: 'Text' }),
    updatedAt: field.timestamp({ label: 'Written', isOptional: true }),
  },
  commands: { rename: { name: 'Rename', fields: { text: field.text({ label: 'Text' }) } } },
});

describe('a server', () => {
  it('is stamped with the SDK it was built with', () => {
    const server = defineServer({
      start: () => undefined,
    });

    expect(server).toMatchObject({ kind: 'nebula.server', sdk: SDK_VERSION });
  });

  it('types its settings from their declaration, and plain JSON without one', () => {
    defineServer({
      settings,
      async start(ctx) {
        expectTypeOf(ctx.settings.city).toEqualTypeOf<string>();
        expectTypeOf(ctx.settings.refreshMinutes).toEqualTypeOf<number>();
        ctx.onSettingsChange(({ changed }) => {
          expectTypeOf(changed).toEqualTypeOf<readonly ('city' | 'refreshMinutes')[]>();
        });
        await Promise.resolve();
      },
    });
    defineServer({
      start(ctx) {
        expectTypeOf(ctx.settings).toEqualTypeOf<ServerContext['settings']>();

        return () => undefined;
      },
    });
  });

  it('types its own entities, its methods and the services it calls', () => {
    defineServer({
      start(ctx) {
        const notes = ctx.custom(note);

        notes.report(notes.entityId('main'), { text: 'Milk', updatedAt: null });
        // @ts-expect-error - a required field is never null
        notes.report(notes.entityId('main'), { text: null });
        notes.onCommand('rename', ({ args }) => {
          expectTypeOf(args).toEqualTypeOf<{ readonly text: string }>();
        });
        // @ts-expect-error - a note takes no such command
        notes.onCommand('delete', () => undefined);

        ctx.rpc.method(
          'clips',
          { access: 'read', input: z.object({ camera: z.string() }) },
          ({ camera }, { caller }) => {
            expectTypeOf(camera).toEqualTypeOf<string>();

            return { camera, by: caller.username };
          },
        );

        const answer = ctx.services.call('nvr', 'count', {}, { output: z.number() });

        expectTypeOf(answer).toEqualTypeOf<Promise<number>>();

        return undefined;
      },
    });
  });
});

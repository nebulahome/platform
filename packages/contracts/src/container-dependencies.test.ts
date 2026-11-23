/**
 * The grammar of declared containers: what one container may say about how it starts, and what
 * the declaration as a whole refuses about the order they start in.
 */
import { describe, expect, it } from 'vitest';

import { containerDependenciesSchema } from './container-dependencies.js';

/**
 * A container of the declaration.
 *
 * @param id - Its id.
 * @param extra - What else it says.
 * @returns The declaration of it.
 */
function container(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name: id, image: `example/${id}`, minVersion: '1.0.0', ...extra };
}

/**
 * What a declaration is refused for, one message each.
 *
 * @param value - The declaration.
 * @returns The messages.
 */
function problems(value: unknown): string[] {
  return (
    containerDependenciesSchema.safeParse(value).error?.issues.map((issue) => issue.message) ?? []
  );
}

describe('declared containers', () => {
  it('read a command, a healthcheck and the containers they start after', () => {
    const [db, server] = containerDependenciesSchema.parse([
      container('db', {
        healthcheck: { test: ['CMD', 'pg_isready'], intervalMs: 10_000, retries: 5 },
      }),
      container('server', { command: ['serve', '--port', '8080'], dependsOn: { db: 'healthy' } }),
    ]);

    expect(db?.healthcheck).toEqual({
      test: ['CMD', 'pg_isready'],
      intervalMs: 10_000,
      retries: 5,
    });
    expect(server).toMatchObject({
      command: ['serve', '--port', '8080'],
      dependsOn: { db: 'healthy' },
    });
  });

  it('refuse a healthcheck that is not a command', () => {
    expect(problems([container('db', { healthcheck: { test: ['pg_isready', 'x'] } })])).toEqual([
      'Starts with CMD or CMD-SHELL',
    ]);
  });

  it('refuse starting after what is not there, after itself, or in a circle', () => {
    expect(problems([container('server', { dependsOn: { db: 'started' } })])).toEqual([
      'db is not one of the declared containers',
    ]);
    expect(problems([container('server', { dependsOn: { server: 'started' } })])).toEqual([
      'server cannot start after itself',
    ]);
    expect(
      problems([container('db'), container('server', { dependsOn: { db: 'healthy' } })]),
    ).toEqual(['db has no healthcheck to wait for']);
    expect(
      problems([
        container('alpha', { dependsOn: { beta: 'started' } }),
        container('beta', { dependsOn: { alpha: 'started' } }),
      ]),
    ).toEqual([
      'alpha starts after a container that starts after it',
      'beta starts after a container that starts after it',
    ]);
  });

  it('refuse the folder names beside theirs', () => {
    expect(problems([container('packages')])).toEqual(['Must be a short lower-case id']);
  });

  it('read a page served through the platform, on the host network when it asks', () => {
    const [page] = containerDependenciesSchema.parse([
      container('builder', { ingress: { port: '{setup.port}' }, hostNetwork: true }),
    ]);

    expect(page).toMatchObject({ ingress: { port: '{setup.port}' }, hostNetwork: true });
  });

  it('refuse a second page, the host network without one, and anything else beside the port', () => {
    expect(
      problems([
        container('one', { ingress: { port: 8080 } }),
        container('two', { ingress: { port: 8081 } }),
      ]),
    ).toEqual(['Only one container may have ingress']);
    expect(problems([container('one', { hostNetwork: true })])).toEqual([
      'Only for a container with ingress',
    ]);
    expect(problems([container('one', { ingress: { port: 8080, path: '/ui' } })])).toHaveLength(1);
  });
});

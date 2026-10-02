import { describe, expect, it } from 'vitest';

import { composeFileProblems } from './compose.js';

/**
 * A compose file from its lines.
 *
 * @param lines - Its lines.
 * @returns The file.
 */
function file(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

describe('a package’s compose file, as validate reads it', () => {
  it('passes a file the platform will run, using its settings and the platform’s variables', () => {
    expect(
      composeFileProblems(
        file(
          'services:',
          '  server:',
          '    image: example/server:1.0.0',
          '    environment:',
          '      TOKEN: ${NEBULA_SETUP_API_TOKEN}',
          '      TZ: $NEBULA_PLATFORM_TIMEZONE',
          '      LEVEL: ${LOG_LEVEL:-info}',
          '      PRICE: $$5',
          '    volumes:',
          '      - ./data:/data',
        ),
        ['apiToken'],
      ),
    ).toEqual([]);
  });

  it('says which variables the platform does not give, once each', () => {
    expect(
      composeFileProblems(
        file(
          'services:',
          '  server:',
          '    image: x:${VERSION}',
          '    environment:',
          '      A: ${NEBULA_SETUP_CITY}',
          '      B: ${NEBULA_SETUP_CITY}',
        ),
        ['apiToken'],
      ),
    ).toEqual([
      expect.stringContaining('${VERSION} is not given to the file'),
      expect.stringContaining("${NEBULA_SETUP_CITY} is no declared setting's variable"),
    ]);
  });

  it('holds it to the supervisor’s rules, and says when it is not YAML', () => {
    expect(
      composeFileProblems(
        file('services:', '  server:', '    build: .', '    volumes:', '      - /etc:/etc'),
        [],
      ),
    ).toEqual([
      "server: a package's images are pulled, never built: name an image",
      'server: names no image',
      "server: /etc is outside the project's folder; only ./folders and devices under /dev",
    ]);
    expect(composeFileProblems('services: [', [])[0]).toMatch(/^is not YAML: /);
  });
});

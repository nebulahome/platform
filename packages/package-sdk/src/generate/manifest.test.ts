/**
 * The manifest generator: the template's declaration gives back the `nebula.package.json` and
 * `setup.json` the template was released with until now, written by hand; and what does not hold
 * together is refused with every problem named in the declaration's terms.
 */
import { describe, expect, it } from 'vitest';

import { integrationSetupSchema, packageManifestSchema } from '@nebulahome/contracts';

import {
  defineCard,
  defineCompose,
  defineContainer,
  defineEntityType,
  definePackage,
  definePage,
  defineSettings,
  field,
} from '../index.js';

import { generatePackage, githubRepositoryOf, sdkRangeOf } from './manifest.js';
import { PackageConfigError } from './problems.js';

/** The template's `nebula.package.json`, as it was written by hand. */
const TEMPLATE_MANIFEST = {
  id: 'template',
  version: '0.1.0',
  platform: '^1.0.0',
  sdk: '^1.0.0',
  name: 'Template',
  description:
    'A package to start from: a counter that ticks, a note the owner writes, a page, a dashboard card and a view of its own kind of entity.',
  repository: 'nebulahome/pkg-template',
  url: 'https://github.com/nebulahome/pkg-template',
  color: '#3F6FD8',
  logo: { path: './logo.svg' },
  category: 'other',
  runtime: 'node',
  server: { entry: './server/index.js' },
  ui: {
    entry: './ui/index.js',
    styles: './ui/index.css',
    page: true,
    cards: [
      {
        id: 'ticks',
        name: 'Ticks',
        description: 'How far the counter has gone, and the note beside it.',
        icon: 'timer',
        sizes: ['small', 'wide'],
        options: [
          {
            key: 'showNote',
            type: 'boolean',
            label: 'Show the note',
            help: 'Only drawn when the card is wide.',
            default: true,
          },
        ],
      },
    ],
    entityViews: ['note'],
  },
  setup: './setup.json',
  entityTypes: [
    {
      id: 'note',
      name: 'Note',
      icon: 'sticky-note',
      state: [
        { key: 'text', type: 'text', label: 'Text' },
        { key: 'updatedAt', type: 'timestamp', label: 'Written', isOptional: true },
      ],
      commands: [{ id: 'clear', name: 'Clear' }],
    },
  ],
};

/** The template's `setup.json`, as it was written by hand. */
const TEMPLATE_SETUP = {
  transport: {
    fields: [
      {
        key: 'interval',
        type: 'number',
        label: 'Tick every',
        help: 'How often the counter goes up.',
        unit: 's',
        isInteger: true,
        min: 1,
        max: 3600,
        default: 10,
        warnBelow: 5,
        warning: 'Every tick is a state report the house records.',
      },
    ],
  },
};

/**
 * A component, for the loaders: only that it loads matters here.
 *
 * @returns Nothing drawn.
 */
function Component(): null {
  return null;
}

const ticks = defineCard({
  id: 'ticks',
  name: 'Ticks',
  description: 'How far the counter has gone, and the note beside it.',
  icon: 'timer',
  sizes: ['small', 'wide'],
  options: {
    showNote: field.boolean({
      label: 'Show the note',
      help: 'Only drawn when the card is wide.',
      default: true,
    }),
  },
});

const note = defineEntityType({
  id: 'note',
  name: 'Note',
  icon: 'sticky-note',
  state: {
    text: field.text({ label: 'Text' }),
    updatedAt: field.timestamp({ label: 'Written', isOptional: true }),
  },
  commands: { clear: { name: 'Clear' } },
});

const template = definePackage({
  id: 'template',
  name: 'Template',
  description:
    'A package to start from: a counter that ticks, a note the owner writes, a page, a dashboard card and a view of its own kind of entity.',
  url: 'https://github.com/nebulahome/pkg-template',
  color: '#3F6FD8',
  logo: './logo.svg',
  category: 'other',
  platform: '^1.0.0',
  server: './src/server/index.ts',
  settings: defineSettings({
    interval: field.number({
      label: 'Tick every',
      help: 'How often the counter goes up.',
      unit: 's',
      isInteger: true,
      min: 1,
      max: 3600,
      default: 10,
      warnBelow: 5,
      warning: 'Every tick is a state report the house records.',
    }),
  }),
  cards: [ticks],
  entityTypes: [note],
  ui: {
    page: definePage({ component: async () => Promise.resolve(Component) }),
    cards: { ticks: async () => Promise.resolve(Component) },
    entityViews: { note: async () => Promise.resolve(Component) },
  },
});

/** What generating the template takes besides its declaration. */
const OPTIONS = {
  packageJson: {
    version: '0.1.0',
    repository: { type: 'git', url: 'git+https://github.com/nebulahome/pkg-template.git' },
  },
  sdkVersion: '1.0.0-rc.0',
  hasStyles: true,
};

/**
 * The problems a declaration is refused for.
 *
 * @param definition - The declaration.
 * @returns Each problem.
 * @throws {Error} When generating fails for another reason than the declaration.
 */
function problemsOf(definition: unknown): readonly string[] {
  try {
    generatePackage(definition, OPTIONS);
  } catch (error: unknown) {
    if (error instanceof PackageConfigError) {
      return error.problems;
    }

    throw error;
  }

  return [];
}

describe('the manifest generator', () => {
  it('gives back the template’s hand-written manifest and settings', () => {
    const generated = generatePackage(template, OPTIONS);

    expect(generated.manifest).toEqual(packageManifestSchema.parse(TEMPLATE_MANIFEST));
    expect(generated.setup).toEqual(integrationSetupSchema.parse(TEMPLATE_SETUP));
    expect(generated.copies).toEqual([{ from: './logo.svg', to: 'logo.svg' }]);
    expect(generated.server).toBe('./src/server/index.ts');
  });

  it('runs containers or a compose file when there is no server', () => {
    const base = {
      id: 'nvr',
      name: 'Recorder',
      description: 'Records.',
      category: 'security',
      platform: '^1.0.0',
    } as const;
    const compose = generatePackage(
      definePackage({ ...base, compose: defineCompose({ file: './deploy/compose.yaml' }) }),
      OPTIONS,
    );
    const containers = generatePackage(
      definePackage({
        ...base,
        containers: [
          defineContainer({
            id: 'frigate',
            name: 'Frigate',
            image: 'ghcr.io/blakeblackshear/frigate',
            minVersion: '0.14.0',
            volumes: [{ name: 'cache', path: '/tmp/cache', isCache: true }],
            env: {
              TZ: '{platform.timezone}',
              MODE: { value: 'fast', when: { key: 'isFast', equals: [true] } },
            },
          }),
        ],
      }),
      OPTIONS,
    );

    expect(compose.manifest).toMatchObject({
      runtime: 'container',
      compose: { file: './compose.yaml' },
    });
    expect(compose.copies).toEqual([{ from: './deploy/compose.yaml', to: 'compose.yaml' }]);
    expect(containers.manifest).toHaveProperty(
      ['containers', 0],
      expect.objectContaining({
        volumes: [{ name: 'cache', path: '/tmp/cache', cache: true }],
        env: [
          { name: 'TZ', value: '{platform.timezone}' },
          { name: 'MODE', value: 'fast', when: { key: 'isFast', equals: [true] } },
        ],
      }),
    );
  });

  it('names every problem, in the declaration’s terms', () => {
    expect(problemsOf({ id: 'x' })).toEqual([
      'nebula.config.ts must default-export the package: export default definePackage({ … })',
    ]);
    expect(
      problemsOf({
        ...template,
        id: 'core',
        ui: { cards: { other: async () => Promise.resolve(Component) } },
      }),
    ).toEqual([
      "ui.cards.ticks: the card has no component: () => import('./card.js')",
      'ui.cards.other: is not one of the declared cards',
      'id: Is the name of a part of the platform, which no package may take',
    ]);
  });

  it('records the SDK’s major and minor, and reads the repository from package.json', () => {
    expect(sdkRangeOf('1.3.2-rc.1')).toBe('^1.3.0');
    expect(githubRepositoryOf('github:nebulahome/pkg-nvr')).toBe('nebulahome/pkg-nvr');
    expect(githubRepositoryOf({ url: 'https://github.com/nebulahome/pkg-nvr.git' })).toBe(
      'nebulahome/pkg-nvr',
    );
    expect(githubRepositoryOf('https://gitlab.com/someone/thing')).toBeUndefined();
  });
});

/**
 * The definitions, at run time - what each `define*` returns - and at compile time: the types a
 * declaration gives its components, its settings and its entities, and the mistakes TypeScript
 * refuses (each `@ts-expect-error` below fails the typecheck if the mistake stops being one).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  defineBackground,
  defineCard,
  defineCompose,
  defineContainer,
  defineEntityType,
  definePackage,
  definePage,
  defineSettings,
  field,
  type ArgsOf,
  type CardProps,
  type EntityViewProps,
  type OptionsOf,
  type SettingsOf,
  type ValuesOf,
} from './index.js';

const settings = defineSettings({
  city: field.text({ label: 'City', isRequired: true }),
  apiKey: field.secret({ label: 'API key' }),
  refreshMinutes: field.number({ label: 'Refresh every', default: 30, isLive: true }),
  units: field.choice({
    label: 'Units',
    choices: [
      { value: 'metric', label: 'Metric' },
      { value: 'imperial', label: 'Imperial' },
    ],
    default: 'metric',
  }),
  stations: field.list({ label: 'Stations' }),
});

const forecast = defineCard({
  id: 'forecast',
  name: 'Forecast',
  icon: 'cloud-sun',
  sizes: ['wide', 'medium'],
  options: {
    days: field.number({ label: 'Days', default: 3 }),
    station: field.text({ label: 'Station' }),
  },
});

const alert = defineEntityType({
  id: 'alert',
  name: 'Weather alert',
  icon: 'triangle-alert',
  state: {
    level: field.choice({
      label: 'Level',
      choices: [
        { value: 'yellow', label: 'Yellow' },
        { value: 'red', label: 'Red' },
      ],
    }),
    until: field.timestamp({ label: 'Until', isOptional: true }),
  },
  commands: {
    dismiss: { name: 'Dismiss' },
    snooze: { name: 'Snooze', fields: { minutes: field.number({ label: 'Minutes' }) } },
  },
});

/**
 * The forecast card's component.
 *
 * @param props - What the card is given.
 * @returns Nothing drawn: only the types matter here.
 */
function ForecastCard(props: CardProps<typeof forecast>): null {
  expectTypeOf(props.size).toEqualTypeOf<'wide' | 'medium'>();
  expectTypeOf(props.options).toEqualTypeOf<{
    readonly days: number;
    readonly station?: string | undefined;
  }>();

  return null;
}

/**
 * The alert view.
 *
 * @param props - What the view is given.
 * @returns Nothing drawn.
 */
function AlertView(props: EntityViewProps<typeof alert>): null {
  expectTypeOf(props.type).toEqualTypeOf<'alert'>();

  return null;
}

describe('the definitions', () => {
  it('return what they were given, marked with what they are', () => {
    expect(forecast).toMatchObject({ kind: 'card', id: 'forecast', sizes: ['wide', 'medium'] });
    expect(alert.kind).toBe('entityType');
    expect(settings).toMatchObject({ kind: 'settings', fields: { city: { kind: 'text' } } });
    expect(defineCompose({ file: './compose.yaml' })).toEqual({
      kind: 'compose',
      file: './compose.yaml',
    });
    expect(
      defineContainer({ id: 'db', name: 'DB', image: 'postgres', minVersion: '16.0.0' }).kind,
    ).toBe('container');
    expect(
      defineBackground({
        component: async () => Promise.resolve(() => null),
        description: 'Keeps the forecast fresh.',
      }),
    ).toMatchObject({ kind: 'background', description: 'Keeps the forecast fresh.' });
  });

  it('bind components to the cards and types they draw', async () => {
    const weather = definePackage({
      id: 'weather',
      name: 'Weather',
      description: 'Forecasts.',
      category: 'climate',
      platform: '^1.0.0',
      settings,
      cards: [forecast],
      entityTypes: [alert],
      ui: {
        page: definePage({ component: async () => Promise.resolve(() => null) }),
        cards: { forecast: async () => Promise.resolve(ForecastCard) },
        entityViews: { alert: async () => Promise.resolve({ default: AlertView }) },
      },
    });

    expect(weather.kind).toBe('package');
    expect(await weather.ui?.cards?.forecast()).toBe(ForecastCard);
  });

  it('type settings, options, entity values and command arguments', () => {
    expectTypeOf<SettingsOf<typeof settings>>().toEqualTypeOf<{
      readonly city: string;
      readonly refreshMinutes: number;
      readonly units: 'metric' | 'imperial';
      readonly apiKey?: string | undefined;
      readonly stations?: readonly string[] | undefined;
    }>();
    expectTypeOf<OptionsOf<typeof forecast>>().toHaveProperty('days').toEqualTypeOf<number>();
    expectTypeOf<ValuesOf<typeof alert>>().toEqualTypeOf<{
      readonly level: 'yellow' | 'red';
      readonly until?: string | null;
    }>();
    expectTypeOf<ArgsOf<typeof alert, 'snooze'>>().toEqualTypeOf<{ readonly minutes: number }>();
  });

  it('refuse a field where it does not fit, and a component where it does not belong', () => {
    defineSettings({
      // @ts-expect-error - a setting is required or not, never optional
      city: field.text({ label: 'City', isOptional: true }),
    });
    defineSettings({
      // @ts-expect-error - a timestamp is never asked in a form
      since: field.timestamp({ label: 'Since' }),
    });
    defineCard({
      id: 'secretive',
      name: 'Secretive',
      icon: 'lock',
      // @ts-expect-error - a card's options hold no secret
      options: { token: field.secret({ label: 'Token' }) },
    });
    defineEntityType({
      id: 'note',
      name: 'Note',
      icon: 'sticky-note',
      // @ts-expect-error - an entity's field has no default
      state: { text: field.text({ label: 'Text', default: '' }) },
    });

    const other = defineCard({ id: 'other', name: 'Other', icon: 'square' });

    definePackage({
      id: 'weather',
      name: 'Weather',
      description: 'Forecasts.',
      category: 'climate',
      platform: '^1.0.0',
      cards: [forecast, other],
      ui: {
        // @ts-expect-error - every declared card has a component
        cards: { forecast: async () => Promise.resolve(ForecastCard) },
      },
    });
    definePackage({
      id: 'weather',
      name: 'Weather',
      description: 'Forecasts.',
      category: 'climate',
      platform: '^1.0.0',
      cards: [other],
      ui: {
        cards: {
          // @ts-expect-error - the forecast card's component does not take the other card's props
          other: async () => Promise.resolve(ForecastCard),
        },
      },
    });
    // @ts-expect-error - declared containers or a compose file, not both
    definePackage({
      id: 'weather',
      name: 'Weather',
      description: 'Forecasts.',
      category: 'climate',
      platform: '^1.0.0',
      containers: [
        defineContainer({ id: 'db', name: 'DB', image: 'postgres', minVersion: '1.0.0' }),
      ],
      compose: defineCompose({ file: './compose.yaml' }),
    });
  });
});

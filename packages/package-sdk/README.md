# @nebulahome/package-sdk

What a NebulaHome package is written with. A **package** is something an installation adds to
itself that is not a device brand - a broker, a recorder, a 3D view of the house, a music player.
It runs a Node process, containers or a compose file, or nothing, and may add a page of its own,
dashboard cards and views of its own kinds of entity to the interface.

Start from the template, [nebulahome/pkg-template](https://github.com/nebulahome/pkg-template):
a small package that uses each part of the SDK once. The full reference is `PACKAGES_DOCS.md` in
the NebulaHome documentation.

```bash
pnpm add @nebulahome/package-sdk
pnpm add -D vite typescript react @types/react @vitejs/plugin-react tailwindcss @tailwindcss/vite
```

## A package in three files

```ts
// nebula.config.ts - what the package is; the build writes the manifest from it
import { defineCard, definePackage, defineSettings, field } from '@nebulahome/package-sdk';

export const settings = defineSettings({
  city: field.text({ label: 'City', isRequired: true }),
  refreshMinutes: field.number({ label: 'Refresh every', unit: 'min', default: 30, isLive: true }),
});

export const forecast = defineCard({
  id: 'forecast',
  name: 'Forecast',
  icon: 'cloud-sun',
  sizes: ['wide'],
  options: { days: field.number({ label: 'Days', min: 1, max: 7, default: 3 }) },
});

export default definePackage({
  id: 'weather',
  name: 'Weather',
  description: 'Forecasts for where the house is.',
  category: 'climate',
  platform: '^1.0.0',
  server: './src/server/index.ts',
  settings,
  cards: [forecast],
  ui: { cards: { forecast: async () => import('./src/ui/forecast-card.js') } },
});
```

```ts
// src/server/index.ts - runs in a process of its own
import { defineServer } from '@nebulahome/package-sdk/server';

import { settings } from '../../nebula.config.js';

export default defineServer({
  settings,
  start(ctx) {
    ctx.rpc.method('forecast', { access: 'read' }, async () => fetchDays(ctx.settings.city));

    return undefined;
  },
});
```

```tsx
// src/ui/forecast-card.tsx - any React, any CSS; the interface draws only the frame
import { usePackageRpc, type CardProps } from '@nebulahome/package-sdk/ui';

import type { forecast } from '../../nebula.config.js';

export default function ForecastCard({ options, title, name }: CardProps<typeof forecast>) {
  const days = usePackageRpc<Day[]>('forecast');

  return <Strip title={title ?? name} days={days.data?.slice(0, options.days)} />;
}
```

```ts
// vite.config.ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { nebula } from '@nebulahome/package-sdk/vite';

export default defineConfig({ plugins: [react(), tailwindcss(), nebula()] });
```

## Translating the interface

The page, the cards and the entity views say their strings through `useTranslation()`, with the
English beside each key; a catalogue per language goes in `locales/` next to `nebula.config.ts`:

```tsx
// src/ui/forecast-card.tsx
import { useTranslation } from '@nebulahome/package-sdk/ui';

const { t } = useTranslation();

t('forecast.empty', 'No forecast yet');
t('forecast.days', { one: '{{count}} day', other: '{{count}} days' }, { count: days.length });
```

```json
// locales/it.json
{
  "forecast": {
    "empty": "Ancora nessuna previsione",
    "days_one": "{{count}} giorno",
    "days_other": "{{count}} giorni"
  }
}
```

A string a catalogue lacks is said in English, and `nebulahome-package build` lists them. What
`nebula.config.ts` declares (the package's name, its cards' and settings' names, its entity types)
stays English: the platform shows it the same way to everyone.

## The past, the areas and the sun

```tsx
// a sensor's chart: the last 6 hours, in minutes
const day = useTelemetry({ entityIds: [entityId], window: { lastMs: 6 * 3_600_000 } });
const points = day.series[entityId] ?? []; // oldest first: { time, value, min, max }

// what a door did today, and the rooms of the house
const today = useStateHistory({ entityIds: [door], window: { from: midnight, to: now } });
const rooms = useAreas().filter((area) => area.kind === 'room');
```

```ts
// on the server, with the house's authority
const { series } = await ctx.history.states({ entityIds, from: yesterday, to: new Date() });
```

```ts
// where the sun was, for a moment the sun entities did not report
import { sunPosition } from '@nebulahome/package-sdk/sun';

const { elevation, azimuth } = sunPosition(at, { latitude, longitude });
```

## Toasts

The interface's own toasts, for the outcome of something the viewer just did (since 1.4):

```tsx
const toast = useToast();
const save = usePackageMutation('rules.save');

try {
  await save.mutate(rules);
  toast.success({ title: t('save.done', 'Saved') });
} catch (error) {
  toast.error({ title: t('save.failed', "Couldn't save"), message: String(error) });
}
```

## The live channel

Messages between the server and its open interfaces over the interface's own socket, both ways,
with no polling and no HTTP rate limit (since 1.5). Whoever may read packages follows and sends.

```ts
// on the server: what every page and card draws, kept for whoever opens one later
ctx.live.publish('overview', overviewOf(), { isRetained: true });

// and what the interface sends, with who sent it
ctx.live.onMessage('player.report', { input: reportSchema }, (report, { caller }) => {
  ctx.live.publish(`player.${report.playerId}`, orderFor(report));
});
```

```tsx
const { data, isConnected } = usePackageLive<Overview>('overview'); // one subscription per page
const send = usePackageSend();

send('player.report', { playerId, position });
```

A topic is a letter, then letters, digits and `.`, `_`, `:`, `-`; a message from the server is at
most 1 MB as JSON, one from the interface 64 KB, and an interface sends at most 50 a second.
Nothing answers a message: a call that wants an answer or an error stays `usePackageCall`.

## The background and floating windows

A component drawn on every page for as long as somebody is signed in and the package runs, for
what must outlive a page, and a window floating over the pages (since 1.6):

```ts
// nebula.config.ts
ui: {
  background: defineBackground({
    component: () => import('./src/ui/background.js'),
    description: 'Keeps music playing in this browser when you leave the Music page.',
  }),
}
```

```tsx
// src/ui/background.tsx: every hook works here; start things in effects, the unmount stops them
export default function Background() {
  const { t } = useTranslation();

  return (
    <Floating open={isPlaying} label={t('mini.label', 'Now playing')}>
      <MiniPlayer />
    </Floating>
  );
}
```

The window rests in a corner of the page beside the rail and is thrown from corner to corner, or
flung right past the edge to tuck it away with a strip showing, until a click brings it back; it
is hidden on the package's own page and on a phone. `onClose` gives it a close button. Its frame is
glass with a border and no padding, at most 400 px wide: the content pads itself and leaves room
for the close button in the top-right corner.

## Entry points

| Import                    | What                                                                                                                                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nebulahome/package-sdk` | `definePackage`, `defineSettings`, `defineCard`, `defineEntityType`, `definePage`, `defineBackground`, `defineContainer`, `defineCompose`, `field`, entity id helpers, `SDK_VERSION`, the value types.                                                                                    |
| `/server`                 | `defineServer`, and the context `start` is given: settings (live or restart), devices and entities, typed custom entities, the rest of the house and its past, methods and the live channel for the interface, services between packages.                                                 |
| `/ui`                     | The props of a page, a background, a card and an entity view; `Floating`; hooks for the package, its methods and live topics, its settings, the house, its areas, its past and its pictures, the viewer, the theme, its strings; navigation inside the package's page and the platform's. |
| `/sun`                    | Where the sun is at any moment, by the platform's own formulas.                                                                                                                                                                                                                           |
| `/components`             | The part of the interface's design system a package may draw with.                                                                                                                                                                                                                        |
| `/vite`                   | `nebula()`, the Vite plugin that builds both halves: the interface in chunks with its CSS scoped to the package, the server bundled whole.                                                                                                                                                |
| `/testing`                | `createTestContext()`: run `start` in a unit test, every effect recorded.                                                                                                                                                                                                                 |
| `/styles.css`             | The interface's Tailwind tokens, to `@reference`.                                                                                                                                                                                                                                         |

The `nebulahome-package` command checks, builds and packs a package:

```bash
nebulahome-package validate   # the declaration holds together, as the platform checks it
nebulahome-package build      # dist/: what an installation runs
nebulahome-package pack       # <id>-<version>.tgz and its entry for the package index
```

## Compatibility

The SDK follows SemVer, and its types are the contract: the platform implements them, so the
package and the platform cannot drift apart unnoticed. A package's manifest records the SDK it was
built with (`sdk: ^<major>.<minor>.0`), and the platform refuses to install or start a release it
does not implement. A minor of the SDK is published only together with a platform release that
implements it. React's major is part of the contract.

## Releasing the SDK

For the platform's maintainers. The packet-manager reads the version it implements from this
`package.json`, so the version is raised by hand:

- **patch** - a fix, or a change to the command, the build, the tests' helpers or the
  documentation that leaves what a package can use as it is. Packages keep declaring
  `^<major>.<minor>.0`, so it is released whenever it is ready.
- **minor** - the API grows. Raise it in the first commit that grows it, so a package using the
  new part is never installed on a platform without it; release it with the platform that
  implements it.
- **major** - the API breaks: packages built before are refused until they are built again.

Every change of the release goes into `CHANGELOG.md`. Then, from the commit released:

```sh
git tag package-sdk@<version> && git push origin package-sdk@<version>
```

`.github/workflows/release-package-sdk.yml` checks the tag says the package's version, runs the
SDK's gates and keeps the archive npm will receive as the run's artifact; it makes no GitHub
release, npm is where the SDK is published. The maintainer downloads that artifact from the run
and publishes it, signed in to npm:

```sh
npm publish nebulahome-package-sdk-<version>.tgz
```

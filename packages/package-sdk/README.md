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

## Entry points

| Import                    | What                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nebulahome/package-sdk` | `definePackage`, `defineSettings`, `defineCard`, `defineEntityType`, `definePage`, `defineContainer`, `defineCompose`, `field`, entity id helpers, `SDK_VERSION`, the value types.                      |
| `/server`                 | `defineServer`, and the context `start` is given: settings (live or restart), devices and entities, typed custom entities, the rest of the house, methods for the interface, services between packages. |
| `/ui`                     | The props of a page, a card and an entity view; hooks for the package, its methods, its settings, the house, the viewer, the theme; navigation inside the package's page and to the platform's places.  |
| `/components`             | The part of the interface's design system a package may draw with.                                                                                                                                      |
| `/vite`                   | `nebula()`, the Vite plugin that builds both halves: the interface in chunks with its CSS scoped to the package, the server bundled whole.                                                              |
| `/testing`                | `createTestContext()`: run `start` in a unit test, every effect recorded.                                                                                                                               |
| `/styles.css`             | The interface's Tailwind tokens, to `@reference`.                                                                                                                                                       |

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
SDK's gates and publishes a GitHub release with the archive npm will receive. The maintainer
publishes that archive, signed in to npm:

```sh
npm publish nebulahome-package-sdk-<version>.tgz
```

# @nebulahome/package-sdk

The SDK's version is the version of the package API the platform implements: a minor version adds
to it, a major one breaks it, and a patch leaves it as it is.

## 1.1.0

- `useTranslation()` in `@nebulahome/package-sdk/ui`: a package's page, cards and entity views
  say their strings with `t('clients.title', 'Clients')`, in the viewer's language. The English
  is the fallback, and a plural takes `{ one, other }` with `count`; outside the interface - a
  component's unit test - every string is its English.
- Catalogues: `locales/<language>.json` beside `nebula.config.ts` (`it.json`, `pt-BR.json`), JSON
  objects of strings nested as the keys are dotted, with i18next's plural suffixes and
  `{{placeholders}}`. `nebula()` bundles each as a chunk of the interface, loaded only for a viewer
  who reads that language; `validate` checks them (a language for a name, strings only, plurals
  with their `_other`, at most 256 KB); `build` warns which strings a catalogue says in English
  and which of its keys no string uses.
- What `nebula.config.ts` declares - names, settings, entity types - stays English, as the
  platform shows it everywhere.

## 1.0.1

- `nebulahome-package --help`, and a mistyped command, work where Vite is not installed -
  `npx -p @nebulahome/package-sdk nebulahome-package --help` in an empty folder. `validate`,
  `build` and `pack` run without it say what to install in the package's folder, instead of
  failing with `ERR_MODULE_NOT_FOUND`.

## 1.0.0

The first public release.

- `nebula.config.ts`: `definePackage`, `defineSettings`, `defineCard`, `defineEntityType`,
  `definePage`, `defineContainer`, `defineCompose` and `field` declare a package, from which the
  build writes `nebula.package.json` and `setup.json`.
- `@nebulahome/package-sdk/server`: `defineServer`, and the context `start` is given - settings,
  devices and entities, the package's own kinds of entity, methods for the interface and services
  between packages.
- `@nebulahome/package-sdk/ui`: the props of a page, a card and an entity view, and the hooks for
  the package, its methods and settings, the house, the viewer, the theme and navigation.
- `@nebulahome/package-sdk/components` and `/styles.css`: the part of the interface's design
  system a package may draw with, and its Tailwind tokens.
- `@nebulahome/package-sdk/vite`: `nebula()`, the Vite plugin that builds the interface with its
  CSS scoped to the package and bundles the server.
- `nebulahome-package validate`, `build` and `pack`: check the declaration the way the platform
  does, build the release into `dist/`, and pack it into the `<id>-<version>.tgz` a GitHub release
  carries with its entry for the package index.
- `@nebulahome/package-sdk/testing`: `createTestContext`, to run `start` in a unit test with every
  effect recorded.

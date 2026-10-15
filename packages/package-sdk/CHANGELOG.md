# @nebulahome/package-sdk

The SDK's version is the version of the package API the platform implements: a minor version adds
to it, a major one breaks it, and a patch leaves it as it is.

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

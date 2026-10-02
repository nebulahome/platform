# Changesets

Only `@nebulahome/package-sdk` is versioned here: it is the one package published on npm, and
every other workspace is private (`privatePackages` is off). A change to the SDK that a package
author can see comes with a changeset:

```bash
pnpm changeset
```

The SDK is in prerelease mode (`pre.json`, tag `rc`): its versions are `1.0.0-rc.N`, published
under the `rc` dist-tag, until `pnpm changeset pre exit` makes the next one `1.0.0`. A version of
the SDK is published only together with a platform release that implements it
(PACKAGES_DOCS.md 11).

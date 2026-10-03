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

Publishing is `.github/workflows/release-sdk.yml`, on `main`: while changesets are pending it
opens the pull request that versions the SDK, and once that is merged it publishes the new
version through npm's trusted publishing, with provenance. Before the first publish, the
`@nebulahome` organization must exist on npmjs.com and list this repository's `release-sdk.yml`
as the package's trusted publisher.

`@nebulahome/integration-sdk` is ready to be published the same way but is marked `private` until
it is: without the flag, `changeset publish` would publish it on the next run on `main`. To publish
it, remove `"private": true` from its `package.json`, build and check it in `release-sdk.yml`
beside the package SDK, and add it to the trusted publishers. Its version is the integration
contract's (INTEGRATIONS_DOCS.md 11): the hub reads it from the SDK's `package.json`, and a
changeset that raises it changes what bundles the platform loads.

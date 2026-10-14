# Changesets

Only `@nebulahome/package-sdk` is versioned here: every other workspace is private
(`privatePackages` is off), and `@nebulahome/integration-sdk`, published too, is in `ignore` (see
below). A change to the package SDK that a package author can see comes with a changeset:

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

`@nebulahome/integration-sdk` is published on npm but not through changesets: it is in `ignore`,
which `changeset version` and `changeset publish` both honour, so `release-sdk.yml` never versions
or publishes it. Keep it there - without it the next run on `main` would publish the integration
SDK unbuilt - and write no changeset naming it: one naming both SDKs is refused, and one naming
only it is never consumed. Its version is the integration contract's (INTEGRATIONS_DOCS.md 10):
the hub reads it from the SDK's `package.json`, so it is raised by hand, and released from a tag
by `.github/workflows/release-integration-sdk.yml` (the SDK's README, Releasing the SDK).

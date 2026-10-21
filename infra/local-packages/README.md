# Local packages

Releases put here by hand, to try a package on a running platform before it is released. The
packet-manager offers each one in the store, beside the package index's releases, and installs it
the way it installs a downloaded one: the same checks, the same folder, the same dependencies.

1. In the package's repository: `pnpm nebulahome-package build` and `pnpm nebulahome-package pack`
   (no `--url` needed: only `<id>-<version>.tgz` is written).
2. Copy `<id>-<version>.tgz` here.
3. In the interface, **Packages**: the package is offered with a **Local file** badge. Install it.

To try another build without raising the version, overwrite the file and press **Reinstall** on the
package's page: the release is unpacked again over the one installed and started, with no going
back to the build before.

Who reads this folder:

- `pnpm dev`: the packet-manager reads `infra/local-packages` itself, outside production.
- The image, for now: what this folder holds when it is built ships at `/app/local-packages`
  (`PACKET_MANAGER_LOCAL_DIR`), so an image pushed and run elsewhere offers it too.
- `pnpm docker:up`: `infra/docker-compose.yml` also mounts the folder over that path, read live.
- A production installation offers what its image carries; `PACKET_MANAGER_LOCAL_DIR` can name
  another folder.

Everything here but this file is ignored by git; for now it is copied into the image.

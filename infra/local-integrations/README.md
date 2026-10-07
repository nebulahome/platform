# Local integrations

Bundles put here by hand, to try an integration on a running platform before it is released. The
packet-manager offers each one in **Integrations → Install**, beside the integrations index's
releases, and installs it the way it installs a downloaded one: the same checks, a folder of its
own build under `hub/integrations/<vendor>/`, and `hub` loading it without restarting.

1. In the integration's repository: `pnpm nebulahome-integration build`, then
   `pnpm nebulahome-integration pack` (`pnpm pack` is pnpm's own command, not this one): only
   `<vendor>-<version>.tgz` is written, its files under a `<vendor>/` folder.
2. Copy `<vendor>-<version>.tgz` here.
3. In the interface, **Integrations → Install**: the integration is listed first, as a local file.
   Install it; its page opens once `hub` has loaded it.

To try another build without raising the version, overwrite the file and press **Reinstall** on the
integration's page: the new build is unpacked beside the one running, `hub` swaps the two once the
new one loads, and the build before is deleted. A build `hub` does not load is taken away, and the
one before runs on.

Who reads this folder:

- `pnpm dev`: the packet-manager reads `infra/local-integrations` itself, outside production.
- `pnpm docker:up`: `infra/docker-compose.yml` mounts it at `/app/local-integrations`
  (`PACKET_MANAGER_LOCAL_INTEGRATIONS_DIR`).
- A production installation has no local folder unless `PACKET_MANAGER_LOCAL_INTEGRATIONS_DIR`
  names one.

Everything here but this file is ignored by git and left out of the image. An integration
installed from here is never reported to the Community Hub.

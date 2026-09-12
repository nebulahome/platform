/**
 * The packages: what is installed on this box, and how each one is faring.
 *
 * **Not the integrations.** This page briefly showed those and it was wrong. A package is the
 * unit that ships and is supervised — a process or a container with a manifest, a version and a
 * lifecycle. An integration is a driver bound to a transport, and it has its own section. A
 * package may contribute one; a house may run three instances of that one; neither fact fits in
 * a row shared between them.
 *
 * **Read-only, and not by choice.** Installing, starting and stopping belong to
 * `packet-manager`, which is not built — and the constraint is stricter than a missing service:
 * `nebula_api` holds `SELECT` on `system.packages` and nothing more, because those rows are not
 * its to write (DATABASE.md §12). Even the endpoint would be refused by the database. Buttons
 * are therefore absent rather than disabled, and the page says why once.
 *
 * The state is a word as well as a colour. A package that has failed is the thing somebody came
 * here to find, and `lastError` is the answer they came for, so it is shown rather than hidden
 * behind a row that has to be opened.
 */
import { useQuery } from '@tanstack/react-query';

import type { PackageState } from '@nebula-home/contracts';
import { Badge, Panel, PanelNote, PanelRow, type BadgeTone } from '@nebula-home/ui';

import { relativeTime } from '@/lib/format-time';
import { fetchPackages, LIBRARY_QUERY_KEYS } from '@/library/api';
import { LibraryPage } from '@/routes/library/library-page';

/** What each lifecycle state means to somebody reading the page. */
const TONES: Readonly<Record<PackageState, BadgeTone>> = {
  installed: 'neutral',
  starting: 'accent',
  running: 'success',
  stopped: 'neutral',
  failed: 'danger',
  disabled: 'neutral',
};

/**
 * Renders the integrations page.
 *
 * @returns The page.
 */
export function PackagesPage() {
  const packages = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.packages,
    /**
     * Reads every installed package.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every integration and how it is faring.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchPackages(signal),
  });

  const items = packages.data ?? [];

  return (
    <LibraryPage
      title="Packages"
      hasTabs={false}
      summary="What is installed on this box: what each one is, how it runs, and how much of the house it accounts for."
      noun="package"
      count={packages.isPending ? undefined : items.length}
      isPending={packages.isPending}
      error={packages.error}
      isEmpty={items.length === 0}
      emptyMessage="Nothing installed. Installing is packet-manager's to do, and it is not built yet."
    >
      <Panel title="Installed">
        {items.map((installed) => (
          <PanelRow
            key={installed.id}
            title={
              <span className="flex items-center gap-2.5">
                <span className="font-mono">{installed.id}</span>
                <Badge tone={TONES[installed.state]}>{installed.state}</Badge>
              </span>
            }
            note={
              <span className="flex flex-col gap-1">
                <span>
                  {installed.version} · {installed.runtime} · {installed.entityCount} entit
                  {installed.entityCount === 1 ? 'y' : 'ies'} · {installed.deviceCount} device
                  {installed.deviceCount === 1 ? '' : 's'}
                </span>

                {installed.lastError === null ? null : (
                  <span className="text-danger">{installed.lastError}</span>
                )}
              </span>
            }
            control={
              <span className="text-caption text-foreground-subtle tabular">
                {installed.lastStartedAt === null
                  ? 'never started'
                  : `started ${relativeTime(installed.lastStartedAt)}`}
              </span>
            }
          />
        ))}

        <PanelNote>
          Starting, stopping and installing are not here: those rows belong to packet-manager, which
          is not built, and this service holds read access to them and nothing more.
        </PanelNote>
      </Panel>
    </LibraryPage>
  );
}

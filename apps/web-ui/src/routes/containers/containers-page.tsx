/**
 * The containers the machine runs.
 *
 * Every container Docker has, the platform's own among them - marked, and never controlled from
 * here - with how busy each is, what it runs, and whether a newer image is out. A container an
 * integration runs says which: it is started, stopped and updated by the integration, and its page
 * says so where the buttons would be.
 *
 * When Docker cannot be seen - its socket was not given to the platform, the supervisor is not
 * running - the page says so and why, in a card of its own rather than an empty list, because an
 * empty list would say the machine runs nothing.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';

import { Button, Panel, PanelNote, PanelRow, SelectField } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { checkContainerUpdates, CONTAINER_QUERY_KEYS, fetchContainers } from '@/containers/api';
import {
  CONTAINER_FILTER_CODEC,
  matchesContainer,
  OPEN_CONTAINER_FILTER,
  type ContainerOwnerChoice,
  type ContainerRunChoice,
} from '@/containers/container-filters';
import { formatBytes, formatPercent } from '@/lib/format-bytes';
import { useListState } from '@/lib/use-list-state';
import { ContainerBadges, DockerUnavailable } from '@/routes/containers/container-parts';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';

/** The run choices, for the facet. */
const RUN_OPTIONS: readonly { readonly value: ContainerRunChoice; readonly label: string }[] = [
  { value: 'any', label: 'Running or not' },
  { value: 'running', label: 'Running' },
  { value: 'stopped', label: 'Stopped' },
];

/** The owner choices, for the facet. */
const OWNER_OPTIONS: readonly { readonly value: ContainerOwnerChoice; readonly label: string }[] = [
  { value: 'any', label: 'Anyone' },
  { value: 'platform', label: 'The platform' },
  { value: 'integration', label: 'An integration' },
  { value: 'other', label: 'You' },
];

/**
 * Renders the containers page.
 *
 * @returns The page.
 */
export function ContainersPage() {
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const containers = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.list,

    /**
     * Reads every container.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Docker's status and the containers.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchContainers(signal),

    // The readings move every ten seconds; the page follows them while it is looked at.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
  const check = useMutation({
    mutationFn: checkContainerUpdates,

    /** Reads the list again a moment later, when the registries have had time to answer. */
    onSuccess: () => {
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.all });
      }, 4000);
    },
  });

  const [filter, setFilter] = useListState(CONTAINER_FILTER_CODEC);
  const docker = containers.data?.docker;
  const items = containers.data?.items ?? [];
  const shown = items.filter((container) => matchesContainer(container, filter));
  const narrowed = Number(filter.run !== 'any') + Number(filter.owner !== 'any');

  return (
    <LibraryPage
      title="Containers"
      noun="container"
      count={containers.isPending ? undefined : items.length}
      shownCount={shown.length}
      summary={
        docker?.isAvailable === true
          ? [
              `Docker ${docker.version ?? ''}`,
              docker.platformNetwork === 'host' ? 'host network' : null,
            ]
          : undefined
      }
      tools={
        <>
          <SearchField
            placeholder="Search containers…"
            value={filter.search}
            onChange={(search) => {
              setFilter({ ...filter, search });
            }}
          />
          <FilterSheet
            label="Narrow the containers"
            count={narrowed}
            onClear={() => {
              setFilter({ ...filter, run: 'any', owner: 'any' });
            }}
          >
            <Facet title="Running">
              <SelectField
                label="Running"
                isLabelHidden
                size="compact"
                options={RUN_OPTIONS}
                value={filter.run}
                onChange={(run) => {
                  setFilter({
                    ...filter,
                    run: RUN_OPTIONS.find((option) => option.value === run)?.value ?? 'any',
                  });
                }}
              />
            </Facet>
            <Facet title="Belongs to">
              <SelectField
                label="Belongs to"
                isLabelHidden
                size="compact"
                options={OWNER_OPTIONS}
                value={filter.owner}
                onChange={(owner) => {
                  setFilter({
                    ...filter,
                    owner: OWNER_OPTIONS.find((option) => option.value === owner)?.value ?? 'any',
                  });
                }}
              />
            </Facet>
          </FilterSheet>
        </>
      }
      action={
        can('container:control') && docker?.isAvailable === true ? (
          <Button
            variant="ghost"
            size="compact"
            isBusy={check.isPending}
            onClick={() => {
              check.mutate();
            }}
          >
            Check for updates
          </Button>
        ) : undefined
      }
      isPending={containers.isPending}
      error={containers.error}
      isEmpty={docker?.isAvailable === true && items.length === 0}
      emptyMessage="Docker runs no container on this machine."
    >
      {docker !== undefined && !docker.isAvailable ? <DockerUnavailable docker={docker} /> : null}

      {docker?.isAvailable === true && shown.length === 0 ? (
        <NoMatches
          query={filter.search}
          onClear={() => {
            setFilter(OPEN_CONTAINER_FILTER);
          }}
        />
      ) : null}

      {shown.length === 0 ? null : (
        <Panel title="On this machine">
          {shown.map((container) => (
            <PanelRow
              key={container.id}
              title={
                <span className="flex flex-wrap items-center gap-2.5">
                  <Link
                    to={`/containers/${encodeURIComponent(container.name)}`}
                    className="font-mono text-foreground underline-offset-2 hover:underline"
                  >
                    {container.name}
                  </Link>
                  <ContainerBadges container={container} />
                </span>
              }
              note={
                <span className="flex flex-col gap-0.5">
                  <span className="truncate font-mono text-caption">{container.image}</span>
                  <span>
                    {container.version === null ? null : `${container.version} · `}
                    {container.status}
                  </span>
                </span>
              }
              control={
                container.state === 'running' ? (
                  <span className="flex flex-col items-end text-caption text-foreground-subtle tabular">
                    <span>CPU {formatPercent(container.cpuPercent)}</span>
                    <span>
                      RAM{' '}
                      {container.memoryUsedBytes === null
                        ? '—'
                        : formatBytes(container.memoryUsedBytes)}
                    </span>
                  </span>
                ) : undefined
              }
            />
          ))}

          <PanelNote>
            The platform&apos;s own container is shown and never stopped from here, and one an
            integration runs is started, stopped and updated by the integration.
          </PanelNote>
        </Panel>
      )}
    </LibraryPage>
  );
}

/**
 * The containers the machine runs, as a grid of cards like the integrations'.
 *
 * One card per compose project - the platform's own first, called NebulaHome - opening a page of
 * the project's containers, and one per container started on its own, opening the container's
 * page. What each card says is whether it runs and what it takes of the machine; everything else
 * is a click away.
 *
 * The owner adds from here: **Install container** looks an image up on Docker Hub and runs it,
 * **New compose** takes a compose file, written or uploaded. Both answer at once and the work goes
 * on in a card of its own - an image being pulled, a project being brought up - until it is a
 * container. Newer images are looked for every few hours on their own, so there is no button for
 * it.
 *
 * When Docker cannot be seen - its socket was not given to the platform, the supervisor is not
 * running - the page says so and why, in a card of its own rather than an empty grid, because an
 * empty grid would say the machine runs nothing.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MenuButton, SelectField, TILE_GRID } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { CONTAINER_QUERY_KEYS, dismissInstall, fetchContainers } from '@/containers/api';
import {
  CONTAINER_FILTER_CODEC,
  OPEN_CONTAINER_FILTER,
  type ContainerOwnerChoice,
  type ContainerRunChoice,
} from '@/containers/container-filters';
import { containerTiles } from '@/containers/container-groups';
import { defineMessage, type Message, translate, withLabels } from '@/i18n/messages';
import { useListState } from '@/lib/use-list-state';
import { ComposeEditorDialog } from '@/routes/containers/compose-editor-dialog';
import { ComposeCard, ContainerCard, InstallCard } from '@/routes/containers/container-card';
import { DockerUnavailable } from '@/routes/containers/container-parts';
import { InstallContainerDialog } from '@/routes/containers/install-container-dialog';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';

/** The run choices, for the facet. */
const RUN_OPTIONS: readonly { readonly value: ContainerRunChoice; readonly label: Message }[] = [
  { value: 'any', label: defineMessage('containers.containers.runningOrNot', 'Running or not') },
  { value: 'running', label: defineMessage('containers.containers.running', 'Running') },
  { value: 'stopped', label: defineMessage('containers.containers.stopped', 'Stopped') },
];

/** The owner choices, for the facet. */
const OWNER_OPTIONS: readonly { readonly value: ContainerOwnerChoice; readonly label: Message }[] =
  [
    { value: 'any', label: defineMessage('containers.containers.anyone', 'Anyone') },
    { value: 'system', label: defineMessage('containers.containers.platform', 'The platform') },
    {
      value: 'integration',
      label: defineMessage('containers.containers.integration', 'An integration'),
    },
    { value: 'other', label: defineMessage('containers.containers.you', 'You') },
  ];

/**
 * Renders the containers page.
 *
 * @returns The page.
 */
export function ContainersPage() {
  const { t } = useTranslation();

  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const canInstall = can('container:install');
  const [isInstalling, setInstalling] = useState(false);
  const [isComposing, setComposing] = useState(false);
  const containers = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.list,

    /**
     * Reads every container.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Docker's status, the containers, and what is being installed or deployed.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchContainers(signal),

    // The readings move every ten seconds; the page follows them while it is looked at.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
  const dismiss = useMutation({
    mutationFn: dismissInstall,

    /** Reads the list again without the install. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.list });
    },
  });

  const [filter, setFilter] = useListState(CONTAINER_FILTER_CODEC);
  const docker = containers.data?.docker;
  const items = containers.data?.items ?? [];
  const tiles = containerTiles(
    items,
    containers.data?.composeOperations ?? [],
    containers.data?.installs ?? [],
    filter,
  );
  const narrowed = Number(filter.run !== 'any') + Number(filter.owner !== 'any');
  const isDockerUp = docker?.isAvailable === true;
  const hasCompose = docker?.composeVersion !== null && docker?.composeVersion !== undefined;
  const isEmpty =
    isDockerUp &&
    items.length === 0 &&
    (containers.data?.installs.length ?? 0) === 0 &&
    (containers.data?.composeOperations.length ?? 0) === 0;

  return (
    <>
      <LibraryPage
        title={t('containers.containers.containers', 'Containers')}
        counted={(count) =>
          translate('containers.count', {
            count,
            defaultValue_one: '{{count}} container',
            defaultValue_other: '{{count}} containers',
          })
        }
        count={containers.isPending ? undefined : items.length}
        shownCount={tiles.length}
        summary={
          isDockerUp
            ? [
                `Docker ${docker.version ?? ''}`.trim(),
                docker.composeVersion === null
                  ? null
                  : t('containers.containers.composeComposeversion', 'Compose {{composeVersion}}', {
                      composeVersion: docker.composeVersion,
                    }),
                docker.platformNetwork === 'host'
                  ? t('containers.containers.hostNetwork', 'host network')
                  : null,
              ]
            : undefined
        }
        tools={
          <>
            <SearchField
              placeholder={t('containers.containers.searchContainers', 'Search containers…')}
              value={filter.search}
              onChange={(search) => {
                setFilter({ ...filter, search });
              }}
            />
            <FilterSheet
              label={t('containers.containers.narrowTheContainers', 'Narrow the containers')}
              count={narrowed}
              summary={t('containers.containers.countShown', '{{count}} shown', {
                count: tiles.length,
              })}
              onClear={() => {
                setFilter({ ...filter, run: 'any', owner: 'any' });
              }}
            >
              <Facet title={t('containers.containers.running', 'Running')}>
                <SelectField
                  label={t('containers.containers.running', 'Running')}
                  isLabelHidden
                  size="compact"
                  options={withLabels(RUN_OPTIONS)}
                  value={filter.run}
                  onChange={(run) => {
                    setFilter({
                      ...filter,
                      run: RUN_OPTIONS.find((option) => option.value === run)?.value ?? 'any',
                    });
                  }}
                />
              </Facet>
              <Facet title={t('containers.containers.belongsTo', 'Belongs to')}>
                <SelectField
                  label={t('containers.containers.belongsTo', 'Belongs to')}
                  isLabelHidden
                  size="compact"
                  options={withLabels(OWNER_OPTIONS)}
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
          canInstall && isDockerUp ? (
            <MenuButton
              label={t('containers.containers.install', 'Install')}
              icon="plus"
              items={[
                {
                  label: t('containers.containers.image', 'Image'),
                  description: t(
                    'containers.containers.oneContainerFromA',
                    'One container from a registry image',
                  ),
                  icon: 'container',
                  /** Opens the install of one image. */
                  onSelect: () => {
                    setInstalling(true);
                  },
                },
                {
                  label: t('containers.containers.compose', 'Compose'),
                  description: hasCompose
                    ? t(
                        'containers.containers.severalContainersFromA',
                        'Several containers from a compose file',
                      )
                    : t(
                        'containers.containers.dockerComposeIsNot',
                        'docker compose is not installed where NebulaHome runs',
                      ),
                  icon: 'layers',
                  disabled: !hasCompose,
                  /** Opens a new compose project. */
                  onSelect: () => {
                    setComposing(true);
                  },
                },
              ]}
            />
          ) : undefined
        }
        isPending={containers.isPending}
        error={containers.error}
        isEmpty={isEmpty}
        emptyMessage={t(
          'containers.containers.dockerRunsNoContainer',
          'Docker runs no container on this machine.',
        )}
      >
        {docker !== undefined && !docker.isAvailable ? <DockerUnavailable docker={docker} /> : null}

        {isDockerUp && !isEmpty && tiles.length === 0 ? (
          <NoMatches
            query={filter.search}
            onClear={() => {
              setFilter(OPEN_CONTAINER_FILTER);
            }}
          />
        ) : null}

        {tiles.length === 0 ? null : (
          <ul className={TILE_GRID}>
            {tiles.map((tile) =>
              tile.kind === 'compose' ? (
                <ComposeCard key={`compose:${tile.project}`} group={tile} />
              ) : tile.kind === 'container' ? (
                <ContainerCard key={tile.container.id} container={tile.container} />
              ) : (
                <InstallCard
                  key={`install:${tile.install.name}`}
                  install={tile.install}
                  {...(canInstall
                    ? {
                        /**
                         * Forgets the failed install.
                         *
                         * @param name - The container's name.
                         */
                        onDismiss: (name: string) => {
                          dismiss.mutate(name);
                        },
                      }
                    : {})}
                />
              ),
            )}
          </ul>
        )}
      </LibraryPage>

      <InstallContainerDialog
        isOpen={isInstalling}
        taken={items.map((item) => item.name)}
        onClose={() => {
          setInstalling(false);
        }}
      />
      <ComposeEditorDialog
        target={isComposing ? { kind: 'new' } : null}
        onClose={() => {
          setComposing(false);
        }}
      />
    </>
  );
}

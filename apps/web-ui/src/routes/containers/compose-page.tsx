/**
 * One compose project: its containers, where its files were, and - for a project deployed from
 * here - its file, its last deployment, and what can be done to all of it.
 *
 * Laid out as a vendor's page is: who it is at the top, then its containers as rows, each leading
 * to its own page, as a vendor's devices do. The platform's own project is shown and never
 * controlled; a project someone started outside NebulaHome is shown too, its containers
 * controllable one by one, since its file is not here to change. A project deployed from here
 * can be changed and deployed again, started and stopped whole, have newer images pulled, and be
 * removed - with its volumes and its folder, when asked.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import type { ComposeOperation, ContainerSummary } from '@nebulahome/contracts';
import { Badge, Button, Modal, Panel, PanelNote, Switch, StatusDot } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import {
  CONTAINER_QUERY_KEYS,
  controlCompose,
  fetchCompose,
  fetchContainers,
  removeCompose,
} from '@/containers/api';
import { composeGroups, groupUsage } from '@/containers/container-groups';
import { toMessage } from '@/lib/error-message';
import { formatBytes, formatPercent } from '@/lib/format-bytes';
import { ComposeEditorDialog } from '@/routes/containers/compose-editor-dialog';
import { containerPath } from '@/routes/containers/container-card';
import {
  CONTAINER_TONES,
  ContainerBadges,
  ContainerTile,
  dotOf,
} from '@/routes/containers/container-parts';
import { DetailPlaceholder } from '@/routes/library/detail-page';
import { Fact } from '@/routes/library/entity/details-panel';
import { LibraryPage } from '@/routes/library/library-page';
import { MetaLine, Stat } from '@/routes/library/vendor-page';

/** The editor, loaded when the file is shown. */
const YamlEditor = lazy(async () => import('@/routes/containers/yaml-editor'));

/** What each operation is called while it runs, and once it ended. */
const OPERATION_LABELS: Readonly<Record<ComposeOperation['action'], string>> = {
  deploy: 'Deploying',
  start: 'Starting',
  stop: 'Stopping',
  pull: 'Updating the images',
  remove: 'Removing',
};

/** The rows' columns, shared by the heading and every row so they line up. */
const ROW_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 ' +
  'md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_96px_72px_88px]';

/**
 * One container of the project: the whole row leads to its page.
 *
 * @param props - The container.
 * @param props.container - It.
 * @returns The row.
 */
function ContainerRow(props: { readonly container: ContainerSummary }) {
  const { container } = props;
  const dot = dotOf(container);
  const isRunning = container.state === 'running';

  return (
    <li
      className={`${ROW_COLUMNS} relative border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-raised has-[[data-row-link]:focus-visible]:ring-3 has-[[data-row-link]:focus-visible]:ring-primary/25 has-[[data-row-link]:focus-visible]:ring-inset`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <StatusDot tone={dot.tone} title={dot.title} isBusy={dot.isBusy} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <Link
              to={containerPath(container.name)}
              data-row-link
              title={container.name}
              className="truncate text-title font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none"
            >
              {container.displayName}
            </Link>
            <ContainerBadges container={container} isStateShown={false} />
          </span>
          <span className="truncate font-mono text-caption text-foreground-subtle">
            {container.image}
          </span>
        </span>
      </span>

      <span className="hidden truncate font-mono text-ui text-foreground-muted md:block">
        {container.compose?.service ?? '—'}
      </span>

      <span className="justify-self-end md:justify-self-start">
        <Badge tone={CONTAINER_TONES[container.state]} size="small">
          {container.state}
        </Badge>
      </span>

      <span className="hidden text-ui text-foreground-muted tabular md:block">
        {isRunning ? formatPercent(container.cpuPercent) : '—'}
      </span>

      <span className="hidden text-ui text-foreground-muted tabular md:block">
        {isRunning && container.memoryUsedBytes !== null
          ? formatBytes(container.memoryUsedBytes)
          : '—'}
      </span>
    </li>
  );
}

/**
 * The last operation on the project, and what `docker compose` wrote.
 *
 * @param props - The operation.
 * @param props.operation - It.
 * @returns The panel.
 */
function LastOperation(props: { readonly operation: ComposeOperation }) {
  const { operation } = props;
  const isRunning = operation.phase !== 'done' && operation.phase !== 'failed';

  return (
    <Panel
      title={isRunning ? OPERATION_LABELS[operation.action] : 'Last deployment'}
      action={
        <Badge
          tone={isRunning ? 'accent' : operation.phase === 'failed' ? 'danger' : 'success'}
          size="small"
        >
          {isRunning ? operation.phase : operation.phase === 'failed' ? 'Failed' : 'Done'}
        </Badge>
      }
    >
      {operation.error === null ? null : (
        <p role="alert" className="px-4 pt-3 text-ui text-danger">
          {operation.error}
        </p>
      )}
      <pre
        aria-busy={isRunning}
        className="max-h-72 overflow-auto px-4 py-3 font-mono text-caption whitespace-pre-wrap text-foreground-muted"
      >
        {operation.log.join('\n') ||
          (isRunning ? 'Waiting for docker compose…' : 'It wrote nothing.')}
      </pre>
    </Panel>
  );
}

/**
 * The question before a project goes, and how much of it goes.
 *
 * @param props - The project, and what to do.
 * @param props.project - The project.
 * @param props.isOpen - Whether it is asked.
 * @param props.onClose - Called to think better of it.
 * @param props.onRemoved - Called once it is going.
 * @returns The dialog.
 */
function RemoveDialog(props: {
  readonly project: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onRemoved: () => void;
}) {
  const [removeVolumes, setRemoveVolumes] = useState(false);
  const [removeFiles, setRemoveFiles] = useState(false);
  const removal = useMutation({
    /**
     * Takes the project down, with as much of it as was asked.
     *
     * @returns Once it is under way.
     */
    mutationFn: async () => removeCompose(props.project, removeVolumes, removeFiles),
    onSuccess: props.onRemoved,
  });

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      size="small"
      title={`Remove ${props.project}?`}
      description="Its containers are stopped and removed, and NebulaHome forgets the project."
      footer={
        <>
          {removal.error === null ? null : (
            <p role="alert" className="mr-auto text-ui text-danger">
              {toMessage(removal.error)}
            </p>
          )}
          <Button variant="ghost" disabled={removal.isPending} onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isBusy={removal.isPending}
            onClick={() => {
              removal.mutate();
            }}
          >
            Remove
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 px-5 py-4">
        <Switch label="Also delete its volumes" isOn={removeVolumes} onChange={setRemoveVolumes} />
        <Switch
          label="Also delete its folder: the file and what its services kept there"
          isOn={removeFiles}
          onChange={setRemoveFiles}
        />
      </div>
    </Modal>
  );
}

/**
 * Renders one compose project's page.
 *
 * @returns The page.
 */
export function ComposePage() {
  const { project = '' } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const canControl = can('container:control');
  const canInstall = can('container:install');
  const [isEditing, setEditing] = useState(false);
  const [isRemoving, setRemoving] = useState(false);
  const containers = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.list,

    /**
     * Reads every container.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The containers and the operations.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchContainers(signal),

    /**
     * How soon to read again: every two seconds while the project is being worked on.
     *
     * @param query - The query, with what it last read.
     * @returns Milliseconds.
     */
    refetchInterval: (query) =>
      query.state.data?.composeOperations.some(
        (operation) =>
          operation.project === project &&
          operation.phase !== 'done' &&
          operation.phase !== 'failed',
      ) === true
        ? 2000
        : 10_000,
    refetchIntervalInBackground: false,
  });
  const group = composeGroups(
    containers.data?.items ?? [],
    containers.data?.composeOperations ?? [],
  ).find((each) => each.project === project);
  const isEditable = group?.isEditable === true && !group.isSystem;
  const document = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.compose(project),
    enabled: isEditable && canInstall,

    /**
     * Reads the project's file.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The file and its `.env`.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchCompose(project, signal),
  });
  const control = useMutation({
    /**
     * Starts, stops, or pulls newer images for the whole project.
     *
     * @param action - What to do.
     * @returns Once it is under way.
     */
    mutationFn: async (action: 'start' | 'stop' | 'pull') => controlCompose(project, action),

    /** Reads the list again: the operation shows there. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.list });
    },
  });

  const usage = group === undefined ? null : groupUsage(group);
  const operation = group?.operation ?? null;
  const isWorking =
    operation !== null && operation.phase !== 'done' && operation.phase !== 'failed';
  const first = group?.containers[0]?.compose ?? null;

  return (
    <>
      <LibraryPage
        title={group?.title ?? project}
        parent={{ to: '/containers', label: 'Containers' }}
        noun="container"
        count={group?.containers.length}
        action={
          isEditable && (canControl || canInstall) ? (
            <>
              {canControl ? (
                (usage?.running ?? 0) > 0 ? (
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={isWorking || control.isPending}
                    isBusy={control.isPending && control.variables === 'stop'}
                    onClick={() => {
                      control.mutate('stop');
                    }}
                  >
                    Stop all
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={isWorking || control.isPending}
                    isBusy={control.isPending && control.variables === 'start'}
                    onClick={() => {
                      control.mutate('start');
                    }}
                  >
                    Start all
                  </Button>
                )
              ) : null}
              {canInstall ? (
                <>
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={isWorking || control.isPending}
                    isBusy={control.isPending && control.variables === 'pull'}
                    title="Pull the newest images and make again what they changed"
                    onClick={() => {
                      control.mutate('pull');
                    }}
                  >
                    Update images
                  </Button>
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={isWorking}
                    onClick={() => {
                      setEditing(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="compact"
                    disabled={isWorking}
                    onClick={() => {
                      setRemoving(true);
                    }}
                  >
                    Remove
                  </Button>
                </>
              ) : null}
            </>
          ) : undefined
        }
        isPending={containers.isPending}
        error={containers.error}
        isEmpty={false}
      >
        {group === undefined ? (
          containers.isPending ? null : (
            <DetailPlaceholder
              isProblem
            >{`No compose project is called ${project}.`}</DetailPlaceholder>
          )
        ) : (
          <>
            <section className="flex flex-wrap items-start gap-x-4.5 gap-y-4 rounded-panel border border-border bg-surface p-5 md:flex-nowrap">
              <ContainerTile name={group.project} icon="layers" size={56} />

              <div className="flex min-w-0 grow flex-col gap-2">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-headline-sm font-semibold tracking-tight text-foreground">
                    {group.title}
                  </h2>
                  <Badge tone={group.isSystem ? 'accent' : 'neutral'} size="small">
                    {group.isSystem ? 'System' : 'Compose'}
                  </Badge>
                </div>

                <p className="max-w-2xl text-ui leading-relaxed text-foreground-muted">
                  {group.isSystem
                    ? 'The platform itself and what it runs beside it: shown and measured, never stopped from here.'
                    : isEditable
                      ? 'Deployed from here: its file is kept in NebulaHome’s data, with the folders its services keep.'
                      : 'Started outside NebulaHome: its containers can be started and stopped one by one here, and its file changed where it lives.'}
                </p>

                <MetaLine
                  parts={[
                    <span key="project" className="font-mono">
                      {group.project}
                    </span>,
                    first?.version === null || first?.version === undefined ? null : (
                      <span key="version" className="tabular">
                        Compose {first.version}
                      </span>
                    ),
                  ]}
                />
              </div>

              <div className="flex items-start pl-14 md:pl-0">
                <Stat
                  value={group.containers.length}
                  noun={group.containers.length === 1 ? 'container' : 'containers'}
                />
                <Stat value={usage?.running ?? 0} noun="running" />
              </div>
            </section>

            {control.error === null ? null : (
              <p role="alert" className="text-ui text-danger">
                {toMessage(control.error)}
              </p>
            )}

            {operation === null || (operation.phase === 'done' && !isEditable) ? null : (
              <LastOperation operation={operation} />
            )}

            <Panel title="Containers">
              {group.containers.length === 0 ? (
                <p className="px-4 py-3.5 text-ui text-foreground-muted">
                  {isWorking ? 'Its containers appear once they are made.' : 'It has no container.'}
                </p>
              ) : (
                <>
                  <div
                    aria-hidden="true"
                    className={`${ROW_COLUMNS} hidden border-b border-border px-4 py-2 font-mono text-label text-foreground-subtle uppercase md:grid`}
                  >
                    <span>Container</span>
                    <span>Service</span>
                    <span>State</span>
                    <span>CPU</span>
                    <span>RAM</span>
                  </div>
                  <ul>
                    {group.containers.map((container) => (
                      <ContainerRow key={container.id} container={container} />
                    ))}
                  </ul>
                </>
              )}
              {usage === null || usage.running === 0 ? null : (
                <PanelNote>
                  Together {formatPercent(usage.cpuPercent)} of the processor
                  {usage.memoryUsedBytes === null
                    ? ''
                    : ` and ${formatBytes(usage.memoryUsedBytes)} of memory`}
                  .
                </PanelNote>
              )}
            </Panel>

            {first === null ? null : (
              <Panel title="Details">
                <dl>
                  <Fact term="Project">
                    <span className="font-mono text-caption">{group.project}</span>
                  </Fact>
                  {first.workingDir === null ? null : (
                    <Fact term="Folder">
                      <span className="font-mono text-caption break-all">{first.workingDir}</span>
                    </Fact>
                  )}
                  {first.configFiles.length === 0 ? null : (
                    <Fact term={first.configFiles.length === 1 ? 'File' : 'Files'}>
                      <span className="flex flex-col gap-0.5 font-mono text-caption break-all">
                        {first.configFiles.map((file) => (
                          <span key={file}>{file}</span>
                        ))}
                      </span>
                    </Fact>
                  )}
                  <Fact term="Made by">
                    {group.isSystem
                      ? 'The platform'
                      : isEditable
                        ? 'NebulaHome'
                        : 'docker compose, outside NebulaHome'}
                  </Fact>
                </dl>
              </Panel>
            )}

            {isEditable && document.data !== undefined ? (
              <Panel title="Compose file">
                <div className="p-3">
                  <Suspense
                    fallback={<p className="px-1 py-2 text-ui text-foreground-subtle">Opening…</p>}
                  >
                    <YamlEditor
                      label="Compose file"
                      value={document.data.file}
                      isReadOnly
                      minHeight="6rem"
                    />
                  </Suspense>
                </div>
              </Panel>
            ) : null}
          </>
        )}
      </LibraryPage>

      <ComposeEditorDialog
        target={isEditing ? { kind: 'edit', project } : null}
        onClose={() => {
          setEditing(false);
          void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.compose(project) });
        }}
      />
      <RemoveDialog
        key={isRemoving ? 'removing' : 'shut'}
        project={project}
        isOpen={isRemoving}
        onClose={() => {
          setRemoving(false);
        }}
        onRemoved={() => {
          setRemoving(false);
          void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.list });
          void navigate('/containers');
        }}
      />
    </>
  );
}

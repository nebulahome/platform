/**
 * One container: how busy it is, what it runs, how it is attached to the machine, and what it
 * last wrote.
 *
 * The buttons that start, stop, restart and update it sit in the header, and are absent - with
 * the reason said in their place - for the platform's own container and for one an integration
 * runs: the first would stop the page asking, the second is the integration's to manage. The
 * environment is shown with the value of anything whose name says it is a secret withheld, by
 * the server, so it never reaches the page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import type { ContainerAction, ContainerDetail } from '@nebula-home/contracts';
import { AppIcon, Button, Panel, PanelNote } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { ExternalLinkIcon } from '@/components/icons';
import {
  CONTAINER_QUERY_KEYS,
  controlContainer,
  fetchContainer,
  fetchContainerLogs,
  updateContainer,
} from '@/containers/api';
import { toMessage } from '@/lib/error-message';
import { formatBytes } from '@/lib/format-bytes';
import { ContainerBadges } from '@/routes/containers/container-parts';
import { DetailHeader, DetailPlaceholder } from '@/routes/library/detail-page';
import { Fact, When } from '@/routes/library/entity/details-panel';
import { SystemUsageCard } from '@/routes/settings/system-usage-card';

/** How many lines of the log are read. */
const LOG_LINES = 200;

/** What each action is called on its button. */
const ACTION_LABELS: Readonly<Record<ContainerAction, string>> = {
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
};

/**
 * Why a container has no buttons, in a sentence.
 *
 * @param container - The container.
 * @returns The sentence, or null when it can be controlled.
 */
function refusalOf(container: ContainerDetail): string | null {
  if (container.refusal === 'self') {
    return 'This is the platform’s own container: it is shown, never stopped from here.';
  }

  if (container.refusal === 'managed' && container.managedBy !== null) {
    return `Run by the ${container.managedBy.vendorId} integration, which starts, stops and updates it.`;
  }

  return null;
}

/**
 * A link that leaves the platform.
 *
 * @param props - Where to, and what to call it.
 * @param props.href - The address.
 * @param props.children - The words.
 * @returns The link.
 */
function OutLink(props: { readonly href: string; readonly children: string }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1 text-primary transition-colors hover:text-primary-hover"
    >
      <span className="truncate">{props.children}</span>
      <ExternalLinkIcon width="12" height="12" className="shrink-0" />
    </a>
  );
}

/**
 * The container's facts: what it runs, since when, and where it comes from.
 *
 * @param props - The container.
 * @param props.container - It.
 * @returns The panel.
 */
function ContainerDetails(props: { readonly container: ContainerDetail }) {
  const { container } = props;
  const webPage =
    container.webPort === null
      ? null
      : `${window.location.protocol}//${window.location.hostname}:${String(container.webPort)}`;

  return (
    <Panel title="Details">
      <dl>
        <Fact term="Image">
          <span className="font-mono text-caption break-all">{container.image}</span>
        </Fact>
        {container.version === null ? null : <Fact term="Version">{container.version}</Fact>}
        <Fact term="Update">
          {container.update.isInstalling
            ? `Installing${container.update.progress === null ? '' : ` · ${String(container.update.progress)}%`}`
            : container.update.isAvailable
              ? `${container.update.latestVersion ?? 'A newer image'} is out`
              : container.update.checkedAt === null
                ? 'Not checked yet'
                : 'Up to date'}
        </Fact>
        {container.registryUrl === null ? null : (
          <Fact term="Registry">
            <OutLink href={container.registryUrl}>
              {container.registryUrl.replace(/^https?:\/\//u, '')}
            </OutLink>
          </Fact>
        )}
        {webPage === null ? null : (
          <Fact term="Web page">
            <OutLink href={webPage}>{webPage.replace(/^https?:\/\//u, '')}</OutLink>
          </Fact>
        )}
        <Fact term="Status">{container.status}</Fact>
        {container.health === null ? null : <Fact term="Health">{container.health}</Fact>}
        <Fact term="Created">
          <When when={container.createdAt} />
        </Fact>
        {container.startedAt === null ? null : (
          <Fact term="Started">
            <When when={container.startedAt} />
          </Fact>
        )}
        <Fact term="Restart">{container.restartPolicy ?? 'no'}</Fact>
        {container.command === null ? null : (
          <Fact term="Command">
            <span className="font-mono text-caption break-all">{container.command}</span>
          </Fact>
        )}
        {container.deviceId === null ? null : (
          <Fact term="Device">
            <Link
              to={`/devices/${encodeURIComponent(container.deviceId)}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              Its entities
            </Link>
          </Fact>
        )}
        <Fact term="Id">
          <span className="font-mono text-caption break-all">{container.id.slice(0, 12)}</span>
        </Fact>
      </dl>
    </Panel>
  );
}

/**
 * How the container is attached to the network: its mode, its networks, its ports.
 *
 * @param props - The container.
 * @param props.container - It.
 * @returns The panel.
 */
function ContainerNetwork(props: { readonly container: ContainerDetail }) {
  const { container } = props;
  const published = container.ports.filter((port) => port.hostPort !== null);

  return (
    <Panel title="Network">
      <dl>
        <Fact term="Mode">{container.networkMode}</Fact>
        {container.hostname === null ? null : <Fact term="Host name">{container.hostname}</Fact>}
        {container.networks.map((network) => (
          <Fact key={network.name} term={network.name}>
            <span className="flex flex-col gap-0.5">
              <span className="font-mono text-caption">{network.ipAddress ?? 'no address'}</span>
              {network.aliases.length === 0 ? null : (
                <span className="text-caption text-foreground-subtle">
                  as {network.aliases.join(', ')}
                </span>
              )}
            </span>
          </Fact>
        ))}
        <Fact term="Ports">
          {container.ports.length === 0 ? (
            <span className="text-foreground-subtle">None</span>
          ) : (
            <span className="flex flex-col gap-0.5 font-mono text-caption">
              {container.ports.map((port) => (
                <span key={`${String(port.containerPort)}/${port.protocol}/${port.hostIp ?? ''}`}>
                  {port.hostPort === null
                    ? `${String(port.containerPort)}/${port.protocol}`
                    : `${port.hostIp === null || port.hostIp === '' ? '' : `${port.hostIp}:`}${String(port.hostPort)} → ${String(port.containerPort)}/${port.protocol}`}
                </span>
              ))}
            </span>
          )}
        </Fact>
      </dl>
      {published.length === 0 && container.networkMode !== 'host' ? (
        <PanelNote>Nothing is published on the machine: only other containers reach it.</PanelNote>
      ) : null}
    </Panel>
  );
}

/**
 * What the container keeps, and where: its volumes, the folders of the machine, its devices.
 *
 * @param props - The container.
 * @param props.container - It.
 * @returns The panel.
 */
function ContainerStorage(props: { readonly container: ContainerDetail }) {
  const { container } = props;

  return (
    <Panel title="Storage">
      {container.mounts.length === 0 && container.devices.length === 0 ? (
        <p className="px-4 py-3.5 text-ui text-foreground-muted">Nothing is mounted.</p>
      ) : (
        <dl>
          {container.mounts.map((mount) => (
            <Fact key={mount.destination} term={mount.type}>
              <span className="flex flex-col gap-0.5 font-mono text-caption break-all">
                <span>{mount.destination}</span>
                <span className="text-foreground-subtle">
                  {mount.source ?? 'in memory'}
                  {mount.subpath === null ? '' : ` / ${mount.subpath}`}
                  {mount.isReadOnly ? ' · read-only' : ''}
                </span>
              </span>
            </Fact>
          ))}
          {container.devices.map((device) => (
            <Fact key={device.container} term="device">
              <span className="font-mono text-caption break-all">
                {device.host} → {device.container}
              </span>
            </Fact>
          ))}
        </dl>
      )}
    </Panel>
  );
}

/**
 * The container's environment, secrets withheld.
 *
 * @param props - The container.
 * @param props.container - It.
 * @returns The panel.
 */
function ContainerEnvironment(props: { readonly container: ContainerDetail }) {
  const { container } = props;

  return (
    <Panel title={`Environment · ${String(container.env.length)}`}>
      {container.env.length === 0 ? (
        <p className="px-4 py-3.5 text-ui text-foreground-muted">No variables.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {container.env.map((variable, index) => (
            // Two variables may share a name in a hand-written configuration.
            <li
              key={`${variable.name}-${String(index)}`}
              className="flex flex-col gap-0.5 px-4 py-2"
            >
              <span className="font-mono text-caption text-foreground">{variable.name}</span>
              <span className="font-mono text-caption break-all text-foreground-muted">
                {variable.isHidden ? 'withheld' : (variable.value ?? '')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The last lines the container wrote.
 *
 * @param props - The container's name.
 * @param props.name - It.
 * @returns The panel.
 */
function ContainerLogs(props: { readonly name: string }) {
  const logs = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.logs(props.name),

    /**
     * Reads the lines.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The lines.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      fetchContainerLogs(props.name, LOG_LINES, signal),
  });

  return (
    <Panel
      title="Logs"
      action={
        <Button
          variant="ghost"
          size="compact"
          isBusy={logs.isFetching}
          onClick={() => {
            void logs.refetch();
          }}
        >
          Read again
        </Button>
      }
    >
      {logs.error === null ? (
        <pre className="max-h-96 overflow-auto px-4 py-3 font-mono text-caption whitespace-pre-wrap text-foreground-muted">
          {(logs.data?.lines ?? []).map((line) => line.text).join('\n') ||
            (logs.isPending ? 'Reading…' : 'It has written nothing.')}
        </pre>
      ) : (
        <p className="px-4 py-3.5 text-ui text-danger">{toMessage(logs.error)}</p>
      )}
    </Panel>
  );
}

/**
 * Renders one container's page.
 *
 * @returns The page.
 */
export function ContainerPage() {
  const { name = '' } = useParams();
  const queryClient = useQueryClient();
  const canControl = useSession((state) => state.can)('container:control');
  const [failure, setFailure] = useState<string | null>(null);

  const container = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.one(name),

    /**
     * Reads the container.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The container.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchContainer(name, signal),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  /** Reads everything about containers again after an action. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.all });
  };

  const control = useMutation({
    /**
     * Starts, stops or restarts it.
     *
     * @param action - What to do.
     * @returns The container as it now is.
     */
    mutationFn: async (action: ContainerAction) => controlContainer(name, action),

    /** Clears the last failure and reads again. */
    onSuccess: () => {
      setFailure(null);
      refresh();
    },

    /**
     * Says why it did not work.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      setFailure(toMessage(error));
    },
  });
  const update = useMutation({
    /**
     * Starts the update.
     *
     * @returns Once the supervisor took it.
     */
    mutationFn: async () => updateContainer(name),

    /** Clears the last failure and reads again. */
    onSuccess: () => {
      setFailure(null);
      refresh();
    },

    /**
     * Says why it did not work.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      setFailure(toMessage(error));
    },
  });

  const view = container.data;
  const refusal = view === undefined ? null : refusalOf(view);
  const isRunning = view?.state === 'running';
  const isBusy = control.isPending || update.isPending || view?.update.isInstalling === true;
  const actions: ContainerAction[] = isRunning ? ['restart', 'stop'] : ['start'];
  const latest = view?.samples.at(-1);

  return (
    <div className="flex min-h-0 grow flex-col">
      <DetailHeader
        crumbs={[{ to: '/containers', label: 'Containers' }]}
        title={name}
        actions={
          view !== undefined && canControl && refusal === null ? (
            <>
              {view.update.isAvailable && !view.update.isInstalling ? (
                <Button
                  size="compact"
                  isBusy={update.isPending}
                  disabled={isBusy}
                  onClick={() => {
                    update.mutate();
                  }}
                >
                  Update to {view.update.latestVersion ?? 'the newest'}
                </Button>
              ) : null}
              {actions.map((action) => (
                <Button
                  key={action}
                  variant={action === 'stop' ? 'danger' : 'ghost'}
                  size="compact"
                  isBusy={control.isPending && control.variables === action}
                  disabled={isBusy}
                  onClick={() => {
                    control.mutate(action);
                  }}
                >
                  {ACTION_LABELS[action]}
                </Button>
              ))}
            </>
          ) : undefined
        }
      />

      <div className="min-h-0 grow overflow-y-auto p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          {view === undefined ? (
            container.isPending ? (
              <DetailPlaceholder>Reading…</DetailPlaceholder>
            ) : (
              <DetailPlaceholder isProblem>{toMessage(container.error)}</DetailPlaceholder>
            )
          ) : (
            <>
              <section className="flex flex-wrap items-center gap-4">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-panel border border-border face-card text-foreground-muted">
                  <AppIcon id="container" size={28} />
                </span>
                <div className="flex min-w-0 grow flex-col gap-1">
                  <h2 className="truncate font-mono text-headline font-semibold tracking-tight">
                    {view.name}
                  </h2>
                  <p className="truncate text-ui text-foreground-muted">{view.image}</p>
                </div>
                <ContainerBadges container={view} />
              </section>

              {refusal === null ? null : (
                <Panel title="Who runs it" elevation="flat">
                  <p className="flex flex-wrap items-center gap-x-2 px-4 py-3 text-ui text-foreground-muted">
                    {refusal}
                    {view.managedBy === null ? null : (
                      <Link
                        to={`/integrations/${encodeURIComponent(view.managedBy.vendorId)}`}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        Open the integration
                      </Link>
                    )}
                  </p>
                </Panel>
              )}

              {failure === null &&
              view.update.error === null &&
              view.warnings.length === 0 ? null : (
                <Panel title="Needs attention">
                  <ul className="flex flex-col gap-1.5 px-4 py-3 text-ui text-danger">
                    {failure === null ? null : <li>{failure}</li>}
                    {view.update.error === null ? null : (
                      <li>The last update check or install failed: {view.update.error}</li>
                    )}
                    {view.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </Panel>
              )}

              {isRunning ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <SystemUsageCard
                    title="Processor"
                    percent={latest?.cpuPercent ?? null}
                    details={['Share of the whole machine']}
                    series={view.samples.map((sample) => ({
                      at: sample.at.getTime(),
                      value: sample.cpuPercent,
                    }))}
                    color="var(--color-primary)"
                    dotClass="bg-primary"
                  />
                  <SystemUsageCard
                    title="Memory"
                    percent={
                      latest === undefined || latest.memoryLimitBytes === 0
                        ? null
                        : (latest.memoryUsedBytes / latest.memoryLimitBytes) * 100
                    }
                    details={
                      latest === undefined
                        ? ['Waiting for the first reading']
                        : [
                            `${formatBytes(latest.memoryUsedBytes)} in use`,
                            `of ${formatBytes(latest.memoryLimitBytes)}`,
                          ]
                    }
                    series={view.samples.map((sample) => ({
                      at: sample.at.getTime(),
                      value:
                        sample.memoryLimitBytes === 0
                          ? null
                          : (sample.memoryUsedBytes / sample.memoryLimitBytes) * 100,
                    }))}
                    color="var(--color-tag-teal)"
                    dotClass="bg-tag-teal"
                  />
                </div>
              ) : null}

              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-5">
                  <ContainerDetails container={view} />
                  <ContainerStorage container={view} />
                </div>
                <div className="flex min-w-0 flex-col gap-5">
                  <ContainerNetwork container={view} />
                  <ContainerEnvironment container={view} />
                </div>
              </div>

              <ContainerLogs name={view.name} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

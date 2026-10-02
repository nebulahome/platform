/**
 * One package: who it is, where it stands, what it needs and what needs it, and its own page.
 *
 * The header reads `Packages / MQTT`, as a vendor's reads `Integrations / Shelly`, and under it
 * the same panel a vendor has - logo, name, what the package says about itself, its release and
 * where it comes from, the devices and entities it brought in. Then, in the order somebody looks
 * for them:
 *
 * - **What is wrong**, when something is: why it failed, or which package it waits for.
 * - **Depends on** and **Used by**: the packages and integrations on either side of it, which is
 *   what explains a refusal to remove or to stop it.
 * - **Its containers** and **its devices**, each a way to their own pages.
 * - **Its page**: what the package draws itself, with the interface's own components, while it
 *   runs.
 * - **Its log**, with the viewer a container's has, for a package that runs a process.
 *
 * Start, Stop and Restart are for whoever may configure packages; Update and Remove for whoever
 * may install them. A package that is part of the platform is never removed, only restarted, and
 * the page says so rather than offering a button that would be refused. Stopping a package others
 * need asks first, naming them: they stop with it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import type { ApiPackageDetail, PackageRelation } from '@nebulahome/contracts';
import { Badge, Button, Modal, Panel, PanelNote, PanelRow, Switch } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { ExternalLinkIcon } from '@/components/icons';
import { LogViewer } from '@/components/log-viewer';
import { CONTAINER_QUERY_KEYS, fetchContainers } from '@/containers/api';
import { toMessage } from '@/lib/error-message';
import { absoluteTime, relativeTime } from '@/lib/format-time';
import { fetchDevices, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  controlPackage,
  fetchAvailablePackages,
  fetchPackage,
  fetchPackageLogs,
  PACKAGE_QUERY_KEYS,
  removePackage,
  updatePackage,
} from '@/packages/api';
import { PackageSlot } from '@/packages/package-slot';
import { ContainerBadges } from '@/routes/containers/container-parts';
import { devicePath } from '@/routes/library/device/device-path';
import { LibraryPage } from '@/routes/library/library-page';
import { MetaLine, Stat } from '@/routes/library/vendor-page';
import { PackageSetupDialog } from '@/routes/packages/package-setup-dialog';
import { PACKAGE_STATE_OF, PackageLogo } from '@/routes/packages/package-tile';

/** What the sources are called under the name. */
const SOURCE_LABELS = {
  builtin: 'Ships with NebulaHome',
  index: 'From the package index',
  local: 'Installed from a file',
} as const;

/**
 * Where one relation's page is.
 *
 * @param relation - A package or an integration.
 * @returns Its address.
 */
function relationPath(relation: PackageRelation): string {
  return relation.kind === 'package'
    ? `/packages/${encodeURIComponent(relation.id)}`
    : `/integrations/${encodeURIComponent(relation.id)}`;
}

/**
 * Names in a sentence: "MQTT", "MQTT and Matter", "MQTT, Matter and NVR".
 *
 * @param names - The names.
 * @returns The sentence's words.
 */
function listed(names: readonly string[]): string {
  return names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/**
 * The relations on one side, as links.
 *
 * @param props - The title and the relations.
 * @param props.title - "Depends on", "Used by".
 * @param props.relations - Them.
 * @param props.empty - What is said when there are none.
 * @returns The rows.
 */
function Relations(props: {
  readonly title: string;
  readonly relations: readonly PackageRelation[];
  readonly empty: string;
}) {
  const { title, relations, empty } = props;

  return (
    <div className="flex min-w-0 flex-col gap-2 px-4 py-3.5">
      <h3 className="text-caption font-medium tracking-wide text-foreground-subtle uppercase">
        {title}
      </h3>
      {relations.length === 0 ? (
        <p className="text-ui text-foreground-subtle">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {relations.map((relation) => (
            <li key={`${relation.kind}:${relation.id}`} className="list-none">
              <Link
                to={relationPath(relation)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-soft face-raised px-2.5 py-1 text-ui text-foreground transition-colors hover:border-border-strong"
              >
                {relation.name}
                <span className="text-caption text-foreground-subtle">
                  {relation.kind === 'package' ? 'package' : 'integration'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the header's panel needs. */
type HeaderProps = {
  readonly found: ApiPackageDetail;
  readonly update: string | undefined;
};

/**
 * The package's own panel: logo, name, what it says about itself, where it comes from.
 *
 * @param props - See {@link HeaderProps}.
 * @returns The panel.
 */
function Header(props: HeaderProps) {
  const { found, update } = props;
  const state = PACKAGE_STATE_OF[found.state];

  return (
    <section className="flex flex-wrap items-start gap-x-4.5 gap-y-4 rounded-panel border border-border face-card p-5 md:flex-nowrap">
      <PackageLogo found={found} size={56} />

      <div className="flex min-w-0 grow flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-head font-semibold tracking-tight text-foreground">{found.name}</h2>
          <Badge tone={state.tone} size="small">
            {state.label}
          </Badge>
          {found.isSystem ? (
            <Badge tone="neutral" size="small">
              Part of the platform
            </Badge>
          ) : null}
          {update === undefined ? null : (
            <Badge tone="accent" size="small">
              v{update} out
            </Badge>
          )}
        </div>

        <p className="max-w-2xl text-ui leading-relaxed text-foreground-muted">
          {found.description}
        </p>

        <MetaLine
          parts={[
            <span key="id" className="font-mono">
              {found.id}
            </span>,
            <span key="version" className="tabular">
              v{found.version}
            </span>,
            <span key="source">{SOURCE_LABELS[found.source]}</span>,
            found.lastStartedAt === null ? null : (
              <span key="started" title={absoluteTime(found.lastStartedAt)}>
                Started {relativeTime(found.lastStartedAt)}
              </span>
            ),
            found.repository === null ? null : (
              <a
                key="repository"
                href={`https://github.com/${found.repository}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary transition-colors hover:text-primary-hover"
              >
                {found.repository}
                <ExternalLinkIcon width="12" height="12" />
              </a>
            ),
          ]}
        />
      </div>

      <div className="flex items-start pl-14 md:pl-0">
        <Stat value={found.deviceCount} noun={found.deviceCount === 1 ? 'device' : 'devices'} />
        <Stat value={found.entityCount} noun={found.entityCount === 1 ? 'entity' : 'entities'} />
      </div>
    </section>
  );
}

/**
 * The containers the package runs, from the host's list.
 *
 * @param props - The package.
 * @param props.packageId - Its id.
 * @returns The panel, or nothing for a package that runs none.
 */
function PackageContainers(props: { readonly packageId: string }) {
  const containers = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.list,

    /**
     * Reads the host's containers.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns Them.
     */
    queryFn: async ({ signal }) => fetchContainers(signal),
  });
  const owned = (containers.data?.items ?? []).filter(
    (container) =>
      container.managedBy?.ownerKind === 'package' &&
      container.managedBy.vendorId === props.packageId,
  );

  if (owned.length === 0) {
    return null;
  }

  return (
    <Panel title={owned.length === 1 ? 'Runs in a container' : 'Runs in containers'}>
      {owned.map((container) => (
        <PanelRow
          key={container.id}
          title={
            <Link
              to={`/containers/${encodeURIComponent(container.name)}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {container.displayName}
            </Link>
          }
          note={
            <span className="font-mono">
              {container.image}
              {container.version === null ? '' : ` · ${container.version}`}
            </span>
          }
          control={<ContainerBadges container={container} />}
        />
      ))}
    </Panel>
  );
}

/**
 * The devices the package keeps.
 *
 * @param props - The package.
 * @param props.packageId - Its id.
 * @returns The panel, or nothing for a package that keeps none.
 */
function PackageDevices(props: { readonly packageId: string }) {
  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,

    /**
     * Reads every device; the panel keeps the package's.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchDevices(signal),
  });
  const owned = (devices.data ?? []).filter(
    (device) => device.origin === 'package' && device.vendorId === props.packageId,
  );

  if (owned.length === 0) {
    return null;
  }

  return (
    <Panel title={`Devices · ${String(owned.length)}`}>
      {owned.map((device) => (
        <PanelRow
          key={device.id}
          title={
            <Link
              to={devicePath(device.id)}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {device.name}
            </Link>
          }
          note={[device.model, device.areaName].filter((part) => part !== null).join(' · ')}
          control={
            <span className="text-caption text-foreground-subtle tabular">
              {device.entityIds.length} {device.entityIds.length === 1 ? 'entity' : 'entities'}
            </span>
          }
        />
      ))}
    </Panel>
  );
}

/** What the removal dialog needs. */
type RemoveDialogProps = {
  readonly found: ApiPackageDetail | null;
  readonly onClose: () => void;
  readonly onRemoved: () => void;
};

/**
 * Asks before a package goes, and whether what it kept goes with it.
 *
 * @param props - See {@link RemoveDialogProps}.
 * @returns The dialog.
 */
function RemoveDialog(props: RemoveDialogProps) {
  const { found, onClose, onRemoved } = props;
  const [isDataRemoved, setDataRemoved] = useState(false);
  const remove = useMutation({
    /**
     * Removes it.
     *
     * @returns Nothing.
     */
    mutationFn: async () => removePackage(found?.id ?? '', isDataRemoved),
    onSuccess: onRemoved,
  });

  return (
    <Modal
      isOpen={found !== null}
      onClose={onClose}
      size="small"
      title={`Remove ${found?.name ?? ''}?`}
      description={
        found === null
          ? undefined
          : `Its ${String(found.deviceCount)} device${found.deviceCount === 1 ? '' : 's'} and ${String(found.entityCount)} entit${found.entityCount === 1 ? 'y' : 'ies'} go with it; its cards stay on the dashboards and say it is not installed.`
      }
      footer={
        <>
          <Button variant="ghost" disabled={remove.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isBusy={remove.isPending}
            onClick={() => {
              remove.mutate();
            }}
          >
            Remove
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-ui">
          <span aria-hidden="true">Delete what it kept, too</span>
          <Switch label="Delete what it kept, too" isOn={isDataRemoved} onChange={setDataRemoved} />
        </div>
        <p className="text-caption text-foreground-subtle">
          {isDataRemoved
            ? 'Its data folder is deleted: installing it again starts from nothing.'
            : 'Its data folder is kept: installing it again picks up where it left off.'}
        </p>
        {remove.error === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {toMessage(remove.error)}
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * Renders one package's page.
 *
 * @returns The page.
 */
export function PackagePage() {
  const { packageId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const canConfigure = can('package:configure');
  const canInstall = can('package:install');
  const [isConfiguring, setConfiguring] = useState(false);
  const [isRemoving, setRemoving] = useState(false);
  const [isStopAsked, setStopAsked] = useState(false);

  const detail = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.one(packageId),

    /**
     * Reads the package.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The package.
     */
    queryFn: async ({ signal }) => fetchPackage(packageId, signal),
  });
  const available = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.available,
    staleTime: 5 * 60_000,

    /**
     * Reads what the index offers, for whether a newer release is out.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The packages.
     */
    queryFn: async ({ signal }) => fetchAvailablePackages(signal),
  });

  /** Reads everything about packages again, after something was done to this one. */
  const settle = (): void => {
    void queryClient.invalidateQueries({ queryKey: PACKAGE_QUERY_KEYS.all });
  };

  const control = useMutation({
    /**
     * Starts, stops or restarts it.
     *
     * @param action - Which.
     * @returns It, as it now is.
     */
    mutationFn: async (action: 'start' | 'stop' | 'restart') => controlPackage(packageId, action),
    onSettled: settle,
  });
  const update = useMutation({
    /**
     * Updates it.
     *
     * @returns It, as it now is.
     */
    mutationFn: async () => updatePackage(packageId),
    onSettled: settle,
  });

  const found = detail.data;
  const offered = available.data?.items.find((each) => each.id === packageId);
  const newer = offered?.hasUpdate === true ? offered.latest?.version : undefined;
  const isUp = found?.state === 'running' || found?.state === 'starting';
  const problem = control.error ?? update.error;
  const hasSetup = found?.setup !== null && found?.setup !== undefined;
  const dependents = found?.usedBy ?? [];

  let action: ReactNode;

  if (found !== undefined && (canConfigure || canInstall)) {
    action = (
      <>
        {canInstall && newer !== undefined ? (
          <Button
            size="compact"
            isBusy={update.isPending}
            onClick={() => {
              update.mutate();
            }}
          >
            Update to v{newer}
          </Button>
        ) : null}
        {canConfigure && isUp ? (
          <Button
            variant="ghost"
            size="compact"
            isBusy={control.isPending && control.variables === 'restart'}
            onClick={() => {
              control.mutate('restart');
            }}
          >
            Restart
          </Button>
        ) : null}
        {canConfigure && isUp && !found.isSystem ? (
          <Button
            variant="ghost"
            size="compact"
            isBusy={control.isPending && control.variables === 'stop'}
            onClick={() => {
              if (dependents.length > 0) {
                setStopAsked(true);
              } else {
                control.mutate('stop');
              }
            }}
          >
            Stop
          </Button>
        ) : null}
        {canConfigure && !isUp ? (
          <Button
            size="compact"
            isBusy={control.isPending && control.variables === 'start'}
            onClick={() => {
              control.mutate('start');
            }}
          >
            Start
          </Button>
        ) : null}
        {canConfigure && hasSetup ? (
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              setConfiguring(true);
            }}
          >
            Configure
          </Button>
        ) : null}
        {canInstall && !found.isSystem ? (
          <Button
            variant="ghost"
            size="compact"
            disabled={dependents.length > 0}
            title={
              dependents.length > 0
                ? `${listed(dependents.map((each) => each.name))} need it`
                : undefined
            }
            onClick={() => {
              setRemoving(true);
            }}
          >
            Remove
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <>
      <LibraryPage
        title={found?.name ?? packageId}
        parent={{ to: '/packages', label: 'Packages' }}
        noun="device"
        action={action}
        isPending={detail.isPending}
        error={detail.error}
        isEmpty={false}
      >
        {found === undefined ? null : (
          <>
            <Header found={found} update={newer} />

            {problem === null ? null : (
              <p role="alert" className="text-ui text-danger">
                {toMessage(problem)}
              </p>
            )}

            {found.lastError === null && found.problems.length === 0 ? null : (
              <Panel title="What is wrong" elevation="flat">
                <div className="flex flex-col gap-1.5 px-4 py-3.5 text-ui">
                  {found.lastError === null ? null : (
                    <p className="text-danger">{found.lastError}</p>
                  )}
                  {found.problems.map((each) => (
                    <p key={each} className="text-foreground-muted">
                      {each}
                    </p>
                  ))}
                </div>
              </Panel>
            )}

            {found.dependsOn.length === 0 && found.usedBy.length === 0 ? null : (
              <Panel title="Dependencies">
                <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
                  <Relations
                    title="Depends on"
                    relations={found.dependsOn}
                    empty="Nothing: it runs on its own."
                  />
                  <Relations title="Used by" relations={found.usedBy} empty="Nothing needs it." />
                </div>
              </Panel>
            )}

            {can('container:read') ? <PackageContainers packageId={found.id} /> : null}
            {can('device:read') ? <PackageDevices packageId={found.id} /> : null}

            {found.ui?.page === true ? (
              found.state === 'running' ? (
                <PackageSlot
                  found={found}
                  target={{ kind: 'page' }}
                  loading={
                    <p role="status" className="text-ui text-foreground-subtle">
                      Loading {found.name}…
                    </p>
                  }
                  renderProblem={(message) => (
                    <Panel title={found.name} elevation="flat">
                      <PanelNote>
                        {found.name} could not draw its page: {message}
                      </PanelNote>
                    </Panel>
                  )}
                />
              ) : (
                <Panel title={found.name} elevation="flat">
                  <PanelNote>Its page is drawn while it runs.</PanelNote>
                </Panel>
              )
            ) : null}

            {found.runtime === 'node' ? (
              <LogViewer
                title="Log"
                queryKey={PACKAGE_QUERY_KEYS.logs(found.id)}
                fileName={`package-${found.id}`}
                read={async (tail, since, signal) =>
                  fetchPackageLogs(found.id, tail, since, signal)
                }
              />
            ) : null}
          </>
        )}
      </LibraryPage>

      {isConfiguring && found !== undefined ? (
        <PackageSetupDialog
          found={found}
          onClose={() => {
            setConfiguring(false);
          }}
          onSaved={() => {
            setConfiguring(false);
            settle();
          }}
        />
      ) : null}

      {isRemoving && found !== undefined ? (
        <RemoveDialog
          found={found}
          onClose={() => {
            setRemoving(false);
          }}
          onRemoved={() => {
            setRemoving(false);
            settle();
            void navigate('/packages');
          }}
        />
      ) : null}

      <Modal
        isOpen={isStopAsked}
        onClose={() => {
          setStopAsked(false);
        }}
        size="small"
        title={`Stop ${found?.name ?? ''}?`}
        description={`${listed(dependents.map((each) => each.name))} need${dependents.length === 1 ? 's' : ''} it, and stop${dependents.length === 1 ? 's' : ''} with it until it is started again.`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setStopAsked(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setStopAsked(false);
                control.mutate('stop');
              }}
            >
              Stop
            </Button>
          </>
        }
      >
        <span className="sr-only">Stopping it stops what needs it.</span>
      </Modal>
    </>
  );
}

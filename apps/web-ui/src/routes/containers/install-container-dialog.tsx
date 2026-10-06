/**
 * Installing a container: an image from Docker Hub, and how it is run.
 *
 * Two cards on one backdrop, as adding a device is: Docker Hub's images in a card of their own
 * beside the form, searched as the owner types, the official images first; the form beside it.
 * Picking an image names the container after it and fills in what the image declares - its ports,
 * published on the same numbers; its environment; its volumes, kept in NebulaHome's data so a
 * backup takes them - and every row can be changed, taken away or added to. An image that is not
 * on Docker Hub is typed into the form instead: `ghcr.io/owner/image`.
 *
 * Install answers at once; the image is pulled and the container made and started while the
 * dialog is gone, on a card of its own in the grid.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import {
  INSTALL_NETWORKS,
  RESTART_POLICIES,
  type ImageSearchResult,
  type InstallNetwork,
  type RestartPolicy,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Badge,
  Button,
  cn,
  IconButton,
  Modal,
  Segmented,
  SelectField,
  Switch,
  TextField,
} from '@nebulahome/ui';

import {
  CONTAINER_QUERY_KEYS,
  describeImage,
  fetchImageTags,
  IMAGE_QUERY_KEYS,
  installContainer,
  searchImages,
} from '@/containers/api';
import {
  applyDescription,
  checkInstall,
  EMPTY_INSTALL,
  pickImage,
  rowKey,
  type InstallDraft,
  type VolumeKind,
} from '@/containers/install-form';
import { toMessage } from '@/lib/error-message';
import { shortCount } from '@/lib/format-count';
import { useDebounced } from '@/lib/use-debounced';
import { SearchField } from '@/routes/library/search-field';

/** How the networks read. */
const NETWORK_OPTIONS: readonly { readonly value: InstallNetwork; readonly label: string }[] =
  INSTALL_NETWORKS.map((network) => ({
    value: network,
    label: network === 'platform' ? 'NebulaHome' : network === 'host' ? 'Host' : 'Bridge',
  }));

/** How the restart policies read. */
const RESTART_LABELS: Readonly<Record<RestartPolicy, string>> = {
  no: 'Never',
  always: 'Always',
  'unless-stopped': 'Unless stopped',
  'on-failure': 'When it fails',
};

/** How the kinds of folder read. */
const VOLUME_KINDS: readonly { readonly value: VolumeKind; readonly label: string }[] = [
  { value: 'data', label: 'NebulaHome data' },
  { value: 'volume', label: 'Docker volume' },
  { value: 'bind', label: 'Machine folder' },
];

/** How the protocols read. */
const PROTOCOLS = [
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
] as const;

/** What the search card needs. */
type ImageSearchProps = {
  /** The image picked, if any. */
  readonly picked: string;

  /** Called with the image picked. */
  readonly onPick: (result: ImageSearchResult) => void;
};

/**
 * Docker Hub's images, searched as the owner types: the side card.
 *
 * @param props - See {@link ImageSearchProps}.
 * @returns The card's content.
 */
function ImageSearch(props: ImageSearchProps) {
  const { picked, onPick } = props;
  const id = useId();
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 350);
  const results = useQuery({
    queryKey: IMAGE_QUERY_KEYS.search(query),
    enabled: query.length >= 2,
    staleTime: 5 * 60_000,

    /**
     * Asks Docker Hub.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns What it found.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => searchImages(query, signal),
  });
  const found = results.data?.results ?? [];

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <h3 id={`${id}-label`} className="text-title font-semibold">
          Docker Hub
        </h3>
        <SearchField
          label="Search Docker Hub"
          placeholder="Search images…"
          value={search}
          onChange={setSearch}
          className="w-full lg:w-full"
        />
      </div>

      <ul
        aria-labelledby={`${id}-label`}
        aria-busy={results.isFetching}
        className="flex min-h-0 grow flex-col gap-0.5 overflow-y-auto p-2"
      >
        {query.length < 2 ? (
          <li className="px-2.5 py-3 text-ui text-foreground-subtle">
            Type an image&apos;s name: jellyfin, pihole, grafana.
          </li>
        ) : results.isPending ? (
          <li className="px-2.5 py-3 text-ui text-foreground-subtle">Asking Docker Hub…</li>
        ) : results.error === null ? (
          found.length === 0 ? (
            <li className="px-2.5 py-3 text-ui text-foreground-subtle">
              Docker Hub has no image called “{query}”.
            </li>
          ) : null
        ) : (
          <li className="px-2.5 py-3 text-ui text-danger">{toMessage(results.error)}</li>
        )}
        {found.map((result) => {
          const isPicked = result.repository === picked;

          return (
            <li key={result.repository}>
              <button
                type="button"
                aria-pressed={isPicked}
                onClick={() => {
                  onPick(result);
                }}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-chip px-2.5 py-2 text-left',
                  'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
                  isPicked
                    ? 'bg-primary/13 text-foreground'
                    : 'text-foreground-muted hover:bg-surface-raised/70 hover:text-foreground',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-ui font-medium text-foreground">
                    {result.repository}
                  </span>
                  {result.isOfficial ? (
                    <Badge tone="accent" size="small">
                      Official
                    </Badge>
                  ) : null}
                </span>
                {result.description === null ? null : (
                  <span className="line-clamp-2 text-caption text-foreground-muted">
                    {result.description}
                  </span>
                )}
                <span className="text-caption text-foreground-subtle tabular">
                  ★ {shortCount(result.stars)} · {shortCount(result.pulls)} pulls
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * A small heading over a group of rows, with the button that adds one.
 *
 * @param props - The words and the button.
 * @param props.title - The heading.
 * @param props.addLabel - What the button says.
 * @param props.onAdd - Adds a row.
 * @returns The heading.
 */
function RowsHeading(props: {
  readonly title: string;
  readonly addLabel: string;
  readonly onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h4 className="font-mono text-label text-foreground-muted uppercase">{props.title}</h4>
      <Button variant="ghost" size="compact" onClick={props.onAdd}>
        {props.addLabel}
      </Button>
    </div>
  );
}

/**
 * The button that takes a row away.
 *
 * @param props - What it removes.
 * @param props.label - What pressing it does.
 * @param props.onRemove - Removes the row.
 * @returns The button.
 */
function RemoveRow(props: { readonly label: string; readonly onRemove: () => void }) {
  return (
    <IconButton label={props.label} size="medium" onClick={props.onRemove} className="self-end">
      <AppIcon id="x" size={15} />
    </IconButton>
  );
}

/** What the dialog needs. */
export type InstallContainerDialogProps = {
  readonly isOpen: boolean;

  /** The names containers already have. */
  readonly taken: readonly string[];
  readonly onClose: () => void;
};

/**
 * Renders the dialog.
 *
 * @param props - See {@link InstallContainerDialogProps}.
 * @returns The dialog.
 */
export function InstallContainerDialog(props: InstallContainerDialogProps) {
  const { isOpen, taken, onClose } = props;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<InstallDraft>(EMPTY_INSTALL);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [isDescribing, setDescribing] = useState(false);
  const tags = useQuery({
    queryKey: IMAGE_QUERY_KEYS.tags(draft.image),
    enabled: isOpen && draft.image !== '',
    staleTime: 5 * 60_000,
    retry: false,

    /**
     * Reads the image's tags.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The tags.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchImageTags(draft.image, signal),
  });
  const install = useMutation({
    mutationFn: installContainer,

    /** Closes, and reads the list: the install is a card of its own there now. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.list });
      setDraft(EMPTY_INSTALL);
      setErrors({});
      onClose();
    },
  });

  /** Forgets the form, and closes. */
  const close = (): void => {
    setDraft(EMPTY_INSTALL);
    setErrors({});
    install.reset();
    onClose();
  };

  /**
   * Changes the form.
   *
   * @param change - What changes.
   */
  const edit = (change: Partial<InstallDraft>): void => {
    setDraft((current) => ({ ...current, ...change }));
  };

  /**
   * Picks an image and fills the form in from what it declares.
   *
   * @param image - The image, without a tag.
   * @param tag - The tag to describe.
   */
  const pick = (image: string, tag = 'latest'): void => {
    const picked = { ...pickImage(draft, image, taken), tag };

    setDraft(picked);
    setErrors({});
    setDescribing(true);

    void queryClient
      .query({
        queryKey: IMAGE_QUERY_KEYS.describe(image, tag),
        staleTime: 5 * 60_000,

        /**
         * Reads what the image declares.
         *
         * @returns It.
         */
        queryFn: async () => describeImage(image, tag),
      })
      .then((description) => {
        // Only while the same image is picked: a later pick has its own description coming.
        setDraft((current) =>
          current.image === image ? applyDescription(current, description) : current,
        );
      })
      .catch(() => {
        // The image says nothing the form needs: its rows stay the owner's to add.
      })
      .finally(() => {
        setDescribing(false);
      });
  };

  /** Checks the form and sends it. */
  const submit = (): void => {
    const checked = checkInstall(draft, taken);

    setErrors(checked.errors ?? {});

    if (checked.request !== null) {
      install.mutate(checked.request);
    }
  };

  const tagOptions = [
    ...new Set([draft.tag, ...(tags.data?.tags.map((tag) => tag.name) ?? [])]),
  ].map((tag) => ({ value: tag, label: tag }));
  const failure = install.error === null ? null : toMessage(install.error);

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      size="large"
      title="Install a container"
      description="An image from Docker Hub, and how it runs: its ports, its settings, where it keeps its files."
      aside={
        <ImageSearch
          picked={draft.image}
          onPick={(result) => {
            pick(result.repository);
          }}
        />
      }
      asideLabel="Docker Hub"
      footer={
        <>
          {failure === null ? null : (
            <p role="alert" className="mr-auto text-ui text-danger">
              {failure}
            </p>
          )}
          <Button variant="ghost" disabled={install.isPending} onClick={close}>
            Cancel
          </Button>
          <Button isBusy={install.isPending} disabled={draft.image === ''} onClick={submit}>
            Install
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5 px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <TextField
            label="Image"
            placeholder="nginx, or ghcr.io/owner/image"
            value={draft.image}
            error={errors['image']}
            className="font-mono"
            onChange={(event) => {
              edit({ image: event.target.value.trim().toLowerCase() });
            }}
            onBlur={() => {
              if (draft.image !== '' && draft.name === '') {
                pick(draft.image, draft.tag);
              }
            }}
          />
          <SelectField
            label="Tag"
            options={tagOptions}
            value={draft.tag}
            error={errors['tag']}
            hint={tags.isFetching ? 'Reading the tags…' : undefined}
            onChange={(tag) => {
              edit({ tag });
            }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Name"
            value={draft.name}
            error={errors['name']}
            className="font-mono"
            onChange={(event) => {
              edit({ name: event.target.value });
            }}
          />
          <SelectField
            label="Restart"
            options={RESTART_POLICIES.map((policy) => ({
              value: policy,
              label: RESTART_LABELS[policy],
            }))}
            value={draft.restartPolicy}
            onChange={(restartPolicy) => {
              edit({
                restartPolicy:
                  RESTART_POLICIES.find((policy) => policy === restartPolicy) ?? 'unless-stopped',
              });
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-ui font-medium text-foreground">Network</span>
          <Segmented
            label="Network"
            size="compact"
            className="self-start"
            options={NETWORK_OPTIONS}
            value={draft.network}
            onChange={(network) => {
              edit({ network });
            }}
          />
          <span className="text-caption text-foreground-subtle">
            {draft.network === 'platform'
              ? 'Beside NebulaHome and the containers integrations run: they reach it by its name.'
              : draft.network === 'host'
                ? "On the machine's own network: every port it opens is the machine's."
                : "Docker's own network: only the ports published below reach it."}
          </span>
        </div>

        {isDescribing ? (
          <p role="status" className="text-ui text-foreground-muted">
            Reading what the image declares…
          </p>
        ) : null}

        {draft.network === 'host' ? null : (
          <section className="flex flex-col gap-2">
            <RowsHeading
              title="Ports"
              addLabel="Add port"
              onAdd={() => {
                edit({
                  ports: [
                    ...draft.ports,
                    { key: rowKey(), host: '', container: '', protocol: 'tcp' },
                  ],
                });
              }}
            />
            {draft.ports.length === 0 ? (
              <p className="text-caption text-foreground-subtle">
                None published: only other containers reach it.
              </p>
            ) : null}
            {draft.ports.map((port, index) => (
              <div
                key={port.key}
                className="grid grid-cols-[1fr_auto_1fr_6rem_auto] items-end gap-2"
              >
                <TextField
                  label="On the machine"
                  isLabelHidden={index > 0}
                  inputMode="numeric"
                  size="compact"
                  value={port.host}
                  error={errors[`ports.${String(index)}.host`]}
                  onChange={(event) => {
                    edit({
                      ports: draft.ports.map((each) =>
                        each.key === port.key ? { ...each, host: event.target.value } : each,
                      ),
                    });
                  }}
                />
                <span aria-hidden="true" className="pb-2 text-foreground-subtle">
                  →
                </span>
                <TextField
                  label="In the container"
                  isLabelHidden={index > 0}
                  inputMode="numeric"
                  size="compact"
                  value={port.container}
                  error={errors[`ports.${String(index)}.container`]}
                  onChange={(event) => {
                    edit({
                      ports: draft.ports.map((each) =>
                        each.key === port.key ? { ...each, container: event.target.value } : each,
                      ),
                    });
                  }}
                />
                <SelectField
                  label="Protocol"
                  isLabelHidden={index > 0}
                  size="compact"
                  options={PROTOCOLS}
                  value={port.protocol}
                  onChange={(protocol) => {
                    edit({
                      ports: draft.ports.map((each) =>
                        each.key === port.key
                          ? { ...each, protocol: protocol === 'udp' ? 'udp' : 'tcp' }
                          : each,
                      ),
                    });
                  }}
                />
                <RemoveRow
                  label="Remove the port"
                  onRemove={() => {
                    edit({ ports: draft.ports.filter((each) => each.key !== port.key) });
                  }}
                />
              </div>
            ))}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <RowsHeading
            title="Environment"
            addLabel="Add variable"
            onAdd={() => {
              edit({ env: [...draft.env, { key: rowKey(), name: '', value: '' }] });
            }}
          />
          {draft.env.length === 0 ? (
            <p className="text-caption text-foreground-subtle">No variable is set.</p>
          ) : null}
          {draft.env.map((entry, index) => (
            <div
              key={entry.key}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-end gap-2"
            >
              <TextField
                label="Name"
                isLabelHidden={index > 0}
                size="compact"
                className="font-mono"
                value={entry.name}
                error={errors[`env.${String(index)}.name`]}
                onChange={(event) => {
                  edit({
                    env: draft.env.map((each) =>
                      each.key === entry.key ? { ...each, name: event.target.value } : each,
                    ),
                  });
                }}
              />
              <TextField
                label="Value"
                isLabelHidden={index > 0}
                size="compact"
                className="font-mono"
                value={entry.value}
                onChange={(event) => {
                  edit({
                    env: draft.env.map((each) =>
                      each.key === entry.key ? { ...each, value: event.target.value } : each,
                    ),
                  });
                }}
              />
              <RemoveRow
                label="Remove the variable"
                onRemove={() => {
                  edit({ env: draft.env.filter((each) => each.key !== entry.key) });
                }}
              />
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-2">
          <RowsHeading
            title="Folders"
            addLabel="Add folder"
            onAdd={() => {
              edit({
                volumes: [
                  ...draft.volumes,
                  { key: rowKey(), kind: 'data', source: '', target: '', isReadOnly: false },
                ],
              });
            }}
          />
          {draft.volumes.length === 0 ? (
            <p className="text-caption text-foreground-subtle">
              Nothing kept: what it writes goes when the container does.
            </p>
          ) : (
            <p className="text-caption text-foreground-subtle">
              A folder in NebulaHome&apos;s data is backed up with the rest.
            </p>
          )}
          {draft.volumes.map((volume, index) => (
            <div
              key={volume.key}
              className="grid grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-end gap-2"
            >
              <SelectField
                label="Kept in"
                isLabelHidden={index > 0}
                size="compact"
                options={VOLUME_KINDS}
                value={volume.kind}
                onChange={(kind) => {
                  edit({
                    volumes: draft.volumes.map((each) =>
                      each.key === volume.key
                        ? {
                            ...each,
                            kind:
                              VOLUME_KINDS.find((option) => option.value === kind)?.value ?? 'data',
                          }
                        : each,
                    ),
                  });
                }}
              />
              <TextField
                label={volume.kind === 'bind' ? 'Machine path' : 'Name'}
                isLabelHidden={index > 0}
                size="compact"
                className="font-mono"
                placeholder={volume.kind === 'bind' ? '/mnt/media' : 'config'}
                value={volume.source}
                error={errors[`volumes.${String(index)}.source`]}
                onChange={(event) => {
                  edit({
                    volumes: draft.volumes.map((each) =>
                      each.key === volume.key ? { ...each, source: event.target.value } : each,
                    ),
                  });
                }}
              />
              <TextField
                label="In the container"
                isLabelHidden={index > 0}
                size="compact"
                className="font-mono"
                placeholder="/config"
                value={volume.target}
                error={errors[`volumes.${String(index)}.target`]}
                onChange={(event) => {
                  edit({
                    volumes: draft.volumes.map((each) =>
                      each.key === volume.key ? { ...each, target: event.target.value } : each,
                    ),
                  });
                }}
              />
              <Switch
                label="Read only"
                isOn={volume.isReadOnly}
                className="pb-1.5"
                onChange={(isReadOnly) => {
                  edit({
                    volumes: draft.volumes.map((each) =>
                      each.key === volume.key ? { ...each, isReadOnly } : each,
                    ),
                  });
                }}
              />
              <RemoveRow
                label="Remove the folder"
                onRemove={() => {
                  edit({ volumes: draft.volumes.filter((each) => each.key !== volume.key) });
                }}
              />
            </div>
          ))}
        </section>
      </form>
    </Modal>
  );
}

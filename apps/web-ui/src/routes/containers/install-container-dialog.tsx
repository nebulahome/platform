/**
 * Installing a container, in two steps as the board draws it: the image, then how it runs.
 *
 * **Image**: Docker Hub's images, searched across the whole dialog as the owner types, each a row
 * with its marks - Docker official, stars, pulls - and a radio; or, under Other registry, a full
 * reference typed in: `ghcr.io/owner/image`. A line at the foot says which is picked; its tag is
 * chosen in the next step.
 *
 * **Settings**: a menu of the sections on the left - General, Ports and Storage (marked "from
 * image" when the image declared them), Environment, Devices, Network - and the sections on the
 * right. Picking an image names the container after it and fills in what the image declares - its
 * ports, published on the same numbers; its environment; its volumes, kept in NebulaHome's data so
 * a backup takes them - and every row can be changed, taken away or added to.
 *
 * Install answers at once; the image is pulled and the container made and started while the
 * dialog is gone, on a card of its own in the grid.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

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
  WizardSteps,
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
import { defineMessage, type Message, text, translate, withLabels } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { shortCount } from '@/lib/format-count';
import { useDebounced } from '@/lib/use-debounced';
import { SearchField } from '@/routes/library/search-field';

/**
 * How the networks read.
 *
 * @returns The choices, in the reader's language.
 */
function networkOptions(): readonly { readonly value: InstallNetwork; readonly label: string }[] {
  return INSTALL_NETWORKS.map((network) => ({
    value: network,
    label:
      network === 'platform'
        ? 'NebulaHome'
        : network === 'host'
          ? translate('containers.installContainerDialog.host', 'Host')
          : translate('containers.installContainerDialog.bridge', 'Bridge'),
  }));
}

/** How the restart policies read. */
const RESTART_LABELS: Readonly<Record<RestartPolicy, Message>> = {
  no: defineMessage('containers.installContainerDialog.never', 'Never'),
  always: defineMessage('containers.installContainerDialog.always', 'Always'),
  'unless-stopped': defineMessage(
    'containers.installContainerDialog.unlessStopped',
    'Unless stopped',
  ),
  'on-failure': defineMessage('containers.installContainerDialog.whenItFails', 'When it fails'),
};

/** How the kinds of folder read. */
const VOLUME_KINDS: readonly { readonly value: VolumeKind; readonly label: Message }[] = [
  {
    value: 'data',
    label: defineMessage('containers.installContainerDialog.nebulahomeData', 'NebulaHome data'),
  },
  {
    value: 'volume',
    label: defineMessage('containers.installContainerDialog.dockerVolume', 'Docker volume'),
  },
  {
    value: 'bind',
    label: defineMessage('containers.installContainerDialog.machineFolder', 'Machine folder'),
  },
];

/** How the protocols read. */
const PROTOCOLS = [
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
] as const;

/** What the search needs. */
type ImageSearchProps = {
  /** The image picked, if any. */
  readonly picked: string;

  /** Called with the image picked. */
  readonly onPick: (result: ImageSearchResult) => void;
};

/**
 * Docker Hub's images, searched as the owner types: a field across the dialog, then a row per
 * image, the one picked marked.
 *
 * @param props - See {@link ImageSearchProps}.
 * @returns The search.
 */
function ImageSearch(props: ImageSearchProps) {
  const { t } = useTranslation();

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
    <div className="flex flex-col gap-3">
      <SearchField
        label={t('containers.installContainerDialog.searchDockerHub', 'Search Docker Hub')}
        placeholder={t('containers.installContainerDialog.searchImages', 'Search images…')}
        value={search}
        onChange={setSearch}
        className="w-full lg:w-full"
      />

      <ul
        id={id}
        aria-label={t('containers.installContainerDialog.dockerHubImages', 'Docker Hub images')}
        aria-busy={results.isFetching}
        className="flex flex-col gap-1"
      >
        {query.length < 2 ? (
          <li className="px-3 py-3 text-ui text-foreground-subtle">
            {t(
              'containers.installContainerDialog.typeAnImageS',
              "Type an image's name: jellyfin, pihole, grafana.",
            )}
          </li>
        ) : results.isPending ? (
          <li className="px-3 py-3 text-ui text-foreground-subtle">
            {t('containers.installContainerDialog.askingDockerHub', 'Asking Docker Hub…')}
          </li>
        ) : results.error === null ? (
          found.length === 0 ? (
            <li className="px-3 py-3 text-ui text-foreground-subtle">
              {t(
                'containers.installContainerDialog.dockerHubHasNo',
                'Docker Hub has no image called “{{query}}”.',
                { query },
              )}
            </li>
          ) : null
        ) : (
          <li className="px-3 py-3 text-ui text-danger">{toMessage(results.error)}</li>
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
                  'flex w-full items-center gap-3.5 rounded-tile border px-3.5 py-3 text-left transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                  isPicked
                    ? 'border-primary bg-primary-soft'
                    : 'border-transparent hover:bg-surface-raised',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border',
                    isPicked ? 'border-primary' : 'border-border-strong',
                  )}
                >
                  {isPicked ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-field border border-border-strong bg-surface-raised text-cyan">
                  <AppIcon id="container" size={17} />
                </span>
                <span className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-mono-ui text-foreground">
                      {result.repository}
                    </span>
                    {result.isOfficial ? (
                      <Badge tone="cyan" size="small">
                        {t('containers.installContainerDialog.dockerOfficial', 'Docker official')}
                      </Badge>
                    ) : null}
                  </span>
                  {result.description === null ? null : (
                    <span className="truncate text-ui-sm text-foreground-subtle">
                      {result.description}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-3 text-caption text-foreground-muted tabular">
                  <span className="flex items-center gap-1">
                    <AppIcon id="star" size={13} className="text-lamp" />
                    {shortCount(result.stars)}
                  </span>
                  <span className="flex items-center gap-1">
                    <AppIcon id="download" size={13} />
                    {shortCount(result.pulls)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One section of the settings step: its heading, a line under it, the button that adds a row,
 * and its rows.
 *
 * @param props - The section.
 * @param props.id - Where the menu on the left scrolls to.
 * @param props.title - Its heading.
 * @param props.note - A line under the heading.
 * @param props.action - The button that adds a row.
 * @param props.children - Its rows.
 * @returns The section.
 */
function SettingsSection(props: {
  readonly id: string;
  readonly title: string;
  readonly note?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={props.id}
      className="flex scroll-mt-4 flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-title font-medium text-foreground">{props.title}</h3>
          {props.note === undefined ? null : (
            <p className="text-ui-sm text-foreground-subtle">{props.note}</p>
          )}
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

/**
 * The button that adds a row to a section.
 *
 * @param props - What it says, and what it does.
 * @param props.label - What it says.
 * @param props.onAdd - Adds a row.
 * @returns The button.
 */
function AddRow(props: { readonly label: string; readonly onAdd: () => void }) {
  return (
    <Button variant="ghost" size="compact" onClick={props.onAdd}>
      <AppIcon id="plus" size={14} />
      {props.label}
    </Button>
  );
}

/** The sections of the settings step, in the order they read. */
const SECTIONS = [
  { id: 'general', label: defineMessage('containers.installContainerDialog.general', 'General') },
  { id: 'ports', label: defineMessage('containers.installContainerDialog.ports', 'Ports') },
  { id: 'storage', label: defineMessage('containers.installContainerDialog.storage', 'Storage') },
  {
    id: 'environment',
    label: defineMessage('containers.installContainerDialog.environment', 'Environment'),
  },
  { id: 'devices', label: defineMessage('containers.installContainerDialog.devices', 'Devices') },
  { id: 'network', label: defineMessage('containers.installContainerDialog.network', 'Network') },
] as const;

/** Where the registry search looks. */
type Registry = 'hub' | 'other';

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
  const { t } = useTranslation();

  const { isOpen, taken, onClose } = props;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<InstallDraft>(EMPTY_INSTALL);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [isDescribing, setDescribing] = useState(false);
  const [isDescribed, setDescribed] = useState(false);
  const [step, setStep] = useState(0);
  const [registry, setRegistry] = useState<Registry>('hub');
  const tags = useQuery({
    queryKey: IMAGE_QUERY_KEYS.tags(draft.image),
    enabled: isOpen && draft.image !== '' && step === 1,
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
      setStep(0);
      onClose();
    },
  });

  /** Forgets the form, and closes. */
  const close = (): void => {
    setDraft(EMPTY_INSTALL);
    setErrors({});
    setStep(0);
    setDescribed(false);
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
    setDescribed(false);

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
        setDescribed(true);
      })
      .catch(() => {
        // The image says nothing the form needs: its rows stay the owner's to add.
      })
      .finally(() => {
        setDescribing(false);
      });
  };

  /** Goes on to the settings, naming the container after a typed image if nothing did yet. */
  const next = (): void => {
    if (draft.name === '') {
      pick(draft.image, draft.tag);
    }

    setStep(1);
  };

  /** Checks the form and sends it, going back to the image when that is what is wrong. */
  const submit = (): void => {
    const checked = checkInstall(draft, taken);

    setErrors(checked.errors ?? {});

    if (checked.request !== null) {
      install.mutate(checked.request);
    } else if (checked.errors['image'] !== undefined) {
      setStep(0);
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
      size="xlarge"
      layout="sections"
      title={t('containers.installContainerDialog.installAContainer', 'Install a container')}
      trail={
        <WizardSteps
          steps={[
            t('containers.installContainerDialog.image', 'Image'),
            t('containers.installContainerDialog.settings', 'Settings'),
          ]}
          current={step}
          className="mr-2"
        />
      }
      footer={
        step === 0 ? (
          <>
            <Button variant="bare" onClick={close}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button disabled={draft.image === ''} onClick={next}>
              <AppIcon id="arrow-right" size={15} />
              {t('containers.installContainerDialog.nextSettings', 'Next: settings')}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="bare"
              disabled={install.isPending}
              onClick={() => {
                setStep(0);
              }}
            >
              <AppIcon id="chevron-left" size={15} />
              {t('containers.installContainerDialog.back', 'Back')}
            </Button>
            <span className="flex items-center gap-2.5">
              {failure === null ? null : (
                <span role="alert" className="text-ui-sm text-danger">
                  {failure}
                </span>
              )}
              <Button variant="bare" disabled={install.isPending} onClick={close}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button isBusy={install.isPending} onClick={submit}>
                <AppIcon id="download" size={15} />
                {t('containers.installContainerDialog.install', 'Install')}
              </Button>
            </span>
          </>
        )
      }
    >
      {step === 0 ? (
        <div className="flex grow flex-col gap-4 px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label={t('containers.installContainerDialog.registry', 'Registry')}
              size="compact"
              options={[
                {
                  value: 'hub',
                  label: t('containers.installContainerDialog.dockerHub', 'Docker Hub'),
                },
                {
                  value: 'other',
                  label: t('containers.installContainerDialog.otherRegistry', 'Other registry'),
                },
              ]}
              value={registry}
              onChange={setRegistry}
            />
            <span className="text-caption text-foreground-subtle">
              {t(
                'containers.installContainerDialog.orAFullImage',
                'Or a full image reference, e.g. ghcr.io/owner/app',
              )}
            </span>
          </div>

          {registry === 'hub' ? (
            <ImageSearch
              picked={draft.image}
              onPick={(result) => {
                pick(result.repository);
              }}
            />
          ) : (
            <TextField
              label={t('containers.installContainerDialog.imageReference', 'Image reference')}
              placeholder={t(
                'containers.installContainerDialog.ghcrIoOwnerImage',
                'ghcr.io/owner/image',
              )}
              value={draft.image}
              error={errors['image']}
              className="font-mono"
              onChange={(event) => {
                edit({ image: event.target.value.trim().toLowerCase(), name: '' });
              }}
            />
          )}

          <span className="grow" />

          {draft.image === '' ? null : (
            <p
              role="status"
              className="flex items-center gap-2.5 rounded-tile border border-border px-4 py-3 text-ui-sm text-foreground-muted"
            >
              <AppIcon id="info" size={15} className="shrink-0" />
              <span>
                <Trans
                  i18nKey="containers.installContainerDialog.selectedImage"
                  defaults="Selected <0>{{image}}</0> · you choose the tag in the next step."
                  values={{ image: draft.image }}
                  components={[<span key="image" className="font-mono text-foreground" />]}
                />
              </span>
            </p>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 grow">
          <nav
            aria-label={t('containers.installContainerDialog.sections', 'Sections')}
            className="hidden w-52 shrink-0 flex-col gap-0.5 border-r border-border p-3 md:flex"
          >
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#install-${section.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  document
                    .getElementById(`install-${section.id}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="flex h-9.5 items-center justify-between gap-2 rounded-field px-3 text-ui text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                {text(section.label)}
                {isDescribed &&
                ((section.id === 'ports' && draft.ports.length > 0) ||
                  (section.id === 'storage' && draft.volumes.length > 0)) ? (
                  <span className="text-caption text-foreground-subtle">
                    {t('containers.installContainerDialog.fromImage', 'from image')}
                  </span>
                ) : null}
              </a>
            ))}
          </nav>

          <form
            className="flex min-w-0 grow flex-col gap-5 overflow-y-auto px-6 py-5"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <SettingsSection
              id="install-general"
              title={t('containers.installContainerDialog.general', 'General')}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label={t('containers.installContainerDialog.name', 'Name')}
                  value={draft.name}
                  error={errors['name']}
                  hint={t(
                    'containers.installContainerDialog.lowerCaseUniqueOn',
                    'Lower case, unique on this machine.',
                  )}
                  className="font-mono"
                  onChange={(event) => {
                    edit({ name: event.target.value });
                  }}
                />
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    label={t('containers.installContainerDialog.image', 'Image')}
                    value={draft.image}
                    readOnly
                    className="font-mono text-foreground-muted"
                  />
                  <SelectField
                    label={t('containers.installContainerDialog.tag', 'Tag')}
                    options={tagOptions}
                    value={draft.tag}
                    error={errors['tag']}
                    hint={
                      tags.isFetching
                        ? t('containers.installContainerDialog.readingTheTags', 'Reading the tags…')
                        : undefined
                    }
                    onChange={(tag) => {
                      edit({ tag });
                    }}
                  />
                </div>
                <SelectField
                  label={t('containers.installContainerDialog.restart', 'Restart')}
                  options={RESTART_POLICIES.map((policy) => ({
                    value: policy,
                    label: text(RESTART_LABELS[policy]),
                  }))}
                  value={draft.restartPolicy}
                  onChange={(restartPolicy) => {
                    edit({
                      restartPolicy:
                        RESTART_POLICIES.find((policy) => policy === restartPolicy) ??
                        'unless-stopped',
                    });
                  }}
                />
              </div>
              {isDescribing ? (
                <p role="status" className="text-ui-sm text-foreground-muted">
                  {t(
                    'containers.installContainerDialog.readingWhatTheImage',
                    'Reading what the image declares…',
                  )}
                </p>
              ) : tags.data === undefined ? null : (
                <p className="flex items-center gap-2 rounded-tile bg-success-soft px-3.5 py-2.5 text-ui-sm text-foreground-muted">
                  <AppIcon id="check" size={14} className="shrink-0 text-success" />
                  <span className="truncate">
                    <span className="font-mono text-foreground">
                      {draft.image}:{draft.tag}
                    </span>{' '}
                    · {tags.data.tags.length}{' '}
                    {tags.data.tags.length === 1
                      ? t('containers.installContainerDialog.tag2', 'tag')
                      : t('containers.installContainerDialog.tags', 'tags')}
                  </span>
                </p>
              )}
            </SettingsSection>

            <SettingsSection
              id="install-ports"
              title={t('containers.installContainerDialog.ports', 'Ports')}
              note={
                draft.network === 'host'
                  ? t(
                      'containers.installContainerDialog.onTheMachineS',
                      "On the machine's own network: every port it opens is the machine's.",
                    )
                  : draft.ports.length === 0
                    ? t(
                        'containers.installContainerDialog.nonePublishedOnlyOther',
                        'None published: only other containers reach it.',
                      )
                    : t(
                        'containers.installContainerDialog.publishedOnTheMachine',
                        'Published on the machine, as the image declares them.',
                      )
              }
              action={
                draft.network === 'host' ? undefined : (
                  <AddRow
                    label={t('containers.installContainerDialog.addPort', 'Add port')}
                    onAdd={() => {
                      edit({
                        ports: [
                          ...draft.ports,
                          { key: rowKey(), host: '', container: '', protocol: 'tcp' },
                        ],
                      });
                    }}
                  />
                )
              }
            >
              {draft.network === 'host'
                ? null
                : draft.ports.map((port, index) => (
                    <div
                      key={port.key}
                      className="grid grid-cols-[1fr_auto_1fr_6rem_auto] items-end gap-2"
                    >
                      <TextField
                        label={t(
                          'containers.installContainerDialog.onTheMachine',
                          'On the machine',
                        )}
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
                        label={t(
                          'containers.installContainerDialog.inTheContainer',
                          'In the container',
                        )}
                        isLabelHidden={index > 0}
                        inputMode="numeric"
                        size="compact"
                        value={port.container}
                        error={errors[`ports.${String(index)}.container`]}
                        onChange={(event) => {
                          edit({
                            ports: draft.ports.map((each) =>
                              each.key === port.key
                                ? { ...each, container: event.target.value }
                                : each,
                            ),
                          });
                        }}
                      />
                      <SelectField
                        label={t('containers.installContainerDialog.protocol', 'Protocol')}
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
                        label={t(
                          'containers.installContainerDialog.removeThePort',
                          'Remove the port',
                        )}
                        onRemove={() => {
                          edit({ ports: draft.ports.filter((each) => each.key !== port.key) });
                        }}
                      />
                    </div>
                  ))}
            </SettingsSection>

            <SettingsSection
              id="install-storage"
              title={t('containers.installContainerDialog.storage', 'Storage')}
              note={
                draft.volumes.length === 0
                  ? t(
                      'containers.installContainerDialog.nothingKeptWhatIt',
                      'Nothing kept: what it writes goes when the container does.',
                    )
                  : t(
                      'containers.installContainerDialog.folderInNebulahomeS',
                      "A folder in NebulaHome's data is backed up with the rest.",
                    )
              }
              action={
                <AddRow
                  label={t('containers.installContainerDialog.addFolder', 'Add folder')}
                  onAdd={() => {
                    edit({
                      volumes: [
                        ...draft.volumes,
                        { key: rowKey(), kind: 'data', source: '', target: '', isReadOnly: false },
                      ],
                    });
                  }}
                />
              }
            >
              {draft.volumes.map((volume, index) => (
                <div
                  key={volume.key}
                  className="grid grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-end gap-2"
                >
                  <SelectField
                    label={t('containers.installContainerDialog.keptIn', 'Kept in')}
                    isLabelHidden={index > 0}
                    size="compact"
                    options={withLabels(VOLUME_KINDS)}
                    value={volume.kind}
                    onChange={(kind) => {
                      edit({
                        volumes: draft.volumes.map((each) =>
                          each.key === volume.key
                            ? {
                                ...each,
                                kind:
                                  VOLUME_KINDS.find((option) => option.value === kind)?.value ??
                                  'data',
                              }
                            : each,
                        ),
                      });
                    }}
                  />
                  <TextField
                    label={
                      volume.kind === 'bind'
                        ? t('containers.installContainerDialog.machinePath', 'Machine path')
                        : t('containers.installContainerDialog.name', 'Name')
                    }
                    isLabelHidden={index > 0}
                    size="compact"
                    className="font-mono"
                    placeholder={
                      volume.kind === 'bind'
                        ? t('containers.installContainerDialog.mntMedia', '/mnt/media')
                        : t('containers.installContainerDialog.config', 'config')
                    }
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
                    label={t(
                      'containers.installContainerDialog.inTheContainer',
                      'In the container',
                    )}
                    isLabelHidden={index > 0}
                    size="compact"
                    className="font-mono"
                    placeholder={t('containers.installContainerDialog.config2', '/config')}
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
                    label={t('containers.installContainerDialog.readOnly', 'Read only')}
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
                    label={t(
                      'containers.installContainerDialog.removeTheFolder',
                      'Remove the folder',
                    )}
                    onRemove={() => {
                      edit({ volumes: draft.volumes.filter((each) => each.key !== volume.key) });
                    }}
                  />
                </div>
              ))}
            </SettingsSection>

            <SettingsSection
              id="install-environment"
              title={t('containers.installContainerDialog.environment', 'Environment')}
              note={
                draft.env.length === 0
                  ? t('containers.installContainerDialog.noVariableIsSet', 'No variable is set.')
                  : undefined
              }
              action={
                <AddRow
                  label={t('containers.installContainerDialog.addVariable', 'Add variable')}
                  onAdd={() => {
                    edit({ env: [...draft.env, { key: rowKey(), name: '', value: '' }] });
                  }}
                />
              }
            >
              {draft.env.map((entry, index) => (
                <div
                  key={entry.key}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-end gap-2"
                >
                  <TextField
                    label={t('containers.installContainerDialog.name', 'Name')}
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
                    label={t('containers.installContainerDialog.value', 'Value')}
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
                    label={t(
                      'containers.installContainerDialog.removeTheVariable',
                      'Remove the variable',
                    )}
                    onRemove={() => {
                      edit({ env: draft.env.filter((each) => each.key !== entry.key) });
                    }}
                  />
                </div>
              ))}
            </SettingsSection>

            <SettingsSection
              id="install-devices"
              title={t('containers.installContainerDialog.devices', 'Devices')}
              note={
                draft.devices.length === 0
                  ? t(
                      'containers.installContainerDialog.noneHandedOverA',
                      'None handed over: a USB stick or a radio of the machine, such as /dev/ttyUSB0.',
                    )
                  : t(
                      'containers.installContainerDialog.handedToTheContainer',
                      'Handed to the container as they are.',
                    )
              }
              action={
                draft.devices.length >= 8 ? undefined : (
                  <AddRow
                    label={t('containers.installContainerDialog.addDevice', 'Add device')}
                    onAdd={() => {
                      edit({
                        devices: [...draft.devices, { key: rowKey(), host: '', container: '' }],
                      });
                    }}
                  />
                )
              }
            >
              {draft.devices.map((device, index) => (
                <div
                  key={device.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-end gap-2"
                >
                  <TextField
                    label={t('containers.installContainerDialog.onTheMachine', 'On the machine')}
                    isLabelHidden={index > 0}
                    size="compact"
                    className="font-mono"
                    placeholder={t('containers.installContainerDialog.devTtyusb0', '/dev/ttyUSB0')}
                    value={device.host}
                    error={errors[`devices.${String(index)}.host`]}
                    onChange={(event) => {
                      edit({
                        devices: draft.devices.map((each) =>
                          each.key === device.key ? { ...each, host: event.target.value } : each,
                        ),
                      });
                    }}
                  />
                  <span aria-hidden="true" className="pb-2 text-foreground-subtle">
                    →
                  </span>
                  <TextField
                    label={t(
                      'containers.installContainerDialog.inTheContainer',
                      'In the container',
                    )}
                    isLabelHidden={index > 0}
                    size="compact"
                    className="font-mono"
                    placeholder={t('containers.installContainerDialog.samePath', 'The same path')}
                    value={device.container}
                    error={errors[`devices.${String(index)}.container`]}
                    onChange={(event) => {
                      edit({
                        devices: draft.devices.map((each) =>
                          each.key === device.key
                            ? { ...each, container: event.target.value }
                            : each,
                        ),
                      });
                    }}
                  />
                  <RemoveRow
                    label={t(
                      'containers.installContainerDialog.removeTheDevice',
                      'Remove the device',
                    )}
                    onRemove={() => {
                      edit({ devices: draft.devices.filter((each) => each.key !== device.key) });
                    }}
                  />
                </div>
              ))}
            </SettingsSection>

            <SettingsSection
              id="install-network"
              title={t('containers.installContainerDialog.network', 'Network')}
              note={
                draft.network === 'platform'
                  ? t(
                      'containers.installContainerDialog.besideNebulahomeAndThe',
                      'Beside NebulaHome and the containers integrations run: they reach it by its name.',
                    )
                  : draft.network === 'host'
                    ? t(
                        'containers.installContainerDialog.onTheMachineS',
                        "On the machine's own network: every port it opens is the machine's.",
                      )
                    : t(
                        'containers.installContainerDialog.dockerSOwnNetwork',
                        "Docker's own network: only the ports published reach it.",
                      )
              }
            >
              <Segmented
                label={t('containers.installContainerDialog.network', 'Network')}
                size="compact"
                className="self-start"
                options={networkOptions()}
                value={draft.network}
                onChange={(network) => {
                  edit({ network });
                }}
              />
            </SettingsSection>
          </form>
        </div>
      )}
    </Modal>
  );
}

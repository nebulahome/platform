/**
 * The Thread broker's dialogs: Set up, Settings, and How to fix the host's IPv6 settings.
 *
 * **Set up** is three steps across the dialog. The radio: the free serial ports, recognised
 * radios first, each checked for OpenThread RCP firmware once picked (a Zigbee one says so, with
 * the maker's flasher), or an external border router by the address of its REST API. The
 * network: create one (its name prefilled, the channel automatic or picked) or join one by its
 * dataset. Then the job's steps ticking - border router, radio, network, handed to Matter - and a
 * failure stopping on its step with the line and Try again (the same request again).
 *
 * **Settings**: the network's name and channel, joining another network (confirmed: the devices
 * stay on the old one), whether Matter uses it, and the border router's Restart and Remove
 * (confirmed: devices lose their way to the house).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ThreadRadio, ThreadSetupRequest, ThreadStatus } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  Modal,
  Note,
  Segmented,
  SelectField,
  Switch,
  TextArea,
  TextField,
  WizardSteps,
} from '@nebulahome/ui';

import { ThreadLogo } from '@/components/brand-logos';
import { toMessage } from '@/lib/error-message';
import {
  checkThreadRadio,
  fetchThreadRadios,
  joinThread,
  removeThread,
  restartThread,
  saveThreadSettings,
  setUpThread,
  THREAD_QUERY_KEYS,
} from '@/library/thread-api';
import { TickingSteps } from '@/routes/library/broker-matter/matter-steps';
import { ChoiceCard, Snippet } from '@/routes/library/broker-parts';
import { BrokerMark } from '@/routes/library/brokers-page';

/** The channels a Thread network can be on. */
const CHANNELS = Array.from({ length: 16 }, (unused, index) => index + 11);

/** What Set up needs. */
export type ThreadSetupDialogProps = {
  readonly status: ThreadStatus;
  readonly onClose: () => void;

  /** A port to start at: Serial's Use with…. */
  readonly portId?: string | null;
};

/**
 * A network name of the house's own: `NebulaHome-` and four hex digits.
 *
 * @returns The name.
 */
function suggestedName(): string {
  return `NebulaHome-${Math.floor(Math.random() * 0x10000)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0')}`;
}

/**
 * Renders Set up.
 *
 * @param props - See {@link ThreadSetupDialogProps}.
 * @returns The dialog.
 */
export function ThreadSetupDialog(props: ThreadSetupDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { status, onClose } = props;
  const job = status.setup;
  const [step, setStep] = useState(job?.state === 'running' ? 2 : 0);
  const [border, setBorder] = useState<string>(props.portId ?? '');
  const [url, setUrl] = useState('');
  const [action, setAction] = useState<'create' | 'join'>('create');
  const [name, setName] = useState(suggestedName);
  const [channel, setChannel] = useState<number | null>(null);
  const [dataset, setDataset] = useState('');
  const [request, setRequest] = useState<ThreadSetupRequest | null>(null);

  const radios = useQuery({
    queryKey: THREAD_QUERY_KEYS.radios,

    /**
     * Reads the ports a radio could be on.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns Them.
     */
    queryFn: async ({ signal }) => fetchThreadRadios(signal),
  });
  const radioList = radios.data ?? [];
  const firstPort = border === '' ? (radioList[0]?.portId ?? '') : border;
  const check = useQuery({
    queryKey: [...THREAD_QUERY_KEYS.radios, 'check', firstPort],
    enabled: firstPort !== '' && firstPort !== 'external' && step === 0,
    staleTime: Infinity,
    retry: false,

    /**
     * Asks the port which firmware its radio runs.
     *
     * @returns The firmware.
     */
    queryFn: async () => checkThreadRadio(firstPort),
  });
  const start = useMutation({
    /**
     * Starts the setup, or tries it again with the same request.
     *
     * @param next - The request.
     * @returns Where Thread stands, the job in it.
     */
    mutationFn: async (next: ThreadSetupRequest) => setUpThread(next),

    /**
     * Follows the job on the page's status.
     *
     * @param next - Where Thread stands.
     */
    onSuccess: (next) => {
      queryClient.setQueryData(THREAD_QUERY_KEYS.status, next);
      setStep(2);
    },
  });

  const isExternal = firstPort === 'external';
  const isZigbee = check.data?.firmware === 'zigbee';
  const picked = radioList.find((radio) => radio.portId === firstPort);
  const canNext =
    step === 0
      ? isExternal
        ? /^https?:\/\/\S+$/u.test(url.trim())
        : firstPort !== '' && !isZigbee
      : action === 'create'
        ? name.trim() !== ''
        : /^(?:[0-9a-fA-F]{2})+$/u.test(dataset.trim());

  /** Builds the request from what was chosen, and starts it. */
  const submit = (): void => {
    const next: ThreadSetupRequest = {
      border: isExternal
        ? { mode: 'external', url: url.trim() }
        : { mode: 'local', portId: firstPort },
      network:
        action === 'create'
          ? { action: 'create', name: name.trim(), channel }
          : { action: 'join', dataset: dataset.trim().toLowerCase() },
      useForMatter: true,
    };

    setRequest(next);
    start.mutate(next);
  };

  const steps = job?.steps ?? [];

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="large"
      layout="card"
      lead={<BrokerMark broker="thread" size={44} isLit />}
      title={t('brokers.thread.setup.title', 'Set up Thread')}
      description={t('brokers.thread.setup.line', 'Radio, network, then it starts')}
      closesOnBackdrop={step === 0}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            {step === 2 ? (
              <>
                {job?.state === 'failed' && request !== null ? (
                  <Button
                    variant="ghost"
                    isBusy={start.isPending}
                    onClick={() => {
                      start.mutate(request);
                    }}
                  >
                    {t('brokers.thread.setup.tryAgain', 'Try again')}
                  </Button>
                ) : null}
                <Button variant={job?.state === 'succeeded' ? 'primary' : 'bare'} onClick={onClose}>
                  {job?.state === 'succeeded'
                    ? t('brokers.thread.setup.done', 'Done')
                    : t('common.close', 'Close')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="bare"
                  onClick={() => {
                    if (step === 0) {
                      onClose();
                    } else {
                      setStep(0);
                    }
                  }}
                >
                  {step === 0 ? t('common.cancel', 'Cancel') : t('common.back', 'Back')}
                </Button>
                <Button
                  disabled={!canNext}
                  isBusy={start.isPending}
                  onClick={() => {
                    if (step === 0) {
                      setStep(1);
                    } else {
                      submit();
                    }
                  }}
                >
                  {step === 0
                    ? t('common.next', 'Next')
                    : t('brokers.thread.setup.submit', 'Set up network')}
                </Button>
              </>
            )}
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <WizardSteps
          layout="stacked"
          current={step}
          steps={[
            t('brokers.thread.setup.radio', 'Radio'),
            t('brokers.thread.setup.network', 'Network'),
            t('brokers.thread.setup.starting', 'Starting'),
          ]}
        />

        {step === 0 ? (
          <div role="radiogroup" className="flex flex-col gap-2.5">
            <span className="font-mono text-label text-foreground-subtle uppercase">
              {t('brokers.thread.setup.freePorts', 'Free serial ports')}
            </span>
            {radioList.length === 0 ? (
              <p className="text-ui-sm text-foreground-subtle">
                {t(
                  'brokers.thread.setup.noRadio',
                  'No free serial port: plug in a SkyConnect, ZBT-1 or another OpenThread RCP radio.',
                )}
              </p>
            ) : (
              radioList.map((radio) => (
                <RadioChoice
                  key={radio.portId}
                  radio={radio}
                  isChosen={firstPort === radio.portId}
                  onSelect={() => {
                    setBorder(radio.portId);
                  }}
                  check={firstPort === radio.portId ? check.data : undefined}
                  isChecking={firstPort === radio.portId && check.isFetching}
                />
              ))
            )}
            <span className="mt-1 font-mono text-label text-foreground-subtle uppercase">
              {t('brokers.thread.setup.or', 'Or')}
            </span>
            <ChoiceCard
              isChosen={isExternal}
              onSelect={() => {
                setBorder('external');
              }}
              extra={
                <TextField
                  label={t('brokers.thread.setup.url', 'REST API address')}
                  value={url}
                  placeholder={t('brokers.thread.setup.urlPlaceholder', 'http://192.168.1.20:8081')}
                  className="font-mono"
                  onChange={(event) => {
                    setUrl(event.target.value);
                  }}
                />
              }
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-muted">
                <AppIcon id="globe" size={16} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui font-medium text-foreground">
                  {t('brokers.thread.setup.external', 'Use an external border router')}
                </span>
                <span className="text-ui-sm text-foreground-muted">
                  {t(
                    'brokers.thread.setup.externalLine',
                    'One already running elsewhere, by the address of its REST API.',
                  )}
                </span>
              </span>
            </ChoiceCard>
            {isZigbee && picked !== undefined ? (
              <Note
                tone="danger"
                action={
                  picked.flasherUrl === null ? undefined : (
                    <a
                      href={picked.flasherUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-ui-sm font-medium text-foreground hover:text-primary"
                    >
                      {t('brokers.thread.setup.flasher', 'Open the flasher')}
                      <AppIcon id="external-link" size={13} />
                    </a>
                  )
                }
              >
                {t(
                  'brokers.thread.setup.zigbee',
                  'This radio runs Zigbee firmware. Flash the OpenThread RCP firmware first.',
                )}
              </Note>
            ) : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div role="radiogroup" className="flex flex-col gap-2.5">
            <ChoiceCard
              isChosen={action === 'create'}
              onSelect={() => {
                setAction('create');
              }}
              extra={
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <TextField
                    label={t('brokers.thread.setup.name', 'Name')}
                    value={name}
                    maxLength={16}
                    className="font-mono"
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                  />
                  <div className="flex flex-col gap-1.5">
                    <span className="text-ui-sm text-foreground-muted">
                      {t('brokers.thread.setup.channel', 'Channel')}
                    </span>
                    <span className="flex items-center gap-2">
                      <Segmented
                        label={t('brokers.thread.setup.channel', 'Channel')}
                        value={channel === null ? 'auto' : 'pick'}
                        onChange={(value) => {
                          setChannel(value === 'auto' ? null : 15);
                        }}
                        options={[
                          {
                            value: 'auto',
                            label: t('brokers.thread.setup.automatic', 'Automatic'),
                          },
                          { value: 'pick', label: t('brokers.thread.setup.pick', 'Pick') },
                        ]}
                      />
                      {channel === null ? null : (
                        <SelectField
                          label={t('brokers.thread.setup.channel', 'Channel')}
                          isLabelHidden
                          className="w-20"
                          value={String(channel)}
                          onChange={(value) => {
                            setChannel(Number(value));
                          }}
                          options={CHANNELS.map((each) => ({
                            value: String(each),
                            label: String(each),
                          }))}
                        />
                      )}
                    </span>
                  </div>
                </div>
              }
              className="items-start"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-thread/12 text-thread">
                <AppIcon id="plus" size={16} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui font-medium text-foreground">
                  {t('brokers.thread.setup.create', 'Create a new network')}
                </span>
                <span className="text-ui-sm text-foreground-muted">
                  {t(
                    'brokers.thread.setup.createLine',
                    'The house’s own Thread network, with this server as its first border router.',
                  )}
                </span>
              </span>
            </ChoiceCard>
            <ChoiceCard
              isChosen={action === 'join'}
              onSelect={() => {
                setAction('join');
              }}
              extra={
                <TextArea
                  label={t('brokers.thread.setup.dataset', 'Dataset')}
                  isLabelHidden
                  rows={3}
                  value={dataset}
                  className="font-mono text-mono-caption"
                  placeholder={t(
                    'brokers.thread.setup.datasetPlaceholder',
                    'Paste the network’s dataset (TLV hex)',
                  )}
                  onChange={(event) => {
                    setDataset(event.target.value);
                  }}
                />
              }
              className="items-start"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-thread/12 text-thread">
                <AppIcon id="link-2" size={16} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui font-medium text-foreground">
                  {t('brokers.thread.setup.join', 'Join an existing network')}
                </span>
                <span className="text-ui-sm leading-normal text-foreground-muted">
                  {t(
                    'brokers.thread.setup.joinLine',
                    'Paste its dataset (TLV hex). The phone apps that made it show it under their Thread settings, or another border router’s page does.',
                  )}
                </span>
              </span>
            </ChoiceCard>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-4 py-1">
            <TickingSteps
              steps={steps.map((each) => ({
                id: each.id,
                state: each.state,
                title:
                  each.id === 'border-router'
                    ? t('brokers.thread.setup.stepBorder', 'Starting the border router')
                    : each.id === 'radio'
                      ? t('brokers.thread.setup.stepRadio', 'Radio answers')
                      : each.id === 'network'
                        ? t('brokers.thread.setup.stepNetwork', 'Network formed')
                        : t('brokers.thread.setup.stepMatter', 'Handed to Matter'),
                detail: each.message ?? '',
              }))}
            />
            {job?.error == null ? null : <Note tone="danger">{job.error}</Note>}
          </div>
        ) : null}

        {start.error === null ? null : <Note tone="danger">{toMessage(start.error)}</Note>}
      </div>
    </Modal>
  );
}

/**
 * One port a radio could be on, and what its firmware turned out to be.
 *
 * @param props - The port, whether it is chosen, and its check.
 * @param props.radio - The port.
 * @param props.isChosen - Whether it is chosen.
 * @param props.onSelect - Chooses it.
 * @param props.check - What its firmware is, once asked.
 * @param props.isChecking - Whether it is being asked.
 * @returns The card.
 */
function RadioChoice(props: {
  readonly radio: ThreadRadio;
  readonly isChosen: boolean;
  readonly onSelect: () => void;
  readonly check: Awaited<ReturnType<typeof checkThreadRadio>> | undefined;
  readonly isChecking: boolean;
}) {
  const { t } = useTranslation();
  const { radio, check } = props;

  return (
    <ChoiceCard
      isChosen={props.isChosen}
      onSelect={props.onSelect}
      className="items-start"
      trailing={
        radio.model === null ? t('brokers.thread.setup.notRadio', 'Not a radio') : undefined
      }
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-ui font-medium text-foreground">{radio.name}</span>
          {radio.model === null ? null : (
            <span className="inline-flex h-5.5 items-center gap-1 rounded-pill border border-thread/50 bg-thread/10 px-2 text-caption text-thread">
              <ThreadLogo width={11} height={11} />
              {t('brokers.thread.setup.threadRadio', 'Thread radio')}
            </span>
          )}
        </span>
        <span className="truncate font-mono text-mono-caption text-foreground-muted">
          {radio.path.replace(/^\/dev\/serial\/by-id\//u, '')}
        </span>
        {props.isChosen ? (
          props.isChecking ? (
            <span className="text-caption text-foreground-subtle">
              {t('brokers.thread.setup.checking', 'Checking its firmware…')}
            </span>
          ) : check?.firmware === 'openthread-rcp' ? (
            <span className="flex items-center gap-1.5 text-caption text-success">
              <AppIcon id="check" size={13} />
              {t('brokers.thread.setup.rcpOk', 'OpenThread RCP · {{version}} · ok', {
                version: check.version ?? '',
              })}
            </span>
          ) : check?.firmware === 'unknown' ? (
            <span className="text-caption text-warning">
              {check.error ?? t('brokers.thread.setup.unknown', 'Its firmware could not be asked')}
            </span>
          ) : null
        ) : null}
      </span>
    </ChoiceCard>
  );
}

/** What Settings needs. */
export type ThreadSettingsDialogProps = {
  readonly status: ThreadStatus;
  readonly onClose: () => void;
};

/**
 * Renders Settings.
 *
 * @param props - See {@link ThreadSettingsDialogProps}.
 * @returns The dialog.
 */
export function ThreadSettingsDialog(props: ThreadSettingsDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { status, onClose } = props;
  const [name, setName] = useState(status.network?.name ?? '');
  const [channel, setChannel] = useState(status.network?.channel ?? 15);
  const [useForMatter, setUseForMatter] = useState(status.useForMatter);
  const [dataset, setDataset] = useState('');
  const [confirming, setConfirming] = useState<'join' | 'remove' | null>(null);

  /** Reads Thread again. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['brokers'] });
  };

  const save = useMutation({
    /**
     * Saves what changed.
     *
     * @returns Where Thread stands.
     */
    mutationFn: async () =>
      saveThreadSettings({
        ...(name.trim() === status.network?.name ? {} : { name: name.trim() }),
        ...(channel === status.network?.channel ? {} : { channel }),
        ...(useForMatter === status.useForMatter ? {} : { useForMatter }),
      }),

    /** Reads it again and closes. */
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const join = useMutation({
    /**
     * Leaves for another network.
     *
     * @returns Where Thread stands.
     */
    mutationFn: async () => joinThread(dataset.trim().toLowerCase()),

    /** Reads it again and closes. */
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const restart = useMutation({ mutationFn: restartThread, onSettled: refresh });
  const remove = useMutation({
    mutationFn: removeThread,

    /** Reads it again and closes. */
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const group = 'font-mono text-label text-foreground-subtle uppercase';
  const row = 'flex flex-wrap items-center justify-between gap-3 py-3';
  const isDatasetValid = /^(?:[0-9a-fA-F]{2})+$/u.test(dataset.trim());

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        size="large"
        layout="card"
        lead={<BrokerMark broker="thread" size={44} isLit />}
        title={t('brokers.thread.settings.title', 'Thread settings')}
        description={status.network?.name}
        footer={
          <>
            <span />
            <span className="flex items-center gap-2">
              <Button variant="bare" onClick={onClose}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                disabled={name.trim() === ''}
                isBusy={save.isPending}
                onClick={() => {
                  save.mutate();
                }}
              >
                {t('brokers.thread.settings.save', 'Save')}
              </Button>
            </span>
          </>
        }
      >
        <div className="flex flex-col">
          <span className={group}>{t('brokers.thread.settings.network', 'Network')}</span>
          <div className={row}>
            <span className="text-ui font-medium text-foreground">
              {t('brokers.thread.setup.name', 'Name')}
            </span>
            <TextField
              label={t('brokers.thread.setup.name', 'Name')}
              isLabelHidden
              value={name}
              maxLength={16}
              className="w-65 font-mono"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          <div className={`${row} border-t border-border`}>
            <span className="text-ui font-medium text-foreground">
              {t('brokers.thread.setup.channel', 'Channel')}
            </span>
            <SelectField
              label={t('brokers.thread.setup.channel', 'Channel')}
              isLabelHidden
              className="w-40"
              value={String(channel)}
              onChange={(value) => {
                setChannel(Number(value));
              }}
              options={CHANNELS.map((each) => ({ value: String(each), label: String(each) }))}
            />
          </div>
          <span className={`${group} mt-4`}>
            {t('brokers.thread.settings.joinAnother', 'Join another network')}
          </span>
          <div className="flex flex-col items-start gap-2.5 py-3">
            <TextArea
              label={t('brokers.thread.setup.dataset', 'Dataset')}
              isLabelHidden
              rows={3}
              value={dataset}
              className="w-full font-mono text-mono-caption"
              placeholder={t(
                'brokers.thread.settings.datasetPlaceholder',
                'Paste the other network’s dataset (TLV hex)',
              )}
              onChange={(event) => {
                setDataset(event.target.value);
              }}
            />
            <button
              type="button"
              disabled={!isDatasetValid}
              onClick={() => {
                setConfirming('join');
              }}
              className="press inline-flex h-8 items-center rounded-pill border border-danger/50 px-3 text-ui-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              {t('brokers.thread.settings.join', 'Join')}
            </button>
          </div>
          <span className={`${group} mt-2`}>{t('brokers.thread.settings.matter', 'Matter')}</span>
          <div className={row}>
            <span className="flex flex-col gap-0.5">
              <span className="text-ui font-medium text-foreground">
                {t('brokers.thread.settings.useForMatter', 'Use this network for Matter')}
              </span>
              <span className="text-ui-sm text-foreground-muted">
                {t(
                  'brokers.thread.settings.useForMatterLine',
                  'New Matter devices paired over Bluetooth join this network.',
                )}
              </span>
            </span>
            <Switch
              label={t('brokers.thread.settings.useForMatter', 'Use this network for Matter')}
              isOn={useForMatter}
              onChange={setUseForMatter}
            />
          </div>
          <span className={`${group} mt-4`}>
            {t('brokers.thread.borderRouter', 'Border router')}
          </span>
          {status.mode === 'local' ? (
            <div className={row}>
              <span className="flex flex-col gap-0.5">
                <span className="text-ui font-medium text-foreground">
                  {t('brokers.thread.restart', 'Restart')}
                </span>
                <span className="text-ui-sm text-foreground-muted">
                  {t(
                    'brokers.thread.settings.restartLine',
                    'Thread devices keep their network; routes come back in a few seconds.',
                  )}
                </span>
              </span>
              <Button
                variant="ghost"
                size="compact"
                isBusy={restart.isPending}
                onClick={() => {
                  restart.mutate();
                }}
              >
                <AppIcon id="rotate-ccw" size={14} />
                {t('brokers.thread.restart', 'Restart')}
              </Button>
            </div>
          ) : null}
          <div className={`${row} border-t border-border`}>
            <span className="flex max-w-110 flex-col gap-0.5">
              <span className="text-ui font-medium text-foreground">
                {t('brokers.thread.settings.remove', 'Remove border router')}
              </span>
              <span className="text-ui-sm text-foreground-muted">
                {t(
                  'brokers.thread.settings.removeLine',
                  'Thread devices lose their way to the house until another border router of the same network is around.',
                )}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setConfirming('remove');
              }}
              className="press inline-flex h-8 items-center gap-1.5 rounded-pill border border-danger/50 px-3 text-ui-sm font-medium text-danger hover:bg-danger/10"
            >
              <AppIcon id="trash-2" size={14} />
              {t('brokers.thread.settings.removeShort', 'Remove')}
            </button>
          </div>
          {[save.error, restart.error].map((error) =>
            error === null ? null : (
              <Note key={toMessage(error)} tone="danger">
                {toMessage(error)}
              </Note>
            ),
          )}
        </div>
      </Modal>
      <Modal
        isOpen={confirming !== null}
        onClose={() => {
          setConfirming(null);
        }}
        size="small"
        title={
          confirming === 'join'
            ? t('brokers.thread.settings.joinTitle', 'Join another network?')
            : t('brokers.thread.settings.removeTitle', 'Remove the border router?')
        }
        description={
          confirming === 'join'
            ? t(
                'brokers.thread.settings.joinLine',
                'Devices on the current network stay on it and must be paired again to follow.',
              )
            : t(
                'brokers.thread.settings.removeLine',
                'Thread devices lose their way to the house until another border router of the same network is around.',
              )
        }
        footer={
          <>
            <Button
              variant="bare"
              onClick={() => {
                setConfirming(null);
              }}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="danger"
              isBusy={join.isPending || remove.isPending}
              onClick={() => {
                if (confirming === 'join') {
                  join.mutate();
                } else {
                  remove.mutate();
                }
              }}
            >
              {confirming === 'join'
                ? t('brokers.thread.settings.join', 'Join')
                : t('brokers.thread.settings.removeShort', 'Remove')}
            </Button>
          </>
        }
      >
        {[join.error, remove.error].map((error) =>
          error === null ? null : (
            <Note key={toMessage(error)} tone="danger">
              {toMessage(error)}
            </Note>
          ),
        )}
      </Modal>
    </>
  );
}

/**
 * How to fix the host's IPv6 settings: the two settings to write, and Check again.
 *
 * @param props - Where Thread stands, and how the dialog closes.
 * @param props.status - Where Thread stands.
 * @param props.onClose - Closes it.
 * @returns The dialog.
 */
export function Ipv6FixDialog(props: {
  readonly status: ThreadStatus;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { status } = props;
  const code = status.ipv6.fixes.map((fix) => `sudo sysctl -w ${fix.key}=${fix.wanted}`).join('\n');

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      size="large"
      layout="card"
      lead={<BrokerMark broker="thread" size={44} isLit />}
      title={t('brokers.thread.ipv6.title', 'Let the server reach Thread devices')}
      description={t('brokers.thread.ipv6.line', 'Two host settings')}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={props.onClose}>
              {t('common.close', 'Close')}
            </Button>
            <Button
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: THREAD_QUERY_KEYS.status });
              }}
            >
              <AppIcon id="refresh-cw" size={15} />
              {t('brokers.thread.ipv6.check', 'Check again')}
            </Button>
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-ui leading-normal text-foreground-muted">
          {t(
            'brokers.thread.ipv6.explain',
            'The border router announces a route to the Thread network. The host has to accept it, or the house cannot reach Thread devices. Set these on the host for its network interface (here {{iface}}):',
            { iface: status.ipv6.interface ?? '?' },
          )}
        </p>
        <Snippet code={code} />
        <p className="text-caption text-foreground-subtle">
          {t(
            'brokers.thread.ipv6.keep',
            'To keep them after a restart, put the same settings in /etc/sysctl.d/60-nebula-thread.conf.',
          )}
        </p>
      </div>
    </Modal>
  );
}

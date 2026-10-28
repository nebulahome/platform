/**
 * Adding a Matter device: new, or already in another app; the code; then the job.
 *
 * It opens on the choice: **New device** - one never set up, or reset, which this server pairs
 * over its Bluetooth and puts on Wi-Fi or this Thread network (disabled, with why and the way to
 * the Bluetooth page, when the server's adapter cannot connect) - or **Already in another app**,
 * the share-code path as it always was. A new device's code can be scanned from its QR code where
 * the browser gives a camera (not on plain HTTP); its job stops at Found when the device needs
 * Thread and Thread is not set up (a link to Thread's page), or needs Wi-Fi and none is saved (the
 * Wi-Fi fields, inline).
 *
 * Then one dialog with four faces. **The code** - one large field, an example of where a Matter code is
 * printed, and the footnote that it goes over the house's network only. **The job** -
 * its steps, and the picture of the device finding its way in; closed before the device joined the
 * fabric, it stops - as it does when the page is left with the dialog open - and once it joined it
 * goes on, opening the dialog again picking it up. **A test certificate** - the job stopped before the device
 * joined, asking whether to add it anyway. **A twin** - added, and it looks like a device the house
 * already reaches another way: the two side by side, why they match, and the offer to link them,
 * which opens that device's page to confirm.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import type {
  LinkReason,
  LinkSuggestionView,
  MatterCommissioning,
  MatterCommissionMode,
  MatterStatus,
} from '@nebulahome/contracts';
import { AppIcon, Button, cn, Modal, Note, TextField, WizardSteps } from '@nebulahome/ui';

import exampleQr from '@/assets/matter/example-qr.svg';
import { MatterLogo } from '@/components/brand-logos';
import { translate } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import {
  answerMatter,
  BROKER_QUERY_KEYS,
  cancelMatter,
  commissionMatter,
} from '@/library/brokers-api';
import {
  dismissLinkSuggestion,
  fetchSuggestionOfDevice,
  LINK_QUERY_KEYS,
} from '@/library/links-api';
import {
  cleanCode,
  isWholeCode,
  PairingCodeField,
} from '@/routes/library/broker-matter/code-field';
import {
  joinPhaseOf,
  JoinAnimation,
  StepList,
  stepsDone,
} from '@/routes/library/broker-matter/matter-steps';
import { ScanQrButton } from '@/routes/library/broker-matter/scan-qr';
import { ChoiceCard } from '@/routes/library/broker-parts';
import { BrokerMark } from '@/routes/library/brokers-page';
import { devicePath } from '@/routes/library/device/device-path';
import { TransportMark, useVendorsById, wayName } from '@/routes/library/transport-marks';
import { FALLBACK_COLOR } from '@/routes/library/vendor-card';

/** How many times the offer to link a device just added is looked for. */
const TWIN_READS = 5;

/** What the dialog needs. */
export type AddMatterDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;

  /** The fabric's last commissioning, as the page reads it. */
  readonly job: MatterCommissioning | null;

  /** Whether a new device can be paired over the server's Bluetooth, and why not. */
  readonly ble?: MatterStatus['ble'];
};

/**
 * Why a new device cannot be paired here, in words.
 *
 * @param reason - What the hub said.
 * @returns The words.
 */
function bleReasonOf(reason: NonNullable<MatterStatus['ble']>['reason']): string {
  switch (reason) {
    case 'adapter-off':
      return translate('brokers.matter.new.adapterOff', 'The server’s Bluetooth adapter is off.');
    case 'proxies-only':
      return translate(
        'brokers.matter.new.proxiesOnly',
        'Bluetooth proxies only listen: pairing needs this server’s own adapter.',
      );
    case 'desktop':
      return translate(
        'brokers.matter.new.desktop',
        'Docker Desktop passes no Bluetooth through to the server.',
      );
    case 'no-adapter':
    case null:
      return translate('brokers.matter.new.noAdapter', 'This server has no Bluetooth adapter.');
  }
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link AddMatterDialogProps}.
 * @returns The dialog.
 */
export function AddMatterDialog(props: AddMatterDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isOpen, onClose, job } = props;
  const [code, setCode] = useState('');
  const isBleAvailable = props.ble?.isAvailable === true;
  const [mode, setMode] = useState<MatterCommissionMode | null>(null);
  const [choice, setChoice] = useState<MatterCommissionMode>(isBleAvailable ? 'new' : 'shared');
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');

  // The job the dialog follows: the one it started, or one still under way when it opened.
  const [followed, setFollowed] = useState<string | null>(null);
  const shown =
    job !== null && (job.id === followed || job.state === 'running' || job.state === 'needs-answer')
      ? job
      : null;

  /** Reads the job again. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: BROKER_QUERY_KEYS.matterStatus });
  };

  const commission = useMutation({
    /**
     * Starts adding the device.
     *
     * @param pairingCode - The code.
     * @returns The job.
     */
    mutationFn: async (pairingCode: string) => commissionMatter(pairingCode, mode ?? 'shared'),

    /**
     * Follows the job.
     *
     * @param started - The job.
     */
    onSuccess: (started) => {
      setFollowed(started.id);
      setCode('');
      refresh();
    },
  });

  const answer = useMutation({
    /**
     * Answers the question the job stopped on: a test certificate, or the Wi-Fi a new device asks
     * for.
     *
     * @param isAccepted - Whether to go on.
     * @returns The job.
     */
    mutationFn: async (isAccepted: boolean) =>
      answerMatter(
        shown?.id ?? '',
        isAccepted,
        isAccepted && shown?.question === 'needs-wifi'
          ? { ssid: ssid.trim(), password, isSaved: true }
          : undefined,
      ),

    /** Reads the job again. */
    onSettled: refresh,
  });

  // The job closing stops: one whose device has not joined the fabric yet.
  const stoppable =
    shown !== null &&
    (shown.state === 'needs-answer' || (shown.state === 'running' && shown.nodeId === null))
      ? shown.id
      : null;
  const stopsOnLeave = useRef<string | null>(null);

  useEffect(() => {
    stopsOnLeave.current = isOpen ? stoppable : null;
  });
  useEffect(
    () => () => {
      // The job as the page is left, not as it was when the dialog mounted.
      const jobId = stopsOnLeave.current;

      if (jobId !== null) {
        void cancelMatter(jobId).catch(() => undefined);
      }
    },
    [],
  );

  /** Closes the dialog; a job whose device has not joined yet stops, one that has goes on. */
  const close = (): void => {
    if (stoppable !== null) {
      setFollowed(null);
      void cancelMatter(stoppable)
        .catch(() => undefined)
        .finally(refresh);
    }

    commission.reset();
    setMode(null);
    onClose();
  };

  if (shown === null && mode === null) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={close}
        size="form"
        layout="card"
        lead={<BrokerMark size={44} isLit />}
        title={t('brokers.matter.add.title', 'Add a Matter device')}
        description={t('brokers.matter.add.choiceLine', 'New, or already in another app?')}
        footer={
          <>
            <span />
            <span className="flex items-center gap-2">
              <Button variant="bare" onClick={close}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                onClick={() => {
                  setMode(choice);
                }}
              >
                {t('common.next', 'Next')}
              </Button>
            </span>
          </>
        }
      >
        <div role="radiogroup" className="flex flex-col gap-2.5">
          <ChoiceCard
            isChosen={choice === 'new'}
            isDisabled={!isBleAvailable}
            onSelect={() => {
              setChoice('new');
            }}
            className="items-start py-3.5"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-[#5b9dff]/12 text-[#5b9dff]">
              <AppIcon id="bluetooth" size={18} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-ui font-medium text-foreground">
                {t('brokers.matter.add.new', 'New device')}
              </span>
              <span className="text-ui-sm leading-normal text-foreground-muted">
                {t(
                  'brokers.matter.add.newLine',
                  'Never set up, or reset. This server pairs it over Bluetooth, then it joins Wi-Fi or Thread.',
                )}
              </span>
            </span>
          </ChoiceCard>
          {isBleAvailable ? null : (
            <p className="-mt-1 flex flex-wrap items-center gap-x-2 pl-12 text-caption text-foreground-muted">
              {bleReasonOf(props.ble?.reason ?? null)}
              <Link
                to="/brokers/bluetooth"
                className="font-medium text-primary hover:text-primary-hover"
              >
                {t('brokers.matter.add.openBluetooth', 'Open Bluetooth')}
              </Link>
            </p>
          )}
          <ChoiceCard
            isChosen={choice === 'shared'}
            onSelect={() => {
              setChoice('shared');
            }}
            className="items-start py-3.5"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-primary/12 text-primary">
              <AppIcon id="qr-code" size={18} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-ui font-medium text-foreground">
                {t('brokers.matter.add.shared', 'Already in another app')}
              </span>
              <span className="text-ui-sm leading-normal text-foreground-muted">
                {t(
                  'brokers.matter.add.sharedLine',
                  'In another home app: share a pairing code from there.',
                )}
              </span>
            </span>
          </ChoiceCard>
          <p className="mt-1 flex items-center gap-2 text-caption text-foreground-subtle">
            <AppIcon id="info" size={14} />
            {t(
              'brokers.matter.add.keepClose',
              'Keep the device within a few metres of the server while it pairs.',
            )}
          </p>
        </div>
      </Modal>
    );
  }

  if (shown === null && mode === 'new') {
    return (
      <Modal
        isOpen={isOpen}
        onClose={close}
        size="form"
        layout="card"
        lead={<BrokerMark size={44} isLit />}
        title={t('brokers.matter.new.title', 'Add a new device')}
        description={t('brokers.matter.new.line', 'Its setup code, from the device or its box')}
        closesOnBackdrop={code === ''}
        footer={
          <>
            <span />
            <span className="flex items-center gap-2">
              <Button
                variant="bare"
                onClick={() => {
                  setMode(null);
                }}
              >
                {t('common.back', 'Back')}
              </Button>
              <Button
                disabled={!isWholeCode(code)}
                isBusy={commission.isPending}
                onClick={() => {
                  commission.mutate(code);
                }}
              >
                {t('common.next', 'Next')}
              </Button>
            </span>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <WizardSteps
            layout="stacked"
            current={0}
            steps={[
              t('brokers.matter.new.code', 'Code'),
              t('brokers.matter.new.pairing', 'Pairing'),
              t('brokers.matter.new.done', 'Done'),
            ]}
          />
          <PairingCodeField
            value={code}
            onChange={setCode}
            onSubmit={() => {
              commission.mutate(cleanCode(code));
            }}
          />
          <ScanQrButton
            onCode={(scanned) => {
              setCode(cleanCode(scanned));
            }}
          />
          {commission.error === null ? null : (
            <Note tone="danger">{toMessage(commission.error)}</Note>
          )}
        </div>
      </Modal>
    );
  }

  if (shown === null) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={close}
        size="form"
        layout="card"
        lead={<BrokerMark size={44} isLit />}
        title={t('brokers.matter.add.title', 'Add a Matter device')}
        description={t(
          'brokers.matter.add.line',
          'Enter the device’s setup code to add it to your home',
        )}
        closesOnBackdrop={code === ''}
        footer={
          <>
            <span className="inline-flex items-center gap-2 text-caption text-foreground-subtle">
              <AppIcon id="network" size={14} />
              {t('brokers.matter.add.footnote', 'On your network only')}
            </span>
            <span className="flex items-center gap-2">
              <Button variant="bare" onClick={close}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                disabled={!isWholeCode(code)}
                isBusy={commission.isPending}
                onClick={() => {
                  commission.mutate(code);
                }}
              >
                <AppIcon id="plus" size={15} />
                {t('brokers.matter.addDevice', 'Add device')}
              </Button>
            </span>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <PairingCodeField
            value={code}
            onChange={setCode}
            onSubmit={() => {
              commission.mutate(cleanCode(code));
            }}
          />
          <div className="flex items-center gap-5 rounded-card border border-border bg-rail p-4">
            <div
              aria-hidden="true"
              className="flex shrink-0 flex-col items-center gap-2.5 rounded-card border border-border-strong bg-canvas px-4 pt-3.5 pb-3"
            >
              <span className="relative size-23">
                <span
                  className="absolute inset-0 bg-foreground opacity-90"
                  /* eslint-disable-next-line react/forbid-dom-props -- the picture is an asset's. */
                  style={{
                    maskImage: `url(${exampleQr})`,
                    WebkitMaskImage: `url(${exampleQr})`,
                    maskSize: 'contain',
                    maskMode: 'luminance',
                  }}
                />
                <span className="absolute inset-0 flex items-center justify-center">
                  {/* A ring of the card's ground round the mark keeps the code's dots off it. */}
                  <span className="flex rounded-field bg-canvas p-1.5 text-foreground">
                    <MatterLogo width={24} height={24} />
                  </span>
                </span>
              </span>
              <span className="font-mono text-ui tracking-wider text-foreground">
                3497-011-2332
              </span>
            </div>
            <span className="flex flex-col gap-1.5">
              <span className="text-ui font-medium text-foreground">
                {t('brokers.matter.add.where', 'Where to find the code')}
              </span>
              <span className="text-ui-sm leading-normal text-foreground-muted">
                {t(
                  'brokers.matter.add.whereLine',
                  'It is printed under the Matter QR code, on the device or its packaging. If the device is already set up in another app, that app can create a new code for it.',
                )}
              </span>
            </span>
          </div>
          {commission.error === null ? null : (
            <Note tone="danger">{toMessage(commission.error)}</Note>
          )}
        </div>
      </Modal>
    );
  }

  if (shown.state === 'succeeded' && shown.deviceId !== null) {
    return (
      <TwinOrDone
        isOpen={isOpen}
        onClose={close}
        job={shown}
        deviceId={shown.deviceId}
        onAnother={() => {
          setFollowed(null);
        }}
      />
    );
  }

  const isNew = shown.mode === 'new';
  const question = shown.state === 'needs-answer' ? (shown.question ?? 'test-certificate') : null;
  const isAsking = question === 'test-certificate';
  const product = shown.steps.find((step) => step.id === 'found')?.detail.product ?? null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      size="picker"
      layout="card"
      lead={<BrokerMark size={44} isLit />}
      title={
        question === 'needs-thread'
          ? t('brokers.matter.new.needsThreadTitle', 'This device uses Thread')
          : isAsking
            ? t('brokers.matter.adding.testTitle', 'This device has a test certificate')
            : shown.state === 'failed'
              ? t('brokers.matter.adding.failedTitle', 'The device was not added')
              : t('brokers.matter.adding.title', 'Adding the device')
      }
      description={
        isAsking
          ? t('brokers.matter.adding.paused', 'Paused before it joins the fabric')
          : product === null
            ? t('brokers.matter.adding.closeBy', 'Keep it powered and close by')
            : t(
                'brokers.matter.adding.productCloseBy',
                '{{product}} · keep it powered and close by',
                {
                  product,
                },
              )
      }
      footer={
        question === 'needs-thread' ? (
          <>
            <span />
            <span className="flex items-center gap-2">
              <Button
                variant="bare"
                isBusy={answer.isPending}
                onClick={() => {
                  answer.mutate(false);
                }}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Link
                to="/brokers/thread"
                onClick={close}
                className="press inline-flex h-control items-center gap-2 rounded-pill bg-primary px-4 text-ui font-medium text-primary-foreground"
              >
                {t('brokers.matter.new.setUpThread', 'Set up Thread')}
              </Link>
            </span>
          </>
        ) : question === 'needs-wifi' ? (
          <>
            <span />
            <span className="flex items-center gap-2">
              <Button
                variant="bare"
                isBusy={answer.isPending && !answer.variables}
                onClick={() => {
                  answer.mutate(false);
                }}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                disabled={ssid.trim() === ''}
                isBusy={answer.isPending && answer.variables}
                onClick={() => {
                  answer.mutate(true);
                }}
              >
                {t('brokers.matter.new.continue', 'Continue')}
              </Button>
            </span>
          </>
        ) : isAsking ? (
          <>
            <Button
              variant="bare"
              isBusy={answer.isPending && !answer.variables}
              onClick={() => {
                answer.mutate(false);
              }}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              isBusy={answer.isPending && answer.variables}
              onClick={() => {
                answer.mutate(true);
              }}
            >
              <AppIcon id="plus" size={15} />
              {t('brokers.matter.adding.addAnyway', 'Add it anyway')}
            </Button>
          </>
        ) : shown.state === 'failed' ? (
          <>
            <span />
            <span className="flex items-center gap-2">
              <Button variant="bare" onClick={close}>
                {t('common.close', 'Close')}
              </Button>
              <Button
                onClick={() => {
                  setFollowed(null);
                }}
              >
                {t('brokers.matter.adding.tryAgain', 'Try again')}
              </Button>
            </span>
          </>
        ) : (
          <>
            <span className="text-caption text-foreground-subtle">
              {stoppable === null
                ? t(
                    'brokers.matter.adding.carriesOn',
                    'You can close this: it carries on, and the device shows up when it is in.',
                  )
                : t(
                    'brokers.matter.adding.closeStops',
                    'Closing this now stops it; once it has joined the fabric it carries on.',
                  )}
            </span>
            <Button variant="ghost" onClick={close}>
              {t('common.close', 'Close')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {isNew ? (
          <WizardSteps
            layout="stacked"
            current={shown.state === 'succeeded' ? 2 : 1}
            steps={[
              t('brokers.matter.new.code', 'Code'),
              t('brokers.matter.new.pairing', 'Pairing'),
              t('brokers.matter.new.done', 'Done'),
            ]}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-7">
          <JoinAnimation phase={joinPhaseOf(shown)} done={stepsDone(shown)} />
          <div className="min-w-0 grow">
            <StepList job={shown} />
          </div>
        </div>
        {isAsking ? (
          <div className="flex gap-3 rounded-inner border border-warning/30 bg-warning/7 px-4 py-3.5">
            <AppIcon id="shield-alert" size={18} className="shrink-0 text-warning" />
            <span className="flex flex-col gap-1">
              <span className="text-ui font-medium text-foreground">
                {t('brokers.matter.adding.anyway', 'Add it anyway?')}
              </span>
              <span className="text-ui-sm leading-normal text-foreground-muted">
                {t(
                  'brokers.matter.adding.anywayLine',
                  'Its certificate is a test one: a development sample, or a device not certified yet. It can work well, but no one has checked it.',
                )}
              </span>
            </span>
          </div>
        ) : null}
        {question === 'needs-thread' ? (
          <Note tone="warning">
            {t(
              'brokers.matter.new.needsThread',
              'This device uses Thread. Set up Thread first, then add it again.',
            )}
          </Note>
        ) : null}
        {question === 'needs-wifi' ? (
          <div className="flex flex-col gap-3 rounded-card border border-border px-4 py-4">
            <span className="flex items-center gap-2 text-ui font-medium text-foreground">
              <AppIcon id="wifi" size={15} className="text-cyan" />
              {t('brokers.matter.new.whichWifi', 'Which Wi-Fi should it join?')}
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label={t('brokers.matter.new.ssid', 'Network name')}
                value={ssid}
                autoComplete="off"
                onChange={(event) => {
                  setSsid(event.target.value);
                }}
              />
              <TextField
                label={t('brokers.matter.new.password', 'Password')}
                type="password"
                value={password}
                autoComplete="new-password"
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            </div>
            <span className="text-caption text-foreground-subtle">
              {t(
                'brokers.matter.new.wifiSaved',
                'Saved for the next devices too, in Matter › Settings. Most devices need a 2.4 GHz network.',
              )}
            </span>
          </div>
        ) : null}
        {shown.state === 'failed' && shown.error !== null ? (
          <Note tone="danger">{shown.error}</Note>
        ) : null}

        {answer.error === null ? null : <Note tone="danger">{toMessage(answer.error)}</Note>}
      </div>
    </Modal>
  );
}

/** What the last face needs. */
type TwinOrDoneProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly job: MatterCommissioning;
  readonly deviceId: string;

  /** Starts over, for another device. */
  readonly onAnother: () => void;
};

/**
 * The job done: a twin found, offered to link; or the device simply in.
 *
 * @param props - See {@link TwinOrDoneProps}.
 * @returns The dialog.
 */
function TwinOrDone(props: TwinOrDoneProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isOpen, onClose, job, deviceId, onAnother } = props;
  const suggestion = useQuery<LinkSuggestionView | null>({
    queryKey: [...LINK_QUERY_KEYS.suggestionOf, deviceId],

    /**
     * Reads it again a few times: the offer is made just after the device is in the house.
     *
     * @param query - The query, with what it read last.
     * @returns How soon to read it again, or false once found or given up.
     */
    refetchInterval: (query) =>
      query.state.data === null && query.state.dataUpdateCount < TWIN_READS ? 2000 : false,

    /**
     * Reads the offer to link the device just added.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The suggestion, or null.
     */
    queryFn: async ({ signal }) => fetchSuggestionOfDevice(deviceId, signal),
  });
  const keep = useMutation({
    /**
     * Keeps the two apart: the offer is set aside.
     *
     * @param id - The suggestion.
     * @returns Once set aside.
     */
    mutationFn: async (id: string) => dismissLinkSuggestion(id, true),

    /** Closes the dialog. */
    onSuccess: onClose,
  });
  const twin = suggestion.data ?? null;

  if (twin === null) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="picker"
        layout="card"
        lead={<BrokerMark size={44} isLit />}
        title={t('brokers.matter.adding.doneTitle', 'Added')}
        description={t(
          'brokers.matter.adding.doneLine',
          'The device is on the fabric and in the house',
        )}
        footer={
          <>
            <Button variant="ghost" onClick={onAnother}>
              {t('brokers.matter.adding.another', 'Add another')}
            </Button>
            <Button
              onClick={() => {
                onClose();
                void navigate(devicePath(deviceId));
              }}
            >
              {t('brokers.matter.adding.open', 'Open the device')}
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-7">
          <JoinAnimation phase="done" done={stepsDone(job)} />
          <div className="min-w-0 grow">
            <StepList job={job} />
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <TwinDialog
      isOpen={isOpen}
      onClose={onClose}
      suggestion={twin}
      isKeeping={keep.isPending}
      onKeep={() => {
        keep.mutate(twin.id);
      }}
      onLink={() => {
        onClose();
        void navigate(`${devicePath(twin.device.id)}?link=${encodeURIComponent(twin.twin.id)}`);
      }}
    />
  );
}

/** What the twin's face needs. */
type TwinDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly suggestion: LinkSuggestionView;
  readonly isKeeping: boolean;
  readonly onKeep: () => void;
  readonly onLink: () => void;
};

/**
 * Says what matched, in a sentence a person reads.
 *
 * @returns What says it, for one thing that matched.
 */
function useReasonLine(): (reason: LinkReason) => string {
  const { t } = useTranslation();

  return (reason) =>
    reason.kind === 'mac'
      ? t('brokers.matter.twin.sameMac', 'Same MAC address · {{value}}', {
          value: reason.value.toUpperCase(),
        })
      : reason.kind === 'serial'
        ? t('brokers.matter.twin.sameSerial', 'Same serial number')
        : t('brokers.matter.twin.sameModel', 'Same model, {{value}}', { value: reason.value });
}

/**
 * The twin found: the device the house has, the one just added, why they match, and the offer.
 *
 * @param props - See {@link TwinDialogProps}.
 * @returns The dialog.
 */
export function TwinDialog(props: TwinDialogProps) {
  const { t } = useTranslation();
  const { isOpen, onClose, suggestion, isKeeping, onKeep, onLink } = props;
  const vendors = useVendorsById();
  const reasonLine = useReasonLine();
  const matter = t('library.matterTag', 'Matter');
  const { device, twin } = suggestion;
  const through = wayName(device, vendors, matter);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="wide"
      layout="card"
      lead={<BrokerMark size={44} isLit />}
      title={t('brokers.matter.twin.title', 'Added, and it is one you have')}
      description={t('brokers.matter.twin.line', 'Matter found a twin')}
      footer={
        <>
          <Button variant="bare" isBusy={isKeeping} onClick={onKeep}>
            {t('brokers.matter.twin.keep', 'Keep them separate')}
          </Button>
          <Button onClick={onLink}>
            <AppIcon id="link-2" size={15} />
            {t('brokers.matter.twin.link', 'Link them…')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <span className="flex items-center gap-2.5 text-ui text-success">
          <AppIcon id="circle-check" size={18} />
          {t('brokers.matter.twin.onFabric', '{{product}} is on the fabric.', {
            product: twin.model ?? twin.name,
          })}
        </span>
        <p className="text-title leading-normal text-foreground">
          <Trans
            i18nKey="brokers.matter.twin.looksLike"
            defaults="It looks like <0>{{name}}</0>, which the house already reaches through {{through}}. Link them, and it becomes one device with two ways in: if one is down, the other carries on."
            values={{ name: device.name, through }}
            components={[<b key="name" className="font-medium" />]}
          />
        </p>
        <div className="flex items-center">
          <TwinCard
            name={device.name}
            chip={through}
            way={device}
            vendors={vendors}
            isNew={false}
          />
          <span
            aria-hidden="true"
            className="relative h-0.5 w-16 shrink-0"
            /* eslint-disable-next-line react/forbid-dom-props -- from the vendor's own colour. */
            style={{
              backgroundImage: `linear-gradient(90deg, ${vendors.get(device.vendorId)?.color ?? FALLBACK_COLOR}, var(--color-violet))`,
            }}
          >
            <span className="link-glow absolute top-1/2 left-1/2 flex size-8.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary/60 bg-surface text-primary">
              <AppIcon id="link-2" size={16} />
            </span>
          </span>
          <TwinCard
            name={twin.model ?? twin.name}
            chip={t('brokers.matter.twin.justAdded', '{{way}} · just added', {
              way: wayName(twin, vendors, matter),
            })}
            way={twin}
            vendors={vendors}
            isNew
          />
        </div>
        <ul className="flex flex-col gap-2 rounded-inner border border-border bg-rail px-4 py-3.5">
          {suggestion.reasons.map((reason) => (
            <li
              key={reason.kind}
              className="flex items-center gap-2.5 text-ui-sm text-foreground-muted"
            >
              <AppIcon id="check" size={14} className="text-success" />
              {reasonLine(reason)}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

/** One device of the two. */
type TwinCardProps = {
  readonly name: string;
  readonly chip: string;
  readonly way: { readonly vendorId: string; readonly transport: string };
  readonly vendors: ReturnType<typeof useVendorsById>;
  readonly isNew: boolean;
};

/**
 * One of the two devices that look like one.
 *
 * @param props - See {@link TwinCardProps}.
 * @returns The card.
 */
function TwinCard(props: TwinCardProps) {
  const { name, chip, way, vendors, isNew } = props;

  return (
    <div
      className={cn(
        'flex min-w-0 grow basis-0 items-center gap-3 rounded-card border p-3.5',
        isNew ? 'border-violet/45 bg-violet/7' : 'border-border bg-rail',
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-tile bg-surface-raised text-foreground-muted">
        <AppIcon id="plug" size={20} />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-ui font-medium text-foreground">{name}</span>
        <span className="inline-flex h-6 w-fit items-center gap-1.5 rounded-pill border border-border-strong bg-surface-raised pr-2.25 pl-1 text-label tracking-normal whitespace-nowrap text-foreground-muted">
          <TransportMark way={way} vendors={vendors} />
          {chip}
        </span>
      </span>
    </div>
  );
}

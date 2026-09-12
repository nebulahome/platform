/**
 * Finding a device and adopting it.
 *
 * A pass is asked of one integration instance, or of every running one, and runs on the hub for
 * half a minute while this dialog reads what it has found every second or two. Each candidate is
 * shown with the entities it would produce - "adopt this and find out" being a poor offer for
 * something automations will then refer to - and adopting one is a click. What the click writes
 * is written by `core`, which then publishes the device event; the page behind this dialog hears
 * that on the live channel and reads its lists again, so the new row is there when the dialog
 * shuts.
 *
 * Nothing found is a real answer and is said as one: the pass ran, and this instance saw nothing
 * it recognised. For a printer that means it is off, not in LAN mode, or not reporting on the
 * topic the bundle listens to; the wording points there rather than at the button.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { DeviceCandidateView, IntegrationView } from '@nebula-home/contracts';
import { Badge, Button, Modal, SelectField } from '@nebula-home/ui';

import { CheckIcon } from '@/components/icons';
import { toMessage } from '@/lib/error-message';
import {
  adoptCandidate,
  fetchCandidates,
  fetchIntegrations,
  LIBRARY_QUERY_KEYS,
  startDiscovery,
} from '@/library/api';

/** How long a pass runs. */
const PASS_MS = 30_000;

/** How often what it has found is read while it runs. */
const POLL_MS = 1500;

/** What the dialog needs. */
export type DiscoverDialogProps = {
  /** Whether it is shown. */
  readonly isOpen: boolean;

  /** Called to shut it. */
  readonly onClose: () => void;
};

/**
 * The instances a pass can be asked of, as options.
 *
 * @param integrations - Every configured instance.
 * @returns One option per instance, the ones not running marked as such.
 */
function instanceOptions(integrations: readonly IntegrationView[]) {
  return [
    { value: '', label: 'Every running integration' },
    ...integrations.map((integration) => ({
      value: integration.id,
      label:
        integration.state === 'running'
          ? integration.id
          : `${integration.id} (${integration.state})`,
    })),
  ];
}

/**
 * Renders one candidate, with what adopting it would produce.
 *
 * @param props - The candidate and what to do with it.
 * @param props.candidate - The candidate.
 * @param props.isAdopted - Whether it has been adopted from this dialog already.
 * @param props.isBusy - Whether an adoption is in flight.
 * @param props.onAdopt - Called to adopt it.
 * @returns The row.
 */
function CandidateRow(props: {
  readonly candidate: DeviceCandidateView;
  readonly isAdopted: boolean;
  readonly isBusy: boolean;
  readonly onAdopt: () => void;
}) {
  const { candidate, isAdopted, isBusy, onAdopt } = props;

  return (
    <li className="flex flex-col gap-2 rounded-field border border-border bg-surface px-3.5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <span className="text-title font-medium text-foreground">{candidate.name}</span>
          <span className="truncate text-caption text-foreground-subtle">
            {[candidate.manufacturer, candidate.model].filter(Boolean).join(' ')}
            {candidate.manufacturer === undefined && candidate.model === undefined ? '' : ' · '}
            <span className="font-mono">{candidate.integrationId}</span> ·{' '}
            <span className="font-mono">{candidate.externalId}</span>
          </span>
        </div>

        {isAdopted ? (
          <Badge tone="success" icon={<CheckIcon width="12" height="12" />}>
            Adopted
          </Badge>
        ) : (
          <Button size="compact" isBusy={isBusy} disabled={isBusy} onClick={onAdopt}>
            Adopt
          </Button>
        )}
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {candidate.entities.map((entity) => (
          <li key={entity.entityId}>
            <Badge tone="neutral" size="small" className="font-mono">
              {entity.entityId}
            </Badge>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * Renders the dialog.
 *
 * Mounted fresh each time it opens - the page gives it a key - so a pass from last time is not
 * still showing when it opens again.
 *
 * @param props - See {@link DiscoverDialogProps}.
 * @returns The dialog.
 */
export function DiscoverDialog(props: DiscoverDialogProps) {
  const { isOpen, onClose } = props;
  const queryClient = useQueryClient();
  const [integrationId, setIntegrationId] = useState('');
  const [scanId, setScanId] = useState<string | null>(null);

  // Kept here once adopted, because the hub lets go of a candidate the moment it is written and
  // the next read of the pass no longer has it. The row stays, marked, so what was just done is
  // still on the screen it was done from.
  const [adopted, setAdopted] = useState<ReadonlyMap<string, DeviceCandidateView>>(new Map());

  const integrations = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.integrations,
    enabled: isOpen,

    /**
     * Reads every instance, so one can be chosen to look with.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the dialog goes away.
     * @returns The instances.
     */
    queryFn: async ({ signal }) => fetchIntegrations(signal),
  });

  const candidates = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.candidates, scanId],
    enabled: isOpen && scanId !== null,

    /**
     * Reads what the pass has found so far.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the dialog goes away.
     * @returns The candidates, and whether the pass is still running.
     */
    queryFn: async ({ signal }) => fetchCandidates(signal),

    /**
     * Keeps reading while the pass runs, and stops when it ends.
     *
     * @param query - The query, whose last answer says whether the pass is still running.
     * @returns The interval, or false once the pass has ended.
     */
    refetchInterval: (query) => (query.state.data?.isScanning === false ? false : POLL_MS),
  });

  const scan = useMutation({
    /**
     * Starts a pass.
     *
     * @returns The pass identifier.
     */
    mutationFn: async () =>
      startDiscovery({
        ...(integrationId === '' ? {} : { integrationId }),
        timeoutMs: PASS_MS,
      }),

    /**
     * Follows the pass that started.
     *
     * @param reply - The pass identifier and who is looking.
     */
    onSuccess: (reply): void => {
      setAdopted(new Map());
      setScanId(reply.scanId);
    },
  });

  const adopt = useMutation({
    /**
     * Adopts one candidate.
     *
     * @param candidate - Which one.
     * @returns The candidate, with what was written.
     */
    mutationFn: async (candidate: DeviceCandidateView) => ({
      candidate,
      ...(await adoptCandidate({ candidateId: candidate.candidateId })),
    }),

    /**
     * Keeps the candidate as adopted and has the page read its lists again.
     *
     * @param written - Which candidate it was; the page reads the row back for itself.
     */
    onSuccess: (written): void => {
      setAdopted(
        (current) => new Map([...current, [written.candidate.candidateId, written.candidate]]),
      );
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities });
    },
  });

  const found = [
    ...adopted.values(),
    ...(candidates.data?.candidates ?? []).filter(
      (candidate) => !adopted.has(candidate.candidateId),
    ),
  ];
  const isScanning = scanId !== null && candidates.data?.isScanning !== false;
  const error = scan.error ?? adopt.error ?? candidates.error ?? integrations.error;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add a device"
      description="An integration looks for what it can reach. Adopt what it finds, and the entities follow."
      footer={
        <Button variant="ghost" onClick={onClose}>
          {adopted.size > 0 ? 'Done' : 'Cancel'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-2.5">
          <SelectField
            label="Look with"
            size="medium"
            className="grow"
            options={instanceOptions(integrations.data ?? [])}
            value={integrationId}
            disabled={isScanning}
            onChange={setIntegrationId}
          />
          <Button
            isBusy={scan.isPending}
            disabled={scan.isPending || isScanning}
            onClick={() => {
              scan.mutate();
            }}
          >
            {scanId === null ? 'Scan' : 'Scan again'}
          </Button>
        </div>

        {scanId === null ? (
          <p className="text-caption text-foreground-subtle">
            A pass runs for {String(PASS_MS / 1000)} seconds. A printer has to be on and in LAN mode
            to be found; a relay has to answer at the address its integration was given.
          </p>
        ) : (
          <p role="status" className="text-caption text-foreground-subtle">
            {isScanning
              ? `Looking… ${String(found.length)} found so far.`
              : found.length === 0
                ? 'The pass ended and nothing answered. Check the device is on, reachable, and in the mode its integration expects.'
                : `The pass ended. ${String(found.length)} found.`}
          </p>
        )}

        {found.length === 0 ? null : (
          <ul className="flex flex-col gap-2">
            {found.map((candidate) => (
              <CandidateRow
                key={candidate.candidateId}
                candidate={candidate}
                isAdopted={adopted.has(candidate.candidateId)}
                isBusy={adopt.isPending && adopt.variables.candidateId === candidate.candidateId}
                onAdopt={() => {
                  adopt.mutate(candidate);
                }}
              />
            ))}
          </ul>
        )}

        {error === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {toMessage(error)}
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * The dashboard's "MQTT broker" card: how many clients are connected, and how busy it is.
 *
 * Small, the clients alone; wide, the messages a second beside them. The interface draws the
 * card's frame; this draws what is inside it.
 */
import { usePackageRpc, type PackageCardProps } from '@nebula-home/package-ui';

import type { BrokerStatus } from './types.js';

/** How often the card reads the broker again. */
const REFRESH_MS = 5000;

/**
 * One figure with its word under it.
 *
 * @param props - The figure and the word.
 * @param props.value - The figure.
 * @param props.label - The word.
 * @returns The figure.
 */
function Figure(props: { readonly value: string; readonly label: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-headline font-semibold tracking-tight text-foreground tabular">
        {props.value}
      </span>
      <span className="truncate text-caption text-foreground-subtle">{props.label}</span>
    </span>
  );
}

/**
 * Renders the card.
 *
 * @param props - What the interface draws it with.
 * @returns The card's inside.
 */
export function BrokerCard(props: PackageCardProps) {
  const status = usePackageRpc<BrokerStatus>('status', null, { refetchIntervalMs: REFRESH_MS });
  const found = status.data;

  return (
    <div className="flex h-full min-w-0 flex-col justify-between gap-2">
      <span className="truncate text-caption font-medium text-foreground-muted">
        {props.title ?? 'MQTT broker'}
      </span>
      {found === undefined ? (
        <span className="text-caption text-foreground-subtle">
          {status.error === null ? 'Reading…' : 'The broker does not answer.'}
        </span>
      ) : (
        <span className="flex items-end gap-6">
          <Figure
            value={String(found.clientsOnline)}
            label={found.clientsOnline === 1 ? 'client' : 'clients'}
          />
          {props.size === 'small' ? null : (
            <Figure value={found.messagesPerSecond.toFixed(1)} label="messages a second" />
          )}
        </span>
      )}
    </div>
  );
}

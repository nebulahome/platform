/**
 * The broker's page: where it stands and how to reach it, who may connect, what discovery made
 * of the announcements, the topics mapped by hand, and the topics themselves.
 *
 * The address a device connects to is the one this page was opened on: the house's own, on the
 * network the device is on too.
 */
import { useState } from 'react';

import { usePackageRpc, type PackagePageProps } from '@nebulahome/package-ui';
import { Badge, Button, Panel, PanelNote, PanelRow } from '@nebulahome/ui';

import { ClientsPanel } from './clients-panel.js';
import { MappingsPanel } from './mappings-panel.js';
import { TopicsPanel } from './topics-panel.js';
import { ago, copy, type BrokerStatus } from './types.js';

/** How often the status is read again. */
const REFRESH_MS = 5000;

/**
 * A figure with its noun under it, as the package page's header has them.
 *
 * @param props - The figure and its noun.
 * @param props.value - The figure.
 * @param props.label - The noun.
 * @returns The figure.
 */
function Figure(props: { readonly value: string; readonly label: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-headline font-semibold tracking-tight text-foreground tabular">
        {props.value}
      </span>
      <span className="text-caption text-foreground-subtle">{props.label}</span>
    </span>
  );
}

/**
 * How to reach the broker, with a line to try it.
 *
 * @param props - The status.
 * @param props.status - It.
 * @returns The panel.
 */
function ConnectionPanel(props: { readonly status: BrokerStatus }) {
  const { status } = props;
  const host = globalThis.location.hostname;
  const example = `mosquitto_pub -h ${host} -p ${String(status.port)} -u <username> -P <password> -t <username>/hello -m hi`;
  const [isCopied, setCopied] = useState(false);

  return (
    <Panel title="Connecting">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4 px-4 py-4">
        <Figure value={String(status.clientsOnline)} label="clients online" />
        <Figure value={status.messagesPerSecond.toFixed(1)} label="messages a second" />
        <dl className="grid min-w-0 grow grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui">
          <dt className="text-foreground-subtle">Host</dt>
          <dd className="font-mono break-all">{host}</dd>
          <dt className="text-foreground-subtle">Port</dt>
          <dd className="font-mono">{status.port}</dd>
          <dt className="text-foreground-subtle">Without a username</dt>
          <dd>{status.allowAnonymous ? 'Allowed' : 'Refused'}</dd>
          <dt className="text-foreground-subtle">Running</dt>
          <dd>since {ago(status.startedAt)}</dd>
        </dl>
      </div>
      <div className="flex items-center gap-3 border-t border-border-soft px-4 py-3">
        <code className="min-w-0 grow truncate font-mono text-caption text-foreground-muted">
          {example}
        </code>
        <Button
          variant="ghost"
          size="compact"
          onClick={() => {
            void copy(example).then(setCopied);
          }}
        >
          {isCopied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </Panel>
  );
}

/**
 * What discovery made of the announcements.
 *
 * @param props - The status.
 * @param props.status - It.
 * @returns The panel.
 */
function DiscoveryPanel(props: { readonly status: BrokerStatus }) {
  const { discovery } = props.status;

  return (
    <Panel title="Home Assistant discovery">
      <PanelRow
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono">{discovery.prefix}/</span>
            <Badge tone={discovery.isEnabled ? 'success' : 'neutral'} size="small">
              {discovery.isEnabled ? 'Listening' : 'Off'}
            </Badge>
          </span>
        }
        note={`${String(discovery.devices)} devices · ${String(discovery.discovered)} entities announced · ${String(discovery.mapped)} mapped by hand`}
      />
      {discovery.skipped.map((skipped) => (
        <PanelRow
          key={skipped.topic}
          title={<span className="font-mono text-ui">{skipped.topic}</span>}
          note={skipped.reason}
        />
      ))}
      {discovery.isEnabled ? null : (
        <PanelNote>Discovery is off: turn it on from Configure.</PanelNote>
      )}
    </Panel>
  );
}

/**
 * Renders the page.
 *
 * @param props - Whose.
 * @returns The page.
 */
export function BrokerPage(props: PackagePageProps) {
  const status = usePackageRpc<BrokerStatus>('status', null, { refetchIntervalMs: REFRESH_MS });
  const found = status.data;

  if (found === undefined) {
    return (
      <p role="status" className="text-ui text-foreground-subtle">
        {status.error === null
          ? `Reading the ${props.packageId} broker…`
          : `The broker does not answer: ${status.error.message}`}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ConnectionPanel status={found} />
      <ClientsPanel port={found.port} />
      <DiscoveryPanel status={found} />
      <MappingsPanel />
      <TopicsPanel />
    </div>
  );
}

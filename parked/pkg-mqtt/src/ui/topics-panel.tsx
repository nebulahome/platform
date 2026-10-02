/**
 * The topic explorer: every topic the broker carried since it started, the most recent first,
 * each with its last message - narrowed by what it starts with, read again every few seconds.
 */
import { useState } from 'react';

import { usePackageRpc } from '@nebulahome/package-ui';
import { Badge, Panel, PanelNote, TextField } from '@nebulahome/ui';

import { ago, type TopicsReply } from './types.js';

/** How often the topics are read again. */
const REFRESH_MS = 3000;

/** How many are shown. */
const LIMIT = 200;

/**
 * Renders the explorer.
 *
 * @returns The panel.
 */
export function TopicsPanel() {
  const [prefix, setPrefix] = useState('');
  const topics = usePackageRpc<TopicsReply>(
    'topics',
    { prefix, limit: LIMIT },
    { refetchIntervalMs: REFRESH_MS },
  );
  const items = topics.data?.items ?? [];
  const total = topics.data?.total ?? 0;

  return (
    <Panel
      title={
        total > items.length
          ? `Topics · ${String(items.length)} of ${String(total)}`
          : `Topics · ${String(total)}`
      }
    >
      <div className="border-b border-border-soft px-4 py-3">
        <TextField
          label="Starting with"
          isLabelHidden
          size="compact"
          value={prefix}
          placeholder="Topics starting with… zigbee2mqtt/"
          onChange={(event) => {
            setPrefix(event.target.value);
          }}
        />
      </div>

      {items.length === 0 ? (
        <PanelNote>
          {topics.data === undefined
            ? 'Reading…'
            : prefix === ''
              ? 'Nothing published since the broker started.'
              : `Nothing under ${prefix}.`}
        </PanelNote>
      ) : (
        <ul className="flex max-h-[32rem] flex-col divide-y divide-border-soft overflow-y-auto">
          {items.map((entry) => (
            <li key={entry.topic} className="flex min-w-0 flex-col gap-1 px-4 py-2.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-ui text-foreground">{entry.topic}</span>
                {entry.isRetained ? (
                  <Badge tone="neutral" size="small">
                    Retained
                  </Badge>
                ) : null}
                <span className="grow" />
                <span className="shrink-0 text-caption text-foreground-subtle tabular">
                  {entry.count}× · {ago(entry.updatedAt)}
                </span>
              </span>
              <code className="line-clamp-3 font-mono text-caption break-all text-foreground-muted">
                {entry.payload === '' ? '(empty)' : entry.payload}
              </code>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

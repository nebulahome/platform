/**
 * The MQTT broker's Topics tab: the last message of every topic it carried since it started, the
 * most recent first, filtered by what a topic starts with - where to look when a device does not
 * do what it should.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Panel, PanelNote, TextField } from '@nebulahome/ui';

import { relativeTime } from '@/lib/format-time';
import { BROKER_QUERY_KEYS, fetchMqttTopics } from '@/library/brokers-api';

/** How often the topics are read again. */
const REFRESH_MS = 3000;

/** How many topics are shown. */
const LIMIT = 200;

/**
 * Renders the tab.
 *
 * @returns The tab's content.
 */
export function MqttTopics() {
  const { t } = useTranslation();
  const [prefix, setPrefix] = useState('');
  const topics = useQuery({
    queryKey: [...BROKER_QUERY_KEYS.mqttTopics, prefix],
    refetchInterval: REFRESH_MS,

    /**
     * Reads the topics under the prefix.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Them, and how many there are.
     */
    queryFn: async ({ signal }) => fetchMqttTopics(prefix, LIMIT, signal),
  });
  const items = topics.data?.items ?? [];
  const total = topics.data?.total ?? 0;

  return (
    <Panel
      title={
        total > items.length
          ? t('brokers.mqtt.topicsSome', 'Topics · {{shown}} of {{total}}', {
              shown: items.length,
              total,
            })
          : t('brokers.mqtt.topicsAll', 'Topics · {{total}}', { total })
      }
    >
      <div className="border-b border-border px-4 py-3">
        <TextField
          label={t('brokers.mqtt.startingWith', 'Starting with')}
          isLabelHidden
          value={prefix}
          placeholder={t('brokers.mqtt.startingWithHint', 'Topics starting with… zigbee2mqtt/')}
          onChange={(event) => {
            setPrefix(event.target.value);
          }}
        />
      </div>

      {items.length === 0 ? (
        <PanelNote>
          {topics.data === undefined
            ? t('brokers.mqtt.reading', 'Reading…')
            : prefix === ''
              ? t('brokers.mqtt.noTopics', 'Nothing published since the broker started.')
              : t('brokers.mqtt.noTopicsUnder', 'Nothing under {{prefix}}.', { prefix })}
        </PanelNote>
      ) : (
        <ul className="flex max-h-[32rem] flex-col divide-y divide-border overflow-y-auto">
          {items.map((entry) => (
            <li key={entry.topic} className="flex min-w-0 flex-col gap-1 px-4 py-2.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-ui text-foreground">{entry.topic}</span>
                {entry.isRetained ? <Badge>{t('brokers.mqtt.retained', 'Retained')}</Badge> : null}
                <span className="grow" />
                <span className="shrink-0 text-caption text-foreground-subtle tabular">
                  {entry.count}× · {relativeTime(entry.updatedAt)}
                </span>
              </span>
              <code className="line-clamp-3 font-mono text-caption break-all text-foreground-muted">
                {entry.payload === '' ? t('brokers.mqtt.empty', '(empty)') : entry.payload}
              </code>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

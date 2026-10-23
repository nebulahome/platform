/**
 * Settings › Webhooks (boards N-Settings-Webhooks, N-Settings-Webhooks-Filter): where webhooks
 * are reached, the automations that have one, and every call their addresses received.
 *
 * The two settings - calls from the internet, the limit a minute - are saved as they are changed:
 * neither depends on the other, so there is no draft to judge. Webhooks are not rows of their own
 * but webhook triggers inside automations, so the list is read from those; a paused automation's
 * webhook is listed as paused, and answers 404. A call opens into what it carried and what it
 * started. Its body was never kept.
 */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  WEBHOOK_METHODS,
  type JsonValue,
  type SettingsResponse,
  type WebhookCall,
  type WebhookCallsQuery,
  type WebhookView,
} from '@nebulahome/contracts';
import {
  AppIcon,
  IconButton,
  Menu,
  Panel,
  PanelRow,
  Segmented,
  SelectField,
  Switch,
  cn,
  toast,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { ChoiceChips } from '@/components/choice-chips';
import { dateTimeFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';
import { copyText } from '@/lib/clipboard';
import { toMessage } from '@/lib/error-message';
import { absoluteTime, relativeTime, shortTime } from '@/lib/format-time';
import { METHOD_TONES } from '@/lib/http-methods';
import { fetchWebhookCalls, fetchWebhooks, LIBRARY_QUERY_KEYS } from '@/library/api';
import { webhookAddress } from '@/routes/library/automation/webhook-fields';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';
import { SETTINGS_QUERY_KEYS, fetchServerSettings, updateServerSettings } from '@/settings/api';

/** The limits a minute that can be chosen. */
const RATE_CHOICES = [10, 30, 60, 120, 300] as const;

/** The columns of the webhooks table. */
const HOOK_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_64px_96px_128px_40px_minmax(0,128px)_72px] items-center gap-3 px-5.5';

/** The columns of the calls table. */
const CALL_COLUMNS =
  'grid grid-cols-[80px_minmax(0,1fr)_minmax(0,128px)_88px_60px_60px_minmax(0,1fr)_16px] items-center gap-3 px-5.5';

/** A column heading. */
const HEADING = 'font-mono text-label text-foreground-subtle uppercase';

/** How the calls are narrowed. */
type CallFilter = {
  readonly since: WebhookCallsQuery['since'];
  readonly where: 'any' | 'local' | 'internet';
  readonly methods: readonly string[];
  readonly automationId: string;
};

/** Every call of the last day, from anywhere. */
const ANY_CALL: CallFilter = { since: '24h', where: 'any', methods: [], automationId: '' };

/**
 * The query string a filter asks the calls with.
 *
 * @param filter - The filter.
 * @param cursor - Where the page starts.
 * @returns The query.
 */
function callQuery(filter: CallFilter, cursor: string | undefined): string {
  return new URLSearchParams({
    since: filter.since,
    where: filter.where,
    limit: '20',
    ...(filter.methods.length === 0 ? {} : { methods: filter.methods.join(',') }),
    ...(filter.automationId === '' ? {} : { automationId: filter.automationId }),
    ...(cursor === undefined ? {} : { cursor }),
  }).toString();
}

/**
 * When a call was received, as its row says it: the time today, the day before.
 *
 * @param when - The moment.
 * @returns `14:32:08`, or `22 Oct, 14:32`.
 */
function callTime(when: Date): string {
  return when.toDateString() === new Date().toDateString()
    ? dateTimeFormat({ hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(when)
    : shortTime(when);
}

/**
 * What became of a call, in words.
 *
 * @param call - The call.
 * @param hook - Its webhook, when there still is one.
 * @param rate - The limit a minute now.
 * @returns The sentence.
 */
function whatHappened(call: WebhookCall, hook: WebhookView | undefined, rate: number): string {
  switch (call.outcome) {
    case 'started': {
      return translate('settings.webhooks.outcome.started', 'Run started');
    }
    case 'queued': {
      return translate('settings.webhooks.outcome.queued', 'Run queued');
    }
    case 'ignored': {
      return translate('settings.webhooks.outcome.ignored', 'Nothing started: already running');
    }
    case 'not_found': {
      return translate('settings.webhooks.outcome.notFound', 'Unknown address');
    }
    case 'local_only': {
      return translate('settings.webhooks.outcome.localOnly', 'Not reachable from the internet');
    }
    case 'wrong_method': {
      return hook === undefined || hook.method === 'any'
        ? translate('settings.webhooks.outcome.wrongMethod', 'Method not accepted')
        : translate('settings.webhooks.outcome.acceptsOnly', 'Accepts {{method}} only', {
            method: hook.method,
          });
    }
    case 'rate_limited': {
      return translate(
        'settings.webhooks.outcome.rateLimited',
        'Too many calls: {{rate}} a minute',
        {
          rate,
        },
      );
    }
  }
}

/**
 * The colour of an answer: green when it started something, amber when it was refused.
 *
 * @param status - The status.
 * @returns The text colour.
 */
function answerTone(status: number): string {
  if (status < 300) {
    return 'text-success';
  }

  return status < 500 ? 'text-warning' : 'text-danger';
}

/**
 * Renders Settings › Webhooks.
 *
 * @returns The page.
 */
export function WebhooksSettings() {
  const { t } = useTranslation();
  const canWrite = useSession((state) => state.can('settings:write'));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<CallFilter>(ANY_CALL);
  const [openCall, setOpenCall] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.server,

    /**
     * Reads the settings.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns Every setting.
     */
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchServerSettings(signal),
  });
  const webhooks = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.webhooks,

    /**
     * Reads the webhooks.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns Every webhook.
     */
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchWebhooks(signal),
  });
  const calls = useInfiniteQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.webhookCalls, filter],
    initialPageParam: undefined as string | undefined,

    /**
     * Reads one page of calls.
     *
     * @param context - The page's cursor and the abort signal.
     * @param context.pageParam - Where the page starts.
     * @param context.signal - Cancels the request.
     * @returns The page.
     */
    queryFn: ({ pageParam, signal }) => fetchWebhookCalls(callQuery(filter, pageParam), signal),

    /**
     * Says where the next page starts.
     *
     * @param last - The page just read.
     * @returns Its cursor, or undefined on the last page.
     */
    getNextPageParam: (last) => last.nextCursor,
  });

  const stored = new Map((settings.data?.items ?? []).map((item) => [item.key, item.value]));
  const allowInternet = stored.get('webhooks.allow_internet') !== false;
  const rateSetting = stored.get('webhooks.rate_per_minute');
  const rate = typeof rateSetting === 'number' ? rateSetting : 30;
  const hooks = webhooks.data ?? [];
  const hookOf = new Map(hooks.map((hook) => [hook.hookId, hook]));
  const automationNames = new Map(hooks.map((hook) => [hook.automationId, hook.automationName]));
  const facets =
    (filter.since === ANY_CALL.since ? 0 : 1) +
    (filter.where === 'any' ? 0 : 1) +
    (filter.methods.length === 0 ? 0 : 1) +
    (filter.automationId === '' ? 0 : 1);

  /**
   * Saves one setting, and shows what the server now holds.
   *
   * @param key - Which.
   * @param value - Its new value.
   */
  const save = (key: string, value: JsonValue): void => {
    void (async (): Promise<void> => {
      try {
        queryClient.setQueryData<SettingsResponse>(
          SETTINGS_QUERY_KEYS.server,
          await updateServerSettings({ [key]: value }),
        );
      } catch (cause: unknown) {
        toast.error({
          title: t('settings.webhooks.saveFailed', 'Couldn’t save the setting'),
          message: toMessage(cause),
        });
      }
    })();
  };

  /**
   * Copies a webhook's address.
   *
   * @param hookId - The webhook.
   */
  const copy = (hookId: string): void => {
    void copyText(webhookAddress(hookId)).then((isCopied) => {
      if (isCopied) {
        toast.success({ title: t('settings.webhooks.copied', 'Address copied') });
      }
    });
  };

  return (
    <>
      <Panel title={t('settings.webhooks.endpoint', 'Endpoint')}>
        <PanelRow
          title={t('settings.webhooks.baseAddress', 'Base address')}
          note={t('settings.webhooks.baseAddressNote', 'Every webhook is a path under it.')}
          control={
            <span translate="no" className="font-mono text-ui text-foreground">
              {`${globalThis.location.origin}/api/hooks/`}
            </span>
          }
        />
        <PanelRow
          title={t('settings.webhooks.fromTheInternet', 'From the internet')}
          note={t(
            'settings.webhooks.fromTheInternetNote',
            'Through remote access. Off: webhooks marked Internet answer 404 from outside.',
          )}
          control={
            <Switch
              label={t('settings.webhooks.fromTheInternet', 'From the internet')}
              disabled={!canWrite || !settings.isSuccess}
              isOn={allowInternet}
              onChange={(isOn) => {
                save('webhooks.allow_internet', isOn);
              }}
            />
          }
        />
        <PanelRow
          title={t('settings.webhooks.limit', 'Limit')}
          note={t('settings.webhooks.limitNote', 'Calls above it get 429 and start nothing.')}
          control={
            <SelectField
              label={t('settings.webhooks.limit', 'Limit')}
              isLabelHidden
              disabled={!canWrite || !settings.isSuccess}
              value={String(rate)}
              options={[...new Set([...RATE_CHOICES, rate])]
                .toSorted((left, right) => left - right)
                .map((count) => ({
                  value: String(count),
                  label: t('settings.webhooks.perMinute', '{{rate}} a minute per webhook', {
                    rate: count,
                  }),
                }))}
              onChange={(value) => {
                save('webhooks.rate_per_minute', Number(value));
              }}
              className="w-56"
            />
          }
        />
      </Panel>

      <Panel title={t('settings.webhooks.title', 'Webhooks')}>
        <p className="-mt-2 px-5.5 pb-3 text-caption text-foreground-subtle">
          {t(
            'settings.webhooks.webhooksNote',
            'One for each automation that starts from a webhook trigger. Pausing the automation pauses its webhook.',
          )}
        </p>
        <div className={cn(HOOK_COLUMNS, 'border-y border-border py-2.5')}>
          <span className={HEADING}>{t('settings.webhooks.automation', 'Automation')}</span>
          <span className={HEADING}>{t('settings.webhooks.method', 'Method')}</span>
          <span className={HEADING}>{t('settings.webhooks.address', 'Address')}</span>
          <span className={HEADING}>{t('settings.webhooks.reachable', 'Reachable')}</span>
          <span className={cn(HEADING, 'text-right')}>{t('settings.webhooks.day', '24 h')}</span>
          <span className={HEADING}>{t('settings.webhooks.lastCall', 'Last call')}</span>
          <span />
        </div>

        {webhooks.isError ? (
          <p role="alert" className="px-5.5 py-4 text-ui text-danger">
            {toMessage(webhooks.error)}
          </p>
        ) : null}

        {webhooks.isSuccess && hooks.length === 0 ? (
          <p className="px-5.5 py-4 text-ui text-foreground-subtle">
            {t(
              'settings.webhooks.none',
              'No automation starts from a webhook yet. Add a Webhook trigger to one.',
            )}
          </p>
        ) : null}

        {hooks.map((hook) => (
          <div
            key={`${hook.automationId}-${hook.hookId}`}
            className={cn(HOOK_COLUMNS, 'border-b border-border py-3 last:border-b-0')}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-inner bg-surface-high text-cyan">
                <AppIcon id="zap" size={14} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-ui font-medium text-foreground">
                  {hook.automationName}
                </span>
                <span className="text-caption text-foreground-subtle">
                  {hook.isActive
                    ? t('settings.webhooks.active', 'Active')
                    : t('settings.webhooks.paused', 'Paused')}
                </span>
              </span>
            </span>
            <span
              translate="no"
              className={cn('font-mono text-caption font-medium', METHOD_TONES[hook.method])}
            >
              {hook.method === 'any' ? t('settings.webhooks.any', 'Any') : hook.method}
            </span>
            <span className="truncate font-mono text-caption text-foreground-muted">
              {`…/${hook.hookId.slice(0, 8)}`}
            </span>
            <span className="flex items-center gap-1.5 text-caption text-foreground-muted">
              <AppIcon id={hook.reach === 'local' ? 'network' : 'globe'} size={13} />
              {hook.reach === 'local'
                ? t('settings.webhooks.localNetwork', 'Local network')
                : t('settings.webhooks.internet', 'Internet')}
            </span>
            <span className="text-right font-mono text-ui text-foreground tabular">
              {hook.calls24h}
            </span>
            {hook.lastCall === null ? (
              <span className="text-caption text-foreground-subtle">
                {t('settings.webhooks.never', 'Never')}
              </span>
            ) : (
              <span className="flex min-w-0 flex-col" title={absoluteTime(hook.lastCall.time)}>
                <span className="text-caption text-foreground">
                  {relativeTime(hook.lastCall.time)}
                </span>
                <span className="truncate font-mono text-label text-foreground-subtle">
                  {hook.lastCall.remoteIp}
                </span>
              </span>
            )}
            <span className="flex justify-end gap-1">
              <IconButton
                label={t('settings.webhooks.copyAddress', 'Copy the address')}
                size="small"
                onClick={() => {
                  copy(hook.hookId);
                }}
              >
                <AppIcon id="copy" size={13} />
              </IconButton>
              <Menu
                items={[
                  {
                    label: t('settings.webhooks.openAutomation', 'Open the automation'),
                    icon: 'external-link',
                    /** Opens the automation the webhook belongs to. */
                    onSelect: () => {
                      void navigate(`/automations/${hook.automationId}`);
                    },
                  },
                ]}
                trigger={({ isOpen, toggle, buttonRef }) => (
                  <IconButton
                    ref={buttonRef}
                    label={t('settings.webhooks.more', 'More')}
                    size="small"
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    onClick={toggle}
                  >
                    <AppIcon id="ellipsis-vertical" size={13} />
                  </IconButton>
                )}
              />
            </span>
          </div>
        ))}
      </Panel>

      <Panel
        title={t('settings.webhooks.recentCalls', 'Recent calls')}
        action={
          <FilterSheet
            label={t('settings.webhooks.narrowTheCalls', 'Narrow the calls')}
            count={facets}
            onClear={() => {
              setFilter(ANY_CALL);
            }}
          >
            <Facet title={t('settings.webhooks.time', 'Time')}>
              <Segmented
                label={t('settings.webhooks.time', 'Time')}
                size="compact"
                options={[
                  { value: '1h', label: t('settings.webhooks.hour', '1 h') },
                  { value: '24h', label: t('settings.webhooks.day', '24 h') },
                  { value: '7d', label: t('settings.webhooks.week', '7 days') },
                  { value: '30d', label: t('settings.webhooks.month', '30 days') },
                ]}
                value={filter.since}
                onChange={(since) => {
                  setFilter({ ...filter, since });
                }}
              />
            </Facet>
            <Facet title={t('settings.webhooks.from', 'From')}>
              <Segmented
                label={t('settings.webhooks.from', 'From')}
                size="compact"
                options={[
                  { value: 'any', label: t('settings.webhooks.anywhere', 'Anywhere') },
                  { value: 'local', label: t('settings.webhooks.local', 'Local') },
                  { value: 'internet', label: t('settings.webhooks.internet', 'Internet') },
                ]}
                value={filter.where}
                onChange={(where) => {
                  setFilter({ ...filter, where });
                }}
              />
            </Facet>
            <Facet title={t('settings.webhooks.method', 'Method')}>
              <ChoiceChips
                label={t('settings.webhooks.method', 'Method')}
                options={WEBHOOK_METHODS.map((method) => ({ value: method, label: method }))}
                value={filter.methods}
                onChange={(methods) => {
                  setFilter({ ...filter, methods });
                }}
              />
            </Facet>
            <Facet title={t('settings.webhooks.automation', 'Automation')}>
              <SelectField
                label={t('settings.webhooks.automation', 'Automation')}
                isLabelHidden
                options={[
                  { value: '', label: t('settings.webhooks.allAutomations', 'All automations') },
                  ...[...automationNames].map(([value, label]) => ({ value, label })),
                ]}
                value={filter.automationId}
                onChange={(automationId) => {
                  setFilter({ ...filter, automationId });
                }}
              />
            </Facet>
          </FilterSheet>
        }
      >
        <p className="-mt-2 px-5.5 pb-3 text-caption text-foreground-subtle">
          {t(
            'settings.webhooks.callsNote',
            'Every call, kept 30 days. Open one for its address, headers and what it started.',
          )}
        </p>
        <div className={cn(CALL_COLUMNS, 'border-y border-border py-2.5')}>
          <span className={HEADING}>{t('settings.webhooks.time', 'Time')}</span>
          <span className={HEADING}>{t('settings.webhooks.webhook', 'Webhook')}</span>
          <span className={HEADING}>{t('settings.webhooks.from', 'From')}</span>
          <span className={HEADING}>{t('settings.webhooks.where', 'Where')}</span>
          <span className={HEADING}>{t('settings.webhooks.method', 'Method')}</span>
          <span className={HEADING}>{t('settings.webhooks.answer', 'Answer')}</span>
          <span className={HEADING}>{t('settings.webhooks.whatHappened', 'What happened')}</span>
          <span />
        </div>

        {calls.isError ? (
          <p role="alert" className="px-5.5 py-4 text-ui text-danger">
            {toMessage(calls.error)}
          </p>
        ) : null}

        {calls.isSuccess && calls.data.pages[0]?.items.length === 0 ? (
          <p className="px-5.5 py-4 text-ui text-foreground-subtle">
            {t('settings.webhooks.noCalls', 'No calls in this time.')}
          </p>
        ) : null}

        {(calls.data?.pages ?? [])
          .flatMap((page) => page.items)
          .map((call) => {
            const hook = hookOf.get(call.hookId);
            const said = whatHappened(call, hook, rate);
            const isOpen = openCall === call.id;

            return (
              <div key={call.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  className={cn(CALL_COLUMNS, 'w-full py-2.5 text-left hover:bg-surface-high')}
                  onClick={() => {
                    setOpenCall(isOpen ? null : call.id);
                  }}
                >
                  <span className="font-mono text-caption text-foreground-subtle">
                    {callTime(call.time)}
                  </span>
                  <span className="truncate text-ui text-foreground">
                    {call.automationId === null
                      ? `…/${call.hookId.slice(0, 8)}`
                      : (automationNames.get(call.automationId) ?? `…/${call.hookId.slice(0, 8)}`)}
                  </span>
                  <span className="truncate font-mono text-caption text-foreground">
                    {call.remoteIp}
                  </span>
                  <span className="flex items-center gap-1.5 text-caption text-foreground-muted">
                    <AppIcon id={call.isLocal ? 'network' : 'globe'} size={12} />
                    {call.isLocal
                      ? t('settings.webhooks.local', 'Local')
                      : t('settings.webhooks.internet', 'Internet')}
                  </span>
                  <span
                    translate="no"
                    className={cn('font-mono text-caption font-medium', METHOD_TONES[call.method])}
                  >
                    {call.method}
                  </span>
                  <span
                    className={cn(
                      'flex items-center gap-1.5 font-mono text-caption',
                      answerTone(call.status),
                    )}
                  >
                    <span className="size-1.5 rounded-full bg-current" />
                    {call.status}
                  </span>
                  <span className="truncate text-caption text-foreground-muted" title={said}>
                    {said}
                  </span>
                  <AppIcon
                    id={isOpen ? 'chevron-down' : 'chevron-right'}
                    size={13}
                    className="text-foreground-subtle"
                  />
                </button>

                {isOpen ? (
                  <div className="mx-5.5 mb-3 grid gap-4 rounded-card border border-border px-4 py-3 md:grid-cols-2">
                    <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-2 text-caption">
                      <dt className="text-foreground-subtle">
                        {t('settings.webhooks.received', 'Received')}
                      </dt>
                      <dd className="font-mono text-foreground">{absoluteTime(call.time)}</dd>
                      <dt className="text-foreground-subtle">
                        {t('settings.webhooks.from', 'From')}
                      </dt>
                      <dd className="font-mono text-foreground">{call.remoteIp}</dd>
                      <dt className="text-foreground-subtle">
                        {t('settings.webhooks.request', 'Request')}
                      </dt>
                      <dd translate="no" className="font-mono break-all text-foreground">
                        {`${call.method} ${call.path}`}
                      </dd>
                      <dt className="text-foreground-subtle">
                        {t('settings.webhooks.userAgent', 'User agent')}
                      </dt>
                      <dd translate="no" className="font-mono break-all text-foreground">
                        {call.userAgent ?? '-'}
                      </dd>
                      <dt className="text-foreground-subtle">
                        {t('settings.webhooks.answer', 'Answer')}
                      </dt>
                      <dd className="font-mono text-foreground">
                        {t('settings.webhooks.answerLine', '{{status}} in {{ms}} ms · {{said}}', {
                          status: call.status,
                          ms: call.durationMs,
                          said,
                        })}
                      </dd>
                    </dl>
                    <div className="flex min-w-0 flex-col gap-2">
                      <span className="text-caption font-medium text-foreground-muted">
                        {t('settings.webhooks.headers', 'Headers')}
                      </span>
                      <pre
                        translate="no"
                        className="overflow-x-auto rounded-field border border-border bg-surface-raised px-3 py-2 font-mono text-caption whitespace-pre-wrap text-foreground"
                      >
                        {Object.entries(call.headers)
                          .map(([name, value]) => `${name}: ${value}`)
                          .join('\n')}
                      </pre>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

        {calls.hasNextPage ? (
          <div className="px-5.5 py-3">
            <button
              type="button"
              disabled={calls.isFetchingNextPage}
              className="flex items-center gap-1 text-ui text-primary hover:text-primary-hover"
              onClick={() => {
                void calls.fetchNextPage();
              }}
            >
              {t('settings.webhooks.allCalls', 'All calls')}
              <AppIcon id="chevron-right" size={13} />
            </button>
          </div>
        ) : null}
      </Panel>
    </>
  );
}

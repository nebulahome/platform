/**
 * Settings › Network › Webhooks (boards N-Settings-Webhooks, N-Settings-Webhook-Open) and its
 * Recent calls page (N-Settings-Webhooks-Filter): where webhooks are reached, the automations that
 * have one - each opening in place - and every call their addresses received.
 *
 * The two settings - calls from the internet, the limit a minute - are saved as they are changed:
 * neither depends on the other, so there is no draft to judge. Webhooks are not rows of their own
 * but webhook triggers inside automations, so the list is read from those; a paused automation's
 * webhook is listed as paused, and answers 404. A call opens into what it carried and what it
 * started. Its body was never kept.
 */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

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
  Button,
  IconButton,
  Pill,
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
import { absoluteTime, shortTime } from '@/lib/format-time';
import { METHOD_TONES } from '@/lib/http-methods';
import { fetchWebhookCalls, fetchWebhooks, LIBRARY_QUERY_KEYS } from '@/library/api';
import { webhookAddress } from '@/routes/library/automation/webhook-fields';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';
import {
  RowIcon,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '@/routes/settings/settings-ui';
import { SETTINGS_QUERY_KEYS, fetchServerSettings, updateServerSettings } from '@/settings/api';

/** The limits a minute that can be chosen. */
const RATE_CHOICES = [10, 30, 60, 120, 300] as const;

/** The columns of the calls table. */
const CALL_COLUMNS =
  'grid grid-cols-[80px_minmax(0,1fr)_minmax(0,128px)_88px_60px_60px_minmax(0,1fr)_16px] items-center gap-3 px-4';

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

/** Where the calls page is. */
const CALLS_PATH = '/settings/network/webhooks/calls';

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
 * The settings both pages read: whether calls from outside are taken, and the limit a minute.
 *
 * @returns The two values, and whether they have been read.
 */
function useWebhookSettings() {
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
  const stored = new Map((settings.data?.items ?? []).map((item) => [item.key, item.value]));
  const rateSetting = stored.get('webhooks.rate_per_minute');

  return {
    isRead: settings.isSuccess,
    allowInternet: stored.get('webhooks.allow_internet') !== false,
    rate: typeof rateSetting === 'number' ? rateSetting : 30,
  };
}

/**
 * Reads the webhooks: one per automation that has a webhook trigger.
 *
 * @returns The query.
 */
function useWebhooks() {
  return useQuery({
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
}

/**
 * Copies a webhook's address, and says so.
 *
 * @param address - What to copy.
 * @param done - The toast's title.
 */
function copyAddress(address: string, done: string): void {
  void copyText(address).then((isCopied) => {
    if (isCopied) {
      toast.success({ title: done });
    }
  });
}

/** What one webhook row needs. */
type WebhookRowProps = {
  readonly hook: WebhookView;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
};

/**
 * One webhook: its automation, method, address and reach, opening in place into the details.
 *
 * @param props - See {@link WebhookRowProps}.
 * @returns The row.
 */
function WebhookRow(props: WebhookRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hook, isOpen, onToggle } = props;
  const address = webhookAddress(hook.hookId);
  const method = hook.method === 'any' ? t('settings.webhooks.any', 'Any') : hook.method;
  const reach =
    hook.reach === 'local'
      ? t('settings.webhooks.localNetwork', 'Local network')
      : t('settings.webhooks.internet', 'Internet');

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-raised/40"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-field bg-primary/14 text-primary">
          <AppIcon id="zap" size={15} />
        </span>
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="truncate text-title text-foreground">{hook.automationName}</span>
          <span className="flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
            <span
              translate="no"
              className={cn('font-mono text-caption font-medium', METHOD_TONES[hook.method])}
            >
              {method}
            </span>
            <span className="truncate font-mono text-caption">{`…/${hook.hookId.slice(0, 8)}`}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{reach}</span>
          </span>
        </span>
        {hook.isActive ? (
          <span className="font-mono text-caption text-foreground-muted tabular">
            {t('settings.webhooks.callsToday', '{{count}} in 24 h', { count: hook.calls24h })}
          </span>
        ) : (
          <span className="font-mono text-caption text-warning">
            {t('settings.webhooks.paused', 'Paused')}
          </span>
        )}
        <AppIcon
          id="chevron-down"
          size={14}
          className={cn(
            'shrink-0 text-foreground-subtle transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
        inert={!isOpen}
      >
        <div className="overflow-hidden">
          <div className="-mx-4 flex flex-col gap-4.5 border-t border-border bg-surface-raised/30 pt-1 pr-4 pb-4.5 pl-15">
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3">
              <Pill tone={hook.isActive ? 'success' : 'warning'}>
                {hook.isActive
                  ? t('settings.webhooks.active', 'Active')
                  : t('settings.webhooks.paused', 'Paused')}
              </Pill>
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  void navigate(`/automations/${hook.automationId}`);
                }}
              >
                <AppIcon id="external-link" size={14} />
                {t('settings.webhooks.openAutomation', 'Open automation')}
              </Button>
            </div>

            <div className="flex flex-col">
              <h4 className={cn(HEADING, 'pb-2')}>{t('settings.webhooks.address', 'Address')}</h4>
              <DetailLine label={t('settings.webhooks.url', 'URL')}>
                <span translate="no" className="truncate font-mono text-ui-sm text-foreground">
                  {address}
                </span>
                <IconButton
                  label={t('settings.webhooks.copyAddress', 'Copy the address')}
                  size="small"
                  variant="raised"
                  onClick={() => {
                    copyAddress(address, t('settings.webhooks.copied', 'Address copied'));
                  }}
                >
                  <AppIcon id="copy" size={13} />
                </IconButton>
              </DetailLine>
              <DetailLine label={t('settings.webhooks.method', 'Method')}>
                <span
                  translate="no"
                  className={cn('font-mono text-caption font-medium', METHOD_TONES[hook.method])}
                >
                  {method}
                </span>
              </DetailLine>
              <DetailLine label={t('settings.webhooks.reachableFrom', 'Reachable from')}>
                <span className="text-ui text-foreground">{reach}</span>
              </DetailLine>
            </div>

            <div className="flex flex-col">
              <h4 className={cn(HEADING, 'pb-2')}>
                {t('settings.webhooks.last24h', 'Last 24 hours')}
              </h4>
              <HourlyCalls hook={hook} />
            </div>

            <div className="flex flex-col">
              <div className="flex items-center justify-between gap-3 pb-2">
                <h4 className={HEADING}>{t('settings.webhooks.recentCalls', 'Recent calls')}</h4>
                <button
                  type="button"
                  className="flex items-center gap-1 text-ui-sm text-primary transition-colors hover:text-primary-hover"
                  onClick={() => {
                    void navigate(`${CALLS_PATH}?automation=${hook.automationId}`);
                  }}
                >
                  {t('settings.webhooks.allCallsFor', 'All calls for this webhook')}
                  <AppIcon id="chevron-right" size={14} />
                </button>
              </div>
              {isOpen ? <LastCalls hook={hook} /> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One line of a webhook's details: a label, and what it is.
 *
 * @param props - The label and the value.
 * @param props.label - What the line is.
 * @param props.children - Its value.
 * @returns The line.
 */
function DetailLine(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border py-2.5 first-of-type:border-t-0">
      <span className="w-30 shrink-0 text-ui-sm text-foreground-subtle">{props.label}</span>
      <span className="flex min-w-0 flex-[1_1_220px] items-center gap-2">{props.children}</span>
    </div>
  );
}

/**
 * A webhook's calls of the last 24 hours, one bar an hour.
 *
 * @param props - The webhook.
 * @param props.hook - Whose calls.
 * @returns The chart.
 */
function HourlyCalls(props: { readonly hook: WebhookView }) {
  const { t } = useTranslation();
  const { hourly, calls24h } = props.hook;
  const most = Math.max(1, ...hourly);
  const clock = dateTimeFormat({ hour: '2-digit', minute: '2-digit' });
  const [now] = useState(() => Date.now());

  return (
    <div className="flex flex-col gap-2 rounded-tile border border-border bg-surface p-3.5">
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-headline font-medium text-foreground tabular">
          {calls24h}
        </span>
        <span className="text-ui-sm text-foreground-subtle">
          {t('settings.webhooks.callsLast24h', 'Calls in the last 24 h')}
        </span>
      </div>
      <div className="flex h-11 items-end gap-0.75">
        {hourly.map((count, index) => (
          <span
            // The bars are the hours; their order never changes.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            title={`${clock.format(now - (24 - index) * 3_600_000)} · ${String(count)}`}
            /* eslint-disable-next-line react/forbid-dom-props -- a bar is as tall as its share of
            the busiest hour, a number no class can carry (RULES.md 15.3). */
            style={{ height: count === 0 ? 2 : Math.max(4, (count / most) * 44) }}
            className={cn(
              'flex-1 rounded-[3px] transition-[height] duration-300',
              count === 0 ? 'bg-surface-high' : 'bg-primary hover:bg-primary-hover',
            )}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-label text-foreground-subtle">
        <span>
          {t('settings.webhooks.yesterdayAt', 'yesterday {{time}}', {
            time: clock.format(now - 24 * 3_600_000),
          })}
        </span>
        <span>{t('settings.webhooks.now', 'now')}</span>
      </div>
    </div>
  );
}

/**
 * The last three calls of one webhook.
 *
 * @param props - The webhook.
 * @param props.hook - Whose calls.
 * @returns The lines.
 */
function LastCalls(props: { readonly hook: WebhookView }) {
  const { t } = useTranslation();
  const { hook } = props;
  const { rate } = useWebhookSettings();
  const calls = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.webhookCalls, 'last', hook.automationId],

    /**
     * Reads the newest calls of this webhook's automation.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The first page.
     */
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchWebhookCalls(
        callQuery({ ...ANY_CALL, automationId: hook.automationId }, undefined),
        signal,
      ),
  });
  const items = (calls.data?.items ?? []).slice(0, 3);

  if (calls.isSuccess && items.length === 0) {
    return (
      <p className="py-2.5 text-ui-sm text-foreground-subtle">
        {t('settings.webhooks.noCalls', 'No calls in this time.')}
      </p>
    );
  }

  return (
    <div>
      {items.map((call) => {
        const said = whatHappened(call, hook, rate);

        return (
          <div
            key={call.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border py-2.5 text-ui-sm first:border-t-0"
          >
            <span className="min-w-17.5 shrink-0 font-mono whitespace-nowrap text-foreground-subtle">
              {callTime(call.time)}
            </span>
            <span className="w-32.5 shrink-0 truncate font-mono text-foreground">
              {call.remoteIp}
            </span>
            <span
              translate="no"
              className={cn(
                'w-10 shrink-0 font-mono text-caption font-medium',
                METHOD_TONES[call.method],
              )}
            >
              {call.method}
            </span>
            <span
              className={cn(
                'flex w-12 shrink-0 items-center gap-1.5 font-mono',
                answerTone(call.status),
              )}
            >
              <span className="size-1.5 rounded-full bg-current" />
              {call.status}
            </span>
            <span className="min-w-0 flex-[1_1_140px] truncate text-foreground-muted" title={said}>
              {said}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Renders Settings › Network › Webhooks.
 *
 * @returns The page.
 */
export function WebhooksSettings() {
  const { t } = useTranslation();
  const canWrite = useSession((state) => state.can('settings:write'));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { isRead, allowInternet, rate } = useWebhookSettings();
  const webhooks = useWebhooks();
  const hooks = webhooks.data ?? [];
  const openId = params.get('open');
  const base = `${globalThis.location.origin}/api/hooks/`;

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

  return (
    <SettingsPage path="/settings/network/webhooks">
      <SettingsSection label={t('settings.webhooks.endpoint', 'Endpoint')}>
        <SettingsRow
          searchId="webhooks.base"
          title={t('settings.webhooks.baseAddress', 'Base address')}
          note={t('settings.webhooks.baseAddressNote', 'Every webhook is a path under it.')}
          control={
            <>
              <span translate="no" className="font-mono text-ui-sm text-foreground">
                {base}
              </span>
              <IconButton
                variant="raised"
                label={t('settings.webhooks.copyAddress', 'Copy the address')}
                onClick={() => {
                  copyAddress(base, t('settings.webhooks.copied', 'Address copied'));
                }}
              >
                <AppIcon id="copy" size={15} />
              </IconButton>
            </>
          }
        />
        <SettingsRow
          searchId="webhooks.allow_internet"
          title={t('settings.webhooks.fromTheInternet', 'From the internet')}
          note={t(
            'settings.webhooks.fromTheInternetNote',
            'Through remote access. Off: webhooks marked Internet answer 404 from outside.',
          )}
          control={
            <Switch
              label={t('settings.webhooks.fromTheInternet', 'From the internet')}
              disabled={!canWrite || !isRead}
              isOn={allowInternet}
              onChange={(isOn) => {
                save('webhooks.allow_internet', isOn);
              }}
            />
          }
        />
        <SettingsRow
          searchId="webhooks.rate_per_minute"
          title={t('settings.webhooks.limit', 'Limit')}
          note={t('settings.webhooks.limitNote', 'Calls above it get 429 and start nothing.')}
          control={
            <SelectField
              label={t('settings.webhooks.limit', 'Limit')}
              isLabelHidden
              disabled={!canWrite || !isRead}
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
      </SettingsSection>

      <SettingsSection label={t('settings.webhooks.title', 'Webhooks')} className="overflow-hidden">
        {webhooks.isError ? (
          <p role="alert" className="py-4 text-ui text-danger">
            {toMessage(webhooks.error)}
          </p>
        ) : null}

        {webhooks.isSuccess && hooks.length === 0 ? (
          <p className="py-4 text-ui text-foreground-muted">
            {t(
              'settings.webhooks.none',
              'No automation starts from a webhook yet. Add a Webhook trigger to one.',
            )}
          </p>
        ) : null}

        {hooks.map((hook) => {
          const id = `${hook.automationId}-${hook.hookId}`;

          return (
            <WebhookRow
              key={id}
              hook={hook}
              isOpen={openId === id}
              onToggle={() => {
                setParams(openId === id ? {} : { open: id }, { replace: true });
              }}
            />
          );
        })}
      </SettingsSection>

      <SettingsSection
        label={t('settings.webhooks.activity', 'Activity')}
        className="overflow-hidden"
      >
        <button
          type="button"
          onClick={() => {
            void navigate(CALLS_PATH);
          }}
          className="group -mx-4 flex w-[calc(100%+2rem)] items-center gap-3 rounded-card px-4 py-3.5 text-left transition-colors hover:bg-surface-raised/40"
        >
          <RowIcon>
            <AppIcon id="list" size={16} />
          </RowIcon>
          <span className="flex min-w-0 grow flex-col gap-0.5">
            <span className="text-title text-foreground">
              {t('settings.webhooks.recentCalls', 'Recent calls')}
            </span>
            <span className="text-ui-sm text-foreground-subtle">
              {t('settings.webhooks.recentCallsNote', '{{count}} in the last 24 h · kept 30 days', {
                count: hooks.reduce((total, hook) => total + hook.calls24h, 0),
              })}
            </span>
          </span>
          <AppIcon
            id="chevron-right"
            size={15}
            className="text-foreground-subtle transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </button>
      </SettingsSection>
    </SettingsPage>
  );
}

/**
 * Renders Settings › Network › Webhooks › Recent calls.
 *
 * @returns The page.
 */
export function WebhookCalls() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<CallFilter>({
    ...ANY_CALL,
    automationId: params.get('automation') ?? '',
  });
  const [openCall, setOpenCall] = useState<string | null>(null);
  const { rate } = useWebhookSettings();
  const webhooks = useWebhooks();
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

  const hooks = webhooks.data ?? [];
  const hookOf = new Map(hooks.map((hook) => [hook.hookId, hook]));
  const automationNames = new Map(hooks.map((hook) => [hook.automationId, hook.automationName]));
  const facets =
    (filter.since === ANY_CALL.since ? 0 : 1) +
    (filter.where === 'any' ? 0 : 1) +
    (filter.methods.length === 0 ? 0 : 1) +
    (filter.automationId === '' ? 0 : 1);
  const sinceLabel = {
    '1h': t('settings.webhooks.lastHour', 'Last hour'),
    '24h': t('settings.webhooks.lastDay', 'Last 24 hours'),
    '7d': t('settings.webhooks.lastWeek', 'Last 7 days'),
    '30d': t('settings.webhooks.lastMonth', 'Last 30 days'),
  }[filter.since];

  return (
    <SettingsPage
      path="/settings/network/webhooks"
      sub={{
        title: t('settings.webhooks.recentCalls', 'Recent calls'),
        description: t('settings.webhooks.recentCallsPage', 'Every webhook call, kept 30 days.'),
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex min-h-9 items-center justify-between gap-4 px-1">
          <h3 className="font-mono text-label text-foreground-subtle uppercase">{sinceLabel}</h3>
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
        </div>

        <SettingsCard className="px-0">
          <div className={cn(CALL_COLUMNS, 'border-b border-border py-2.5')}>
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
            <p role="alert" className="px-4 py-4 text-ui text-danger">
              {toMessage(calls.error)}
            </p>
          ) : null}

          {calls.isSuccess && calls.data.pages[0]?.items.length === 0 ? (
            <p className="px-4 py-4 text-ui text-foreground-subtle">
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
                        : (automationNames.get(call.automationId) ??
                          `…/${call.hookId.slice(0, 8)}`)}
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
                      className={cn(
                        'font-mono text-caption font-medium',
                        METHOD_TONES[call.method],
                      )}
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
                    <div className="mx-4 mb-3 grid gap-4 rounded-card border border-border px-4 py-3 md:grid-cols-2">
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
            <div className="px-4 py-3">
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
        </SettingsCard>
      </div>
    </SettingsPage>
  );
}

/**
 * The fields of a webhook trigger (board N-Blocks-Triggers): its address, to copy or to make
 * anew, the method it takes, where it may be called from, and its last call.
 *
 * The address is `/api/hooks/<id>` on whatever this page was opened at; the id is the secret, so
 * a new one stops the old address the moment the automation is saved.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { AutomationTrigger } from '@nebulahome/contracts';
import { AppIcon, Button, FieldShell, IconButton, Segmented } from '@nebulahome/ui';

import { copyText } from '@/lib/clipboard';
import { relativeTime } from '@/lib/format-time';
import { fetchWebhooks, LIBRARY_QUERY_KEYS } from '@/library/api';
import { newHookId } from '@/library/automation-draft';

/** A webhook trigger. */
type WebhookTrigger = Extract<AutomationTrigger, { type: 'webhook' }>;

/**
 * A webhook's address, as callers reach it from this browser's view of the house.
 *
 * @param hookId - The webhook's id.
 * @returns The address.
 */
export function webhookAddress(hookId: string): string {
  return `${globalThis.location.origin}/api/hooks/${hookId}`;
}

/**
 * Renders the fields of a webhook trigger.
 *
 * @param props - The trigger and its change handler.
 * @param props.trigger - The webhook trigger.
 * @param props.onChange - Called with it as it now stands.
 * @returns The fields.
 */
export function WebhookFields(props: {
  readonly trigger: WebhookTrigger;
  readonly onChange: (trigger: AutomationTrigger) => void;
}) {
  const { t } = useTranslation();

  const { trigger, onChange } = props;
  const [isCopied, setCopied] = useState(false);
  const address = webhookAddress(trigger.hookId);
  const webhooks = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.webhooks,

    /**
     * Reads the webhooks, for this one's last call.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns Every webhook.
     */
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchWebhooks(signal),
  });
  const last = webhooks.data?.find((webhook) => webhook.hookId === trigger.hookId)?.lastCall;

  return (
    <>
      <FieldShell
        label={t('library.webhookFields.address', 'Address')}
        hint={t(
          'library.webhookFields.keepItSecret',
          'Anyone with this address can start the automation: keep it like a password. A new address stops the old one at once.',
        )}
      >
        {(ids) => (
          <div className="flex items-center gap-2 rounded-field border border-border bg-surface-raised py-1 pr-1 pl-3">
            <AppIcon id="link-2" size={14} className="shrink-0 text-foreground-subtle" />
            <input
              id={ids.id}
              aria-describedby={ids.describedBy}
              readOnly
              value={address}
              className="min-w-0 grow bg-transparent font-mono text-ui text-foreground focus-visible:outline-none"
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
            <IconButton
              label={t('library.webhookFields.newAddress', 'Make a new address')}
              size="small"
              onClick={() => {
                setCopied(false);
                onChange({ ...trigger, hookId: newHookId() });
              }}
            >
              <AppIcon id="refresh-cw" size={13} />
            </IconButton>
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                void copyText(address).then(setCopied);
              }}
            >
              <AppIcon id="copy" size={13} />
              {isCopied ? t('common.copied', 'Copied') : t('common.copy', 'Copy')}
            </Button>
          </div>
        )}
      </FieldShell>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-foreground-muted">
            {t('library.webhookFields.accepts', 'Accepts')}
          </span>
          <Segmented
            label={t('library.webhookFields.accepts', 'Accepts')}
            size="compact"
            className="self-start"
            options={[
              { value: 'POST', label: 'POST' },
              { value: 'GET', label: 'GET' },
              { value: 'PUT', label: 'PUT' },
              { value: 'any', label: t('library.webhookFields.any', 'Any') },
            ]}
            value={
              trigger.method === 'PATCH' || trigger.method === 'DELETE' ? 'any' : trigger.method
            }
            onChange={(method) => {
              onChange({ ...trigger, method });
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-foreground-muted">
            {t('library.webhookFields.reachableFrom', 'Reachable from')}
          </span>
          <Segmented
            label={t('library.webhookFields.reachableFrom', 'Reachable from')}
            size="compact"
            className="self-start"
            options={[
              { value: 'local', label: t('library.webhookFields.localNetwork', 'Local network') },
              { value: 'internet', label: t('library.webhookFields.internet', 'Internet') },
            ]}
            value={trigger.reach}
            onChange={(reach) => {
              onChange({ ...trigger, reach });
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-caption text-foreground-subtle">
        {last == null ? (
          <span>{t('library.webhookFields.neverCalled', 'Not called yet')}</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <AppIcon
              id={last.status < 300 ? 'circle-check' : 'circle-x'}
              size={12}
              className={last.status < 300 ? 'text-success' : 'text-warning'}
            />
            {t('library.webhookFields.lastCall', 'Last call {{when}} from {{ip}} · {{status}}', {
              when: relativeTime(last.time),
              ip: last.remoteIp,
              status: last.status,
            })}
          </span>
        )}
        <Link to="/settings/network/webhooks" className="text-primary hover:text-primary-hover">
          {t('library.webhookFields.allCalls', 'All calls in Settings › Webhooks')}
        </Link>
      </div>
    </>
  );
}

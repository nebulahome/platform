/**
 * Where you are signed in.
 *
 * The current session is marked rather than made revocable. Ending it from here would sign you
 * out mid-page with no explanation, and the control for that already exists two rows down in the
 * rail, where it says "Sign out" and means it.
 *
 * "Sign out everywhere" does include this one, which is the whole point: it is what somebody
 * reaches for after losing a laptop, and a version that spared the browser they are holding
 * would leave them wondering which sessions it actually ended.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, Pill, toast } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { absoluteTime, relativeTime } from '@/lib/format-time';
import { RowIcon, SettingsRow, SettingsSection } from '@/routes/settings/settings-ui';
import { SETTINGS_QUERY_KEYS, fetchSessions, revokeSession } from '@/settings/api';
import { describeUserAgent } from '@/settings/user-agent';

/**
 * Renders the sessions panel.
 *
 * @returns The panel.
 */
export function SessionsPanel() {
  const { t } = useTranslation();
  const endSession = useSession((state) => state.signOut);
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.sessions,

    /**
     * Reads the sessions.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every session this person has.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchSessions(signal),
  });

  /**
   * Ends one session and reloads the list.
   *
   * @param sessionId - Which one.
   */
  const revoke = (sessionId: string): void => {
    void (async (): Promise<void> => {
      try {
        await revokeSession(sessionId);
        await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.sessions });
        toast.success({ title: t('settings.sessions.revoked', 'Session revoked') });
      } catch (cause: unknown) {
        toast.error({
          title: t('settings.sessions.revokeFailed', 'Couldn’t revoke the session'),
          message: toMessage(cause),
        });
      }
    })();
  };

  return (
    <SettingsSection
      label={t('settings.sessions.section', 'Sessions')}
      action={
        <Button
          variant="danger"
          onClick={() => {
            void endSession(true);
          }}
        >
          {t('settings.sessions.signOutEverywhere', 'Sign out everywhere')}
        </Button>
      }
    >
      {sessions.isPending ? (
        <p className="py-4 text-ui text-foreground-subtle">
          {t('settings.sessions.reading', 'Reading your sessions…')}
        </p>
      ) : null}

      {sessions.isError ? (
        <p role="alert" className="py-4 text-ui text-danger">
          {toMessage(sessions.error)}
        </p>
      ) : null}

      {(sessions.data ?? []).map((entry) => (
        <SettingsRow
          key={entry.id}
          leading={
            <RowIcon>
              <AppIcon id="globe" size={16} />
            </RowIcon>
          }
          title={describeUserAgent(entry.userAgent)}
          note={
            <span title={absoluteTime(entry.lastSeenAt)}>
              {entry.ipAddress ?? '—'} · {relativeTime(entry.lastSeenAt)}
            </span>
          }
          control={
            entry.isCurrent ? (
              <Pill tone="success">{t('settings.sessions.thisDevice', 'This device')}</Pill>
            ) : (
              <Button
                variant="danger"
                size="compact"
                onClick={() => {
                  revoke(entry.id);
                }}
              >
                {t('settings.sessions.signOut', 'Sign out')}
              </Button>
            )
          }
        />
      ))}
    </SettingsSection>
  );
}

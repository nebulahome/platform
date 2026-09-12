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
import { useState } from 'react';

import { Badge, Button, Panel } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { absoluteTime, relativeTime } from '@/lib/format-time';
import { SETTINGS_QUERY_KEYS, fetchSessions, revokeSession } from '@/settings/api';
import { describeUserAgent } from '@/settings/user-agent';

/** The column widths, shared by the header and every row so they line up. */
const COLUMNS = 'grid grid-cols-[1fr_140px_110px_86px] items-center gap-3 px-4';

/**
 * Renders the sessions panel.
 *
 * @returns The panel.
 */
export function SessionsPanel() {
  const endSession = useSession((state) => state.signOut);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | undefined>(undefined);
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
    setError(undefined);

    void (async (): Promise<void> => {
      try {
        await revokeSession(sessionId);
        await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.sessions });
      } catch (cause: unknown) {
        setError(toMessage(cause));
      }
    })();
  };

  return (
    <Panel
      title="Active sessions"
      action={
        <Button
          variant="danger"
          className="h-8 px-3 text-ui"
          onClick={() => {
            void endSession(true);
          }}
        >
          Sign out everywhere
        </Button>
      }
    >
      <div className={`${COLUMNS} border-b border-border-soft py-2.5`}>
        <span className="text-label text-foreground-subtle uppercase">Browser</span>
        <span className="text-label text-foreground-subtle uppercase">Address</span>
        <span className="text-label text-foreground-subtle uppercase">Last active</span>
        <span />
      </div>

      {sessions.isPending ? (
        <p className="px-4 py-4 text-ui text-foreground-subtle">Reading your sessions…</p>
      ) : null}

      {sessions.isError ? (
        <p role="alert" className="px-4 py-4 text-ui text-danger">
          {toMessage(sessions.error)}
        </p>
      ) : null}

      {(sessions.data ?? []).map((entry) => (
        <div
          key={entry.id}
          className={`${COLUMNS} border-b border-border-soft py-3 last:border-b-0`}
        >
          <span className="truncate text-ui text-foreground">
            {describeUserAgent(entry.userAgent)}
          </span>

          <span className="truncate font-mono text-caption text-foreground-muted">
            {entry.ipAddress ?? '—'}
          </span>

          <span
            className="text-caption text-foreground-subtle"
            title={absoluteTime(entry.lastSeenAt)}
          >
            {relativeTime(entry.lastSeenAt)}
          </span>

          <div className="flex justify-end">
            {entry.isCurrent ? (
              <Badge tone="success">This one</Badge>
            ) : (
              <Button
                variant="danger"
                className="h-8 px-3 text-ui"
                onClick={() => {
                  revoke(entry.id);
                }}
              >
                Revoke
              </Button>
            )}
          </div>
        </div>
      ))}

      {error === undefined ? null : (
        <p role="alert" className="border-t border-border-soft px-4 py-3 text-ui text-danger">
          {error}
        </p>
      )}
    </Panel>
  );
}

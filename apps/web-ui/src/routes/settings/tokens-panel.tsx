/**
 * Personal access tokens: the credential a script uses.
 *
 * The permission list a token can be given is built from the grants the signed-in person
 * actually holds, and only the allows. That is not the security boundary - the API intersects a
 * token's permissions with its owner's on every request, so a token can never do more than they
 * can do now, even after their role is narrowed. It is here so the form cannot offer something
 * that would be silently dropped.
 *
 * The secret appears exactly once, in the dialog that creates it. The server keeps a hash, so
 * there is no second chance and nothing to be clever about: the dialog stays open until it is
 * dismissed on purpose.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { PERMISSIONS, type ScopedPermission } from '@nebula-home/contracts';
import { Button, TextField } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { Modal } from '@/components/modal';
import { Panel, PanelRow } from '@/components/panel';
import { SelectField } from '@/components/select-field';
import { copyText } from '@/lib/clipboard';
import { toMessage } from '@/lib/error-message';
import { absoluteTime, relativeTime } from '@/lib/format-time';
import {
  SETTINGS_QUERY_KEYS,
  createAccessToken,
  fetchAccessTokens,
  revokeAccessToken,
} from '@/settings/api';

/** How long a token may last, and what each choice is called. */
const LIFETIMES: readonly { readonly value: string; readonly label: string }[] = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: 'A year' },
  { value: 'never', label: 'Never expires' },
];

/** What one permission is described as, by key. */
const DESCRIPTIONS: ReadonlyMap<string, string> = new Map(
  PERMISSIONS.map((permission) => [permission.key, permission.description]),
);

/**
 * Works out when a token should stop working.
 *
 * @param lifetime - The chosen option.
 * @param now - What to measure from. Injected so the value is testable.
 * @returns An ISO timestamp, or null for a token that never expires.
 */
function toExpiry(lifetime: string, now: Date = new Date()): string | null {
  if (lifetime === 'never') {
    return null;
  }

  const days = Number(lifetime);

  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Renders the personal access token panel.
 *
 * @returns The panel.
 */
export function TokensPanel() {
  const grants = useSession((state) => state.user?.permissions ?? []);
  const queryClient = useQueryClient();
  const [isCreating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [lifetime, setLifetime] = useState('90');
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [secret, setSecret] = useState<string | undefined>(undefined);
  const [isCopied, setCopied] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);

  const tokens = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.accessTokens,

    /**
     * Reads the tokens.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every token this person has, without their secrets.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAccessTokens(signal),
  });

  // Only the allows, and only the unscoped ones. A token that carried a scoped grant would need
  // the form to ask which area or entity, and there is no screen behind that question yet.
  const offerable = grants
    .filter((grant) => grant.effect === 'allow' && grant.scope === '*')
    .map((grant) => grant.key)
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort();

  /**
   * Closes the dialog and forgets everything typed into it.
   */
  const close = (): void => {
    setCreating(false);
    setSecret(undefined);
    setName('');
    setChosen([]);
    setError(undefined);
    setCopied(false);
  };

  /**
   * Adds or removes one permission from the token being made.
   *
   * @param key - Which permission.
   */
  const toggle = (key: string): void => {
    setChosen(chosen.includes(key) ? chosen.filter((entry) => entry !== key) : [...chosen, key]);
  };

  /**
   * Issues the token.
   */
  const create = (): void => {
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        const permissions: ScopedPermission[] = chosen.map((key) => ({ key, scope: '*' }));
        const answer = await createAccessToken({
          name,
          permissions,
          expiresAt: toExpiry(lifetime),
        });

        await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.accessTokens });
        setSecret(answer.secret);
      } catch (cause: unknown) {
        setError(toMessage(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  /**
   * Revokes a token.
   *
   * @param tokenId - Which one.
   */
  const revoke = (tokenId: string): void => {
    setError(undefined);

    void (async (): Promise<void> => {
      try {
        await revokeAccessToken(tokenId);
        await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.accessTokens });
      } catch (cause: unknown) {
        setError(toMessage(cause));
      }
    })();
  };

  return (
    <>
      <Panel
        title="Personal access tokens"
        action={
          <Button
            className="h-8 px-3 text-[13px]"
            onClick={() => {
              setError(undefined);
              setCreating(true);
            }}
          >
            Create token
          </Button>
        }
      >
        {tokens.isPending ? (
          <p className="px-4 py-4 text-[13px] text-foreground-subtle">Reading your tokens…</p>
        ) : null}

        {tokens.isError ? (
          <p role="alert" className="px-4 py-4 text-[13px] text-danger">
            {toMessage(tokens.error)}
          </p>
        ) : null}

        {tokens.isSuccess && tokens.data.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-foreground-subtle">
            None yet. A token is how a script signs in without your password.
          </p>
        ) : null}

        {(tokens.data ?? []).map((token) => (
          <PanelRow
            key={token.id}
            title={token.name}
            note={
              <>
                <span className="font-mono">{token.tokenPrefix}…</span>
                {' · '}
                {token.permissions.map((permission) => permission.key).join(', ')}
                {' · '}
                {token.lastUsedAt === null ? (
                  'never used'
                ) : (
                  <span title={absoluteTime(token.lastUsedAt)}>
                    last used {relativeTime(token.lastUsedAt)}
                  </span>
                )}
                {token.expiresAt === null ? ' · never expires' : ''}
              </>
            }
            control={
              <Button
                variant="danger"
                className="h-8 px-3 text-[13px]"
                onClick={() => {
                  revoke(token.id);
                }}
              >
                Revoke
              </Button>
            }
          />
        ))}

        {error === undefined || isCreating ? null : (
          <p
            role="alert"
            className="border-t border-surface-raised px-4 py-3 text-[13px] text-danger"
          >
            {error}
          </p>
        )}
      </Panel>

      <Modal
        isOpen={isCreating}
        onClose={close}
        title={secret === undefined ? 'Create a token' : 'Your new token'}
        description={
          secret === undefined
            ? 'A token can never do more than you can. Give it the least it needs.'
            : 'This is the only time the secret exists in a readable form. Copy it now.'
        }
        footer={
          secret === undefined ? (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                isBusy={isBusy}
                disabled={name.trim() === '' || chosen.length === 0}
                onClick={create}
              >
                Create
              </Button>
            </>
          ) : (
            <Button onClick={close}>Done</Button>
          )
        }
      >
        {secret === undefined ? (
          <div className="flex flex-col gap-4">
            <TextField
              label="What is it for"
              placeholder="grafana-readonly"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />

            <SelectField
              label="Expires"
              value={lifetime}
              options={LIFETIMES}
              onChange={setLifetime}
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-xs font-medium text-foreground-muted">
                What it may do
              </legend>

              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-field border border-border bg-groove p-2">
                {offerable.map((key) => (
                  <label
                    key={key}
                    htmlFor={`token-permission-${key}`}
                    className="grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-raised"
                  >
                    <input
                      id={`token-permission-${key}`}
                      type="checkbox"
                      checked={chosen.includes(key)}
                      onChange={() => {
                        toggle(key);
                      }}
                      className="row-span-2 mt-0.5 accent-primary"
                    />
                    <span className="min-w-0 font-mono text-[12.5px] text-foreground">{key}</span>
                    <span className="col-start-2 min-w-0 text-[11.5px] text-foreground-subtle">
                      {DESCRIPTIONS.get(key) ?? ''}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {error === undefined ? null : (
              <span role="alert" className="text-[13px] text-danger">
                {error}
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <code className="rounded-field border border-border bg-groove px-3 py-2.5 font-mono text-[13px] break-all text-foreground">
              {secret}
            </code>

            <Button
              variant="ghost"
              onClick={() => {
                void copyText(secret).then(setCopied);
              }}
            >
              {isCopied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * You: your profile, your second factor, your sessions, your tokens.
 *
 * Nothing on this page needs a permission. Everything on it is something a person may do to
 * their own account, and the API agrees - `PATCH /users/:userId` lets anyone edit themselves and
 * only asks for `user:manage` when the change is to a role or to whether the account is active,
 * which are the two fields that would let somebody promote themselves.
 *
 * The order is by consequence, descending: who you are and what protects it, then what is
 * currently signed in as you, then what is signed in as you without being you.
 */
import { AccountPanel } from '@/routes/settings/account-panel';
import { SessionsPanel } from '@/routes/settings/sessions-panel';
import { SettingsPage } from '@/routes/settings/settings-ui';
import { TokensPanel } from '@/routes/settings/tokens-panel';

/**
 * Renders the account page.
 *
 * @returns The page.
 */
export function AccountSettings() {
  return (
    <SettingsPage path="/settings/account">
      <AccountPanel />
      <SessionsPanel />
      <TokensPanel />
    </SettingsPage>
  );
}

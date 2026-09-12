import { Panel } from '@nebula-home/ui';

/**
 * One heading over everything that is you.
 *
 * Your name, your password and your authenticator were three panels, and reading down the page
 * meant deciding three times whether the next box was still about your own account or had moved
 * on to the installation. They are one thing from where a person stands - who you are and what
 * proves it - so they are one panel here, in the order they matter: the name on the account,
 * then the secret that opens it, then the second secret that saves the first one from leaking.
 *
 * Sessions and tokens stay separate below, and deliberately: those are not facts about you, they
 * are a list of things currently acting as you, which is a different question and a longer list.
 */
import { ProfileRows } from '@/routes/settings/profile-rows';
import { TwoFactorRow } from '@/routes/settings/two-factor-rows';

/**
 * Renders the account panel.
 *
 * @returns The panel.
 */
export function AccountPanel() {
  return (
    <Panel title="Account">
      <ProfileRows />
      <TwoFactorRow />
    </Panel>
  );
}

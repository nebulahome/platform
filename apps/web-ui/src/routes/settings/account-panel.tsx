import { Panel } from '@nebulahome/ui';

/**
 * Who you are, and what proves it: two panels, as the board draws them.
 *
 * Profile holds the name on the account; Security holds the secret that opens it and the second
 * secret that saves the first one from leaking. They sit one above the other, in the order they
 * matter, so reading down the page never asks whether the next box is still about you.
 *
 * Sessions and tokens stay separate below, and deliberately: those are not facts about you, they
 * are a list of things currently acting as you, which is a different question and a longer list.
 */
import { ProfileRows } from '@/routes/settings/profile-rows';
import { TwoFactorRow } from '@/routes/settings/two-factor-rows';

/**
 * Renders the profile and security panels.
 *
 * @returns The panels.
 */
export function AccountPanel() {
  return (
    <>
      <Panel title="Profile">
        <ProfileRows part="profile" />
      </Panel>
      <Panel title="Security">
        <ProfileRows part="password" />
        <TwoFactorRow />
      </Panel>
    </>
  );
}

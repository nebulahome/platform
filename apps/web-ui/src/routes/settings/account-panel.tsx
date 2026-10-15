import { useTranslation } from 'react-i18next';

import { Panel } from '@nebulahome/ui';

/**
 * Who you are, and what proves it: two panels, as the board draws them.
 *
 * Profile holds the name on the account and the language it reads; Security holds the secret that opens it and the second
 * secret that saves the first one from leaking. They sit one above the other, in the order they
 * matter, so reading down the page never asks whether the next box is still about you.
 *
 * Sessions and tokens stay separate below, and deliberately: those are not facts about you, they
 * are a list of things currently acting as you, which is a different question and a longer list.
 */
import { LanguageRow } from '@/routes/settings/language-row';
import { ProfileRows } from '@/routes/settings/profile-rows';
import { TwoFactorRow } from '@/routes/settings/two-factor-rows';

/**
 * Renders the profile and security panels.
 *
 * @returns The panels.
 */
export function AccountPanel() {
  const { t } = useTranslation();

  return (
    <>
      <Panel title={t('settings.account.profile', 'Profile')}>
        <ProfileRows part="profile" />
        <LanguageRow />
      </Panel>
      <Panel title={t('settings.account.security', 'Security')}>
        <ProfileRows part="password" />
        <TwoFactorRow />
      </Panel>
    </>
  );
}

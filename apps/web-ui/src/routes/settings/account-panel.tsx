import { useTranslation } from 'react-i18next';

import { LanguageRow } from '@/routes/settings/language-row';
import { ProfileRows } from '@/routes/settings/profile-rows';
import { SettingsSection } from '@/routes/settings/settings-ui';
import { TwoFactorRow } from '@/routes/settings/two-factor-rows';

/**
 * Renders who you are, then how you sign in, then the language you are spoken to in.
 *
 * @returns The blocks.
 */
export function AccountPanel() {
  const { t } = useTranslation();

  return (
    <>
      <ProfileRows part="profile" />
      <SettingsSection label={t('settings.account.security', 'Security')}>
        <ProfileRows part="password" />
        <TwoFactorRow />
      </SettingsSection>
      <SettingsSection label={t('settings.language.title', 'Language')}>
        <LanguageRow />
      </SettingsSection>
    </>
  );
}

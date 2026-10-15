/**
 * The language the interface speaks to you: the house's, or one of your own.
 *
 * A fact about the person rather than the browser, so it is kept on the account (unlike the
 * theme, which belongs to the room a screen is in): signing in on the hallway tablet speaks it
 * too. Following the house is a choice of its own, listed first and named with the language it
 * stands for today, because it means something different from picking that language - when the
 * house changes language, a person following it changes with it.
 *
 * Purely what you read: names, states and everything anyone typed stay as they were written.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LOCALE_NAMES, SUPPORTED_LOCALES, isSupportedLocale } from '@nebulahome/contracts';
import { PanelRow, SelectField } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { updateUser } from '@/settings/api';

/** The value of the choice that follows the house. */
const FOLLOW_HOUSE = 'house';

/**
 * Renders the row.
 *
 * @returns The row, or nothing before anybody is signed in.
 */
export function LanguageRow() {
  const { t } = useTranslation();
  const user = useSession((state) => state.user);
  const refreshUser = useSession((state) => state.refreshUser);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (user === undefined) {
    return null;
  }

  const options = [
    {
      value: FOLLOW_HOUSE,
      label: t('settings.language.followHouse', 'House language ({{name}})', {
        name: LOCALE_NAMES[user.houseLocale],
      }),
    },
    ...SUPPORTED_LOCALES.map((locale) => ({ value: locale, label: LOCALE_NAMES[locale] })),
  ];

  /**
   * Saves the choice, then reads the account back, which switches the language.
   *
   * @param value - A language, or the house's.
   */
  const choose = (value: string): void => {
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        await updateUser(user.id, { locale: isSupportedLocale(value) ? value : null });
        await refreshUser();
      } catch (cause: unknown) {
        setError(toMessage(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <PanelRow
      title={t('settings.language.title', 'Language')}
      note={
        error ??
        t(
          'settings.language.note',
          'What the interface speaks to you. Names and anything typed stay as they were written.',
        )
      }
      control={
        <SelectField
          label={t('settings.language.title', 'Language')}
          isLabelHidden
          disabled={isBusy}
          value={user.locale ?? FOLLOW_HOUSE}
          options={options}
          onChange={choose}
          className="w-56"
        />
      }
    />
  );
}

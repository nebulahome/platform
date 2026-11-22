/**
 * The settings of a shortcut: where it goes - a page of the platform, a package's page, or a web
 * address - and, for a web address, the address itself.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { shortcutTargetSchema, type DashboardShortcutCard } from '@nebulahome/contracts';
import { Segmented, SelectField } from '@nebulahome/ui';

import { NAV_PAGES } from '@/components/sidebar';
import { text } from '@/i18n/messages';
import { SettingsField } from '@/routes/dashboard/settings/settings-parts';
import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function ShortcutSettings(props: TypeSettingsProps<DashboardShortcutCard>) {
  const { t } = useTranslation();

  const { card, data, onChange, onSettled } = props;
  const { target } = card;
  const packages = [...data.packageById.values()];
  const [address, setAddress] = useState(target.kind === 'url' ? target.url : 'https://');
  const isAddressValid = shortcutTargetSchema.safeParse({ kind: 'url', url: address }).success;

  /**
   * Points the shortcut somewhere else.
   *
   * @param next - Where it goes.
   */
  const go = (next: DashboardShortcutCard['target']): void => {
    onChange((current) => (current.type === 'shortcut' ? { ...current, target: next } : current));
    onSettled();
  };

  return (
    <>
      <SettingsField label={t('dashboard.shortcutSettings.goesTo', 'Goes to')}>
        <Segmented
          isFilled
          label={t('dashboard.shortcutSettings.goesTo', 'Goes to')}
          options={[
            { value: 'page', label: t('dashboard.shortcutSettings.page', 'A page') },
            ...(packages.length === 0
              ? []
              : [
                  {
                    value: 'package' as const,
                    label: t('dashboard.shortcutSettings.package', 'A package'),
                  },
                ]),
            { value: 'url', label: t('dashboard.shortcutSettings.url', 'An address') },
          ]}
          value={target.kind}
          onChange={(kind) => {
            const first = packages[0];

            if (kind === 'page') {
              go({ kind, path: NAV_PAGES[0]?.to ?? '/dashboards' });
            } else if (kind === 'package' && first !== undefined) {
              go({ kind, packageId: first.id });
            } else if (kind === 'url' && isAddressValid) {
              go({ kind, url: address });
            } else {
              onChange((current) =>
                current.type === 'shortcut'
                  ? { ...current, target: { kind: 'url', url: 'https://example.com' } }
                  : current,
              );
            }
          }}
        />
      </SettingsField>
      {target.kind === 'page' ? (
        <SelectField
          label={t('dashboard.shortcutSettings.whichPage', 'Page')}
          size="compact"
          options={NAV_PAGES.map((page) => ({ value: page.to, label: text(page.label) }))}
          value={target.path}
          onChange={(path) => {
            go({ kind: 'page', path });
          }}
        />
      ) : null}
      {target.kind === 'package' ? (
        <SelectField
          label={t('dashboard.shortcutSettings.whichPackage', 'Package')}
          size="compact"
          options={packages.map((found) => ({ value: found.id, label: found.name }))}
          value={target.packageId}
          onChange={(packageId) => {
            const found = packages.find((each) => each.id === packageId);

            if (found !== undefined) {
              go({ kind: 'package', packageId: found.id });
            }
          }}
        />
      ) : null}
      {target.kind === 'url' ? (
        <SettingsField
          label={t('dashboard.shortcutSettings.address', 'Web address')}
          note={
            isAddressValid
              ? undefined
              : t('dashboard.shortcutSettings.notAnAddress', 'Not an address yet')
          }
        >
          <input
            type="url"
            value={address}
            aria-label={t('dashboard.shortcutSettings.address', 'Web address')}
            aria-invalid={!isAddressValid}
            className="h-10 rounded-tile border border-border-strong bg-surface-raised px-3 font-mono text-ui-sm text-foreground outline-none focus-visible:border-primary focus-visible:shadow-focus aria-invalid:border-warning"
            onChange={(event) => {
              setAddress(event.target.value);

              if (
                shortcutTargetSchema.safeParse({ kind: 'url', url: event.target.value }).success
              ) {
                go({ kind: 'url', url: event.target.value });
              }
            }}
          />
        </SettingsField>
      ) : null}
    </>
  );
}

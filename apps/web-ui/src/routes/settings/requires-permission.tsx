/**
 * What a page shows to somebody who may not open it.
 *
 * The rail already hides sections a person cannot reach, so nobody arrives here by clicking.
 * They arrive by typing an address, by following a link somebody sent them, or by having a role
 * changed while the page was open - and the honest answer to all three is the same sentence.
 *
 * This hides an interface; it does not protect anything. Every request the page would have made
 * is refused by the API on its own account (ARCHITECTURE.md 12.3). What it prevents is a screen
 * of empty panels and a stack of 403s in the console, which reads as a broken page rather than a
 * closed one.
 */
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useSession } from '@/auth/session-store';
import { LockIcon } from '@/components/icons';

/** What the guard needs. */
export type RequiresPermissionProps = {
  /** The permission the page needs. */
  readonly permission: string;

  /** What the section is called, so the refusal can name it. */
  readonly section: string;

  /** The page. */
  readonly children: ReactNode;
};

/**
 * Renders the page, or a refusal.
 *
 * @param props - See {@link RequiresPermissionProps}.
 * @returns Whichever applies.
 */
export function RequiresPermission(props: RequiresPermissionProps) {
  const { t } = useTranslation();
  const { permission, section, children } = props;
  const can = useSession((state) => state.can);

  if (can(permission)) {
    return children;
  }

  return (
    <div className="flex grow items-center justify-center">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-panel border border-dashed border-border-strong p-8 text-center">
        <LockIcon className="text-foreground-subtle" />

        <p className="text-title text-foreground-muted">
          {t('settings.forbidden.title', '{{section}} is not yours to open.', { section })}
        </p>

        <p className="text-caption text-foreground-subtle">
          <Trans
            i18nKey="settings.forbidden.note"
            defaults="It needs <0>{{permission}}</0>, which your role does not grant. An owner or an administrator can change that."
            values={{ permission }}
            components={[<span key="permission" className="font-mono" />]}
          />
        </p>
      </div>
    </div>
  );
}

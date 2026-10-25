/**
 * The two marks a role is recognised by on the roles page and in its dialog's preview: its icon
 * chip, and the tag that says whether it is built in.
 */
import { useTranslation } from 'react-i18next';

import type { IconView } from '@nebulahome/contracts';
import { AppIcon, CatalogueIcon, cn } from '@nebulahome/ui';

/**
 * The glyph a role is drawn with: its own icon, or the role glyph while it is read.
 *
 * @param props - The icon and how it sits.
 * @param props.icon - The catalogue's drawing, when read.
 * @param props.isLit - Tinted `primary`, for the open role and the preview.
 * @returns The chip.
 */
export function RoleChip(props: { readonly icon: IconView | undefined; readonly isLit: boolean }) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-field border transition-colors duration-200',
        props.isLit
          ? 'border-primary/30 bg-primary/14 text-primary'
          : 'border-border-strong bg-surface-raised text-foreground-muted',
      )}
    >
      {props.icon === undefined ? (
        <AppIcon id="shield" size={16} />
      ) : (
        <CatalogueIcon node={props.icon.node} frame={props.icon.frame} size={16} />
      )}
    </span>
  );
}

/**
 * The tag beside a role's name: Built in with a lock, or Custom.
 *
 * @param props - Which.
 * @param props.isBuiltin - Whether the role is built in.
 * @returns The tag.
 */
export function RoleKindTag(props: { readonly isBuiltin: boolean }) {
  const { t } = useTranslation();

  return props.isBuiltin ? (
    <span className="inline-flex h-5.5 items-center gap-1.25 rounded-pill border border-border-strong bg-surface-raised px-2 text-caption font-normal whitespace-nowrap text-foreground-subtle">
      <AppIcon id="lock" size={11} />
      {t('settings.roles.builtIn', 'Built in')}
    </span>
  ) : (
    <span className="inline-flex h-5.5 items-center rounded-pill border border-primary/40 bg-primary/14 px-2 text-caption font-normal whitespace-nowrap text-primary">
      {t('settings.roles.custom', 'Custom')}
    </span>
  );
}

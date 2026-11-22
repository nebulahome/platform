/**
 * What uses an alias or a device's entities, a row per kind: the Delete dialog of an alias, its
 * Used by fold, and every device removal list them the same way.
 */
import type { AliasUsedBy } from '@nebulahome/contracts';
import { AppIcon, type UiIconId } from '@nebulahome/ui';

import { defineMessage, text, type Message } from '@/i18n/messages';

/** Each kind of user, as the Delete dialog and the Used by fold list them. */
export const USED_BY_KINDS: readonly {
  readonly kind: keyof AliasUsedBy;
  readonly icon: UiIconId;
  readonly label: Message;
}[] = [
  {
    kind: 'automations',
    icon: 'zap',
    label: defineMessage('library.aliasUses.automations', 'Automations'),
  },
  { kind: 'scenes', icon: 'layers', label: defineMessage('library.aliasUses.scenes', 'Scenes') },
  {
    kind: 'dashboards',
    icon: 'layout-dashboard',
    label: defineMessage('library.aliasUses.dashboards', 'Dashboards'),
  },
  { kind: 'aliases', icon: 'sigma', label: defineMessage('library.aliasUses.aliases', 'Aliases') },
];

/**
 * The users of an alias, a row per kind: its icon, "Automations · 4" and the names.
 *
 * @param props - What uses it.
 * @param props.usedBy - The users.
 * @returns The rows, or nothing when nothing uses it.
 */
export function UsedByRows(props: { readonly usedBy: AliasUsedBy }) {
  return (
    <>
      {USED_BY_KINDS.filter(({ kind }) => props.usedBy[kind].length > 0).map(
        ({ kind, icon, label }) => (
          <li
            key={kind}
            className="flex items-center gap-3 border-t border-border px-3.5 py-2.5 first:border-t-0"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-raised text-foreground-muted">
              <AppIcon id={icon} size={13} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-ui-sm">
                {text(label)} · {props.usedBy[kind].length}
              </span>
              <span className="truncate text-caption text-foreground-subtle">
                {props.usedBy[kind].map((user) => user.name).join(', ')}
              </span>
            </span>
          </li>
        ),
      )}
    </>
  );
}

/**
 * How many things use an alias.
 *
 * @param usedBy - The users.
 * @returns The count.
 */
export function usedByCount(usedBy: AliasUsedBy): number {
  return USED_BY_KINDS.reduce((sum, { kind }) => sum + usedBy[kind].length, 0);
}

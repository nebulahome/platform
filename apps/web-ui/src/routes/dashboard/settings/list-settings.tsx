/**
 * The settings of a list card, in the floating panel, above its size.
 */
import type { DashboardListCard } from '@nebulahome/contracts';

import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function ListSettings(props: TypeSettingsProps<DashboardListCard>) {
  // shortcut: draws no field until this type's own settings are written.
  return props.isPending ? null : null;
}

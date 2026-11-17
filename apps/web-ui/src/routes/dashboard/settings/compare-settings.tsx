/**
 * The settings of a compare card, in the floating panel, above its size.
 */
import type { DashboardCompareCard } from '@nebulahome/contracts';

import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function CompareSettings(props: TypeSettingsProps<DashboardCompareCard>) {
  // shortcut: draws no field until this type's own settings are written.
  return props.isPending ? null : null;
}

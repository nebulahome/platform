/**
 * The settings of a together card, in the floating panel, above its size.
 */
import type { DashboardTogetherCard } from '@nebulahome/contracts';

import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function TogetherSettings(props: TypeSettingsProps<DashboardTogetherCard>) {
  // shortcut: draws no field until this type's own settings are written.
  return props.isPending ? null : null;
}

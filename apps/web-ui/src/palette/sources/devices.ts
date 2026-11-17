/**
 * Devices in the command palette: found by name, maker, model, area and integration; Enter opens
 * the device's page.
 */
import type { DeviceView } from '@nebulahome/contracts';

import { defineMessage, text } from '@/i18n/messages';
import type { PaletteItem } from '@/palette/palette-types';
import { goTo, makeItem } from '@/palette/sources/make-item';
import { devicePath } from '@/routes/library/device/device-path';

const KIND = defineMessage('palette.kinds.device', 'Device');

/**
 * The devices' rows.
 *
 * @param devices - The devices.
 * @param vendorNames - The integrations' names, by id, for finding a device by its integration.
 * @returns The rows.
 */
export function deviceItems(
  devices: readonly DeviceView[],
  vendorNames: ReadonlyMap<string, string>,
): PaletteItem[] {
  return devices.map((device) =>
    makeItem({
      group: 'devices',
      refId: device.id,
      title: device.name,
      secondary: [[device.manufacturer, device.model].filter(Boolean).join(' '), device.areaName]
        .filter(Boolean)
        .join(' · '),
      kindLabel: text(KIND),
      fields: [device.vendorId, vendorNames.get(device.vendorId), device.driverName],
      icon: { kind: 'catalogue', iconId: device.icon, fallback: 'cpu' },
      isName: true,
      primary: goTo(devicePath(device.id)),
    }),
  );
}

/**
 * Devices in the command palette: found by name, maker, model, area, integration and address (IP,
 * host or MAC, of every way into a linked device); Enter opens the device's page.
 */
import type { DeviceView } from '@nebulahome/contracts';

import { defineMessage, text } from '@/i18n/messages';
import { deviceAddress } from '@/library/vendor-device-filters';
import type { PaletteItem } from '@/palette/palette-types';
import { goTo, makeItem } from '@/palette/sources/make-item';
import { devicePath } from '@/routes/library/device/device-path';

const KIND = defineMessage('palette.kinds.device', 'Device');

/** A MAC address, `aa:bb:cc:dd:ee:ff`, in either case. A Bluetooth device's key is one. */
const MAC = /^[\da-f]{2}(?::[\da-f]{2}){5}$/iu;

/**
 * How a device's addresses can be typed: a MAC also with dashes and with no separators, the way
 * other tools print it; anything else as it is.
 *
 * @param values - Its addresses and ids.
 * @returns What it is found by.
 */
function addressForms(values: readonly (string | null | undefined)[]): string[] {
  return values.flatMap((value) =>
    value === null || value === undefined || value === ''
      ? []
      : MAC.test(value)
        ? [value, value.replaceAll(':', '-'), value.replaceAll(':', '')]
        : [value],
  );
}

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
  return devices.map((device) => {
    const externalMac = MAC.test(device.externalId ?? '') ? device.externalId : null;

    return makeItem({
      group: 'devices',
      refId: device.id,
      title: device.name,
      // The address is shown, so a row found by it says why.
      secondary: [
        [device.manufacturer, device.model].filter(Boolean).join(' '),
        device.areaName,
        deviceAddress(device) ?? externalMac,
      ]
        .filter(Boolean)
        .join(' · '),
      kindLabel: text(KIND),
      fields: [
        device.vendorId,
        vendorNames.get(device.vendorId),
        device.driverName,
        ...addressForms([
          deviceAddress(device),
          device.mac,
          device.externalId,
          ...(device.linked?.ways ?? []).flatMap((way) => [way.address, way.externalId]),
        ]),
      ],
      icon: { kind: 'catalogue', iconId: device.icon, fallback: 'cpu' },
      isName: true,
      primary: goTo(devicePath(device.id)),
    });
  });
}

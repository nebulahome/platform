/**
 * Installed integrations in the command palette: Enter opens the integration, Tab adds a device
 * through it where devices are added by hand and nothing is left to set up. The same is offered as
 * an action, "Add device · Shelly", found only by its verb ("add shelly").
 */
import type { IntegrationVendorView } from '@nebulahome/contracts';

import { defineMessage, text, translate } from '@/i18n/messages';
import type { PaletteItem } from '@/palette/palette-types';
import { goTo, HINTS, makeItem } from '@/palette/sources/make-item';

const KIND = defineMessage('palette.kinds.integration', 'Integration');

/**
 * Whether a device may be added through an integration now: the vendor page's own condition for
 * its Add device button.
 *
 * @param vendor - The integration.
 * @param canWrite - Whether the person may add a device.
 * @returns True when the button would be there and enabled.
 */
export function canAddDeviceThrough(vendor: IntegrationVendorView, canWrite: boolean): boolean {
  return (
    canWrite &&
    vendor.adoption !== 'automatic' &&
    !vendor.needsSetup &&
    !vendor.needsAccount &&
    !vendor.needsPackage
  );
}

/**
 * Where adding a device through an integration starts: its page, with the dialog open.
 *
 * @param vendorId - The integration.
 * @returns The address.
 */
export function addDevicePath(vendorId: string): string {
  return `/integrations/${encodeURIComponent(vendorId)}?add=1`;
}

/**
 * The integrations' rows, and the Add device action of each that takes one.
 *
 * @param vendors - The integrations, as the integrations page lists them.
 * @param canWrite - Whether the person may add a device.
 * @returns The rows: the integrations, then the actions.
 */
export function integrationItems(
  vendors: readonly IntegrationVendorView[],
  canWrite: boolean,
): PaletteItem[] {
  // The platform's own are not listed on the integrations page either.
  const installed = vendors.filter((vendor) => vendor.origin !== 'platform');
  const needsSetup = translate('palette.needsSetup', 'Needs setting up');

  return [
    ...installed.map((vendor) =>
      makeItem({
        group: 'integrations',
        refId: vendor.id,
        title: vendor.name,
        secondary: [
          translate('palette.devices', {
            count: vendor.deviceCount,
            defaultValue_one: '{{count}} device',
            defaultValue_other: '{{count}} devices',
          }),
          vendor.needsSetup || vendor.needsAccount || vendor.needsPackage ? needsSetup : '',
        ]
          .filter(Boolean)
          .join(' · '),
        kindLabel: text(KIND),
        fields: [vendor.description, vendor.id],
        icon: { kind: 'vendor', vendor },
        isName: true,
        primary: goTo(`/integrations/${encodeURIComponent(vendor.id)}`),
        ...(canAddDeviceThrough(vendor, canWrite)
          ? { secondaryAction: goTo(addDevicePath(vendor.id), HINTS.addDevice) }
          : {}),
      }),
    ),
    ...installed
      .filter((vendor) => canAddDeviceThrough(vendor, canWrite))
      .map((vendor) =>
        makeItem({
          group: 'actions',
          refId: `add-device:${vendor.id}`,
          title: translate('palette.actions.addDeviceOf', 'Add device · {{name}}', {
            name: vendor.name,
          }),
          secondary: text(KIND),
          icon: { kind: 'vendor', vendor },
          requiresVerb: true,
          primary: goTo(addDevicePath(vendor.id), HINTS.run),
        }),
      ),
  ];
}

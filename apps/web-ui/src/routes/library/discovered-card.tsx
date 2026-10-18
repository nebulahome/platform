/**
 * One device found on the network: enough to recognise it, and the button to adopt it.
 *
 * Built like a vendor card - the logo top left, the name in the foreground, the facts muted
 * beneath - so a row of them reads as part of the same page. What makes one recognisable is what
 * the device said about itself: the name it was given in its own app, then the model, then where
 * it is, which is what tells two identical relays apart. Its vendor sits small above the name,
 * because on this row the question is "which one is this", not "whose".
 */
import { useTranslation } from 'react-i18next';

import type { DiscoveredDevice, IntegrationVendorView } from '@nebulahome/contracts';
import { Button, cn } from '@nebulahome/ui';

import { defineMessage, type Message, text } from '@/i18n/messages';
import { VendorLogo } from '@/routes/library/vendor-card';

/** What the card needs of the vendor, when the page has it. */
type CardVendor = Pick<IntegrationVendorView, 'id' | 'name' | 'color' | 'logoPadding'> &
  Partial<Pick<IntegrationVendorView, 'logo'>>;

/** What the card needs. */
export type DiscoveredCardProps = {
  readonly device: DiscoveredDevice;

  /** Its vendor, for the logo and the name; undefined before the vendors have loaded. */
  readonly vendor: CardVendor | undefined;

  /** Whether the person may add devices; false leaves the button out. */
  readonly canAdopt: boolean;

  /** Called with the device when Adopt is pressed. */
  readonly onAdopt: (device: DiscoveredDevice) => void;

  /** Whether this device is being moved to where it was found now. */
  readonly isMoving?: boolean;

  /**
   * Called with the device when Move here is pressed, for a device already added that was found
   * at another address.
   */
  readonly onMove?: (device: DiscoveredDevice) => void;
};

/** How a device was heard, in the words on the card. */
const SOURCES: Readonly<Record<DiscoveredDevice['source'], Message>> = {
  mdns: defineMessage('library.discoveredCard.announcedOverMdns', 'Announced over mDNS'),
  module: defineMessage(
    'library.discoveredCard.heardByItsVendor',
    "Heard by its vendor's own listener",
  ),
  matter: defineMessage(
    'library.discoveredCard.onTheMatterFabric',
    "Commissioned on the house's Matter fabric",
  ),
};

/**
 * What the card is called: the device's own name, its model, or its vendor's device.
 *
 * @param device - The device.
 * @param vendorName - Its vendor's name.
 * @returns The title.
 */
export function discoveredTitle(device: DiscoveredDevice, vendorName: string): string {
  return device.name ?? device.model ?? `${vendorName} device`;
}

/**
 * Renders one found device.
 *
 * @param props - See {@link DiscoveredCardProps}.
 * @returns The card, as a list item.
 */
export function DiscoveredCard(props: DiscoveredCardProps) {
  const { t } = useTranslation();

  const { device, vendor, canAdopt, onAdopt, isMoving = false, onMove } = props;
  const vendorName = vendor?.name ?? device.vendorId;
  const title = discoveredTitle(device, vendorName);
  const model = device.model ?? device.modelChoices.join(' · ');

  return (
    <li className="w-66 shrink-0 snap-start list-none">
      <article
        aria-label={title}
        className={cn(
          'flex h-full flex-col rounded-panel border border-border bg-surface p-4.5',
          'transition-colors hover:border-border-strong',
        )}
      >
        <div className="flex items-start gap-3">
          <VendorLogo
            vendor={{
              name: vendorName,
              color: vendor?.color,
              logo: vendor?.logo,
              logoPadding: vendor?.logoPadding ?? 0,
            }}
            size={36}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-caption leading-tight text-foreground-subtle">
              {vendorName}
            </span>
            <span className="truncate text-title font-medium text-foreground">{title}</span>
          </div>
        </div>

        <dl className="mt-4 flex flex-col gap-1.5 text-ui leading-tight">
          {title === model ? null : (
            <div className="flex min-w-0 items-baseline gap-2">
              <dt className="shrink-0 text-foreground-subtle">
                {t('library.discoveredCard.model', 'Model')}
              </dt>
              <dd className="truncate text-foreground-muted">{model}</dd>
            </div>
          )}
          <div className="flex min-w-0 items-baseline gap-2">
            <dt className="shrink-0 text-foreground-subtle">
              {t('library.discoveredCard.address', 'Address')}
            </dt>
            <dd className="truncate font-mono text-mono-ui text-foreground-muted tabular">
              {device.address}
            </dd>
          </div>
          {device.movedFrom === null ? null : (
            <div className="flex min-w-0 items-baseline gap-2">
              <dt className="shrink-0 text-foreground-subtle">
                {t('library.discoveredCard.addedAt', 'Added at')}
              </dt>
              <dd className="truncate text-warning tabular">{device.movedFrom.address}</dd>
            </div>
          )}
        </dl>

        <span className="grow" />

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="truncate text-caption text-foreground-subtle">
            {device.movedFrom === null
              ? text(SOURCES[device.source])
              : t(
                  'library.discoveredCard.alreadyAddedItsAddress',
                  'Already added; its address changed',
                )}
          </span>
          {!canAdopt ? null : device.movedFrom === null ? (
            <Button
              size="compact"
              aria-label={t('library.discoveredCard.adoptTitle', 'Adopt {{title}}', { title })}
              onClick={() => {
                onAdopt(device);
              }}
            >
              {t('library.discoveredCard.adopt', 'Adopt')}
            </Button>
          ) : onMove === undefined ? null : (
            <Button
              size="compact"
              aria-label={t(
                'library.discoveredCard.moveTitleToAddress',
                'Move {{title}} to {{address}}',
                { title, address: device.address },
              )}
              isBusy={isMoving}
              onClick={() => {
                onMove(device);
              }}
            >
              {t('library.discoveredCard.moveHere', 'Move here')}
            </Button>
          )}
        </div>
      </article>
    </li>
  );
}

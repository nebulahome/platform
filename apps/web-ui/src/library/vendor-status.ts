/**
 * How an integration stands, in a word: what its tile's Pill says, what its page's Runtime card
 * says, and what the filter of the integrations page narrows by.
 *
 * Read from what the vendor view already carries, in the order a person needs it: a package or a
 * container it depends on not running is a fault in the house (Degraded); an account nobody
 * signed in to, or settings nobody gave, is something to do (Needs sign-in, Needs setup); with
 * devices it is Running; without any it is Idle - loaded, and waiting to be given a device. Its
 * containers are not looked at while it needs setting up: they are made from those settings.
 *
 * Pure, so the tile, the page and the filter agree, and a test can hold them to it.
 */
import type { IntegrationVendorView } from '@nebulahome/contracts';
import type { PillTone } from '@nebulahome/ui';

import { defineMessage, type Message, text, translate } from '@/i18n/messages';

/** Each standing, in the order the filter lists them. */
export const VENDOR_STATUS_KINDS = [
  'running',
  'degraded',
  'needs-sign-in',
  'needs-setup',
  'idle',
] as const;

/** One standing. */
export type VendorStatusKind = (typeof VENDOR_STATUS_KINDS)[number];

/** What each standing is called. */
export const VENDOR_STATUS_LABELS: Readonly<Record<VendorStatusKind, Message>> = {
  running: defineMessage('library.vendorStatus.running', 'Running'),
  degraded: defineMessage('library.vendorStatus.degraded', 'Degraded'),
  'needs-sign-in': defineMessage('library.vendorStatus.needsSignIn', 'Needs sign-in'),
  'needs-setup': defineMessage('library.vendorStatus.needsSetup', 'Needs setup'),
  idle: defineMessage('library.vendorStatus.idle', 'Idle'),
};

/** What each standing looks like. */
export const VENDOR_STATUS_TONES: Readonly<Record<VendorStatusKind, PillTone>> = {
  running: 'success',
  degraded: 'warning',
  'needs-sign-in': 'warning',
  'needs-setup': 'warning',
  idle: 'neutral',
};

/** How a vendor stands, and why in a line. */
export type VendorStatus = {
  readonly kind: VendorStatusKind;
  readonly label: string;
  readonly tone: PillTone;

  /** One line saying why: the problem, or what it is doing. */
  readonly detail: string;
};

/** What the standing is read from. */
type StatusInput = Pick<
  IntegrationVendorView,
  | 'needsPackage'
  | 'packageProblems'
  | 'containerStatuses'
  | 'needsAccount'
  | 'account'
  | 'needsSetup'
  | 'deviceCount'
>;

/**
 * Says how a vendor stands.
 *
 * @param vendor - As the list serves it.
 * @returns Its standing.
 */
export function vendorStatusOf(vendor: StatusInput): VendorStatus {
  /**
   * The standing, with its name and colour.
   *
   * @param kind - Which.
   * @param detail - Why.
   * @returns The standing.
   */
  const status = (kind: VendorStatusKind, detail: string): VendorStatus => ({
    kind,
    label: text(VENDOR_STATUS_LABELS[kind]),
    tone: VENDOR_STATUS_TONES[kind],
    detail,
  });

  if (vendor.needsPackage) {
    return status(
      'degraded',
      vendor.packageProblems[0] ??
        translate('library.vendorStatus.packageItNeedsIs', 'A package it needs is not running'),
    );
  }

  // Not while it needs setting up: the supervisor makes the containers from the settings, so a
  // vendor nobody set up has none, and "its container is missing" would send the person after
  // the wrong thing.
  const container = vendor.needsSetup
    ? undefined
    : vendor.containerStatuses.find((each) => each?.state !== 'running');

  if (container !== undefined) {
    return status(
      'degraded',
      container === null
        ? translate(
            'library.vendorStatus.supervisorDidNotSay',
            'The supervisor did not say how its container stands',
          )
        : (container.error ??
            translate('library.vendorStatus.itsContainerIsState', 'Its container is {{state}}', {
              state: container.state,
            })),
    );
  }

  if (vendor.needsAccount) {
    return status(
      'needs-sign-in',
      vendor.account === null
        ? translate('library.vendorStatus.signInToItsAccount', 'Sign in to its account')
        : translate('library.vendorStatus.signInTo', 'Sign in to {{name}}', {
            name: vendor.account.name,
          }),
    );
  }

  if (vendor.needsSetup) {
    return status(
      'needs-setup',
      translate(
        'library.vendorStatus.itNeedsTheSettings',
        'It needs the settings every device shares',
      ),
    );
  }

  return vendor.deviceCount > 0
    ? status(
        'running',
        translate('library.vendorStatus.loadedAndAnswering', 'Loaded and answering'),
      )
    : status(
        'idle',
        translate('library.vendorStatus.loadedWithNoDevice', 'Loaded, with no device added yet'),
      );
}

/**
 * What an integration suggests on its Overview: devices that look like one reached two ways, and
 * what it found on the network that the house does not have.
 *
 * A twin's row says which device is also reached the other way and why it looks like the same
 * one - the same MAC address, serial number, model - with "Link them…", which asks on that
 * device's page, and a × that keeps them separate. Those kept separate are hidden behind "↺ n
 * dismissed" in the corner, which shows them again with the day they were set aside, to restore.
 * The found row counts the devices found and those new since yesterday, and leads to Found.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  MATTER_TRANSPORT,
  type DiscoveredDevice,
  type IntegrationVendorView,
  type LinkSuggestionView,
} from '@nebulahome/contracts';
import { AppIcon, Button, IconButton, ListRow, RowList, Section } from '@nebulahome/ui';

import { dateTimeFormat, listFormat } from '@/i18n/formatters';
import { dismissLinkSuggestion, fetchLinkSuggestions, LINK_QUERY_KEYS } from '@/library/links-api';
import { devicePath } from '@/routes/library/device/device-path';
import { useVendorsById, wayName } from '@/routes/library/transport-marks';

/** What the section needs. */
export type VendorSuggestionsProps = {
  readonly vendor: IntegrationVendorView;

  /** Its devices found on the network that nobody has added. */
  readonly found: readonly DiscoveredDevice[];

  /** Whether the person may link devices and set suggestions aside. */
  readonly canLink: boolean;

  /** Opens the Found tab. */
  readonly onReviewFound: () => void;
};

/**
 * Renders the section; nothing when there is nothing to suggest.
 *
 * @param props - See {@link VendorSuggestionsProps}.
 * @returns The section.
 */
export function VendorSuggestions(props: VendorSuggestionsProps) {
  const { t } = useTranslation();
  const { vendor, found, canLink, onReviewFound } = props;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const vendors = useVendorsById();
  const [isShowingDismissed, setShowingDismissed] = useState(false);

  const suggestions = useQuery({
    queryKey: [...LINK_QUERY_KEYS.suggestions, vendor.id],

    /**
     * Reads the vendor's offers to link two of its devices.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The offers, set aside or not.
     */
    queryFn: async ({ signal }) => fetchLinkSuggestions(vendor.id, signal),
  });
  const setAside = useMutation({
    /**
     * Keeps two apart, or offers them again.
     *
     * @param change - Which, and which way.
     * @param change.id - The suggestion.
     * @param change.isDismissed - Whether it is set aside.
     * @returns Once done.
     */
    mutationFn: async (change: { readonly id: string; readonly isDismissed: boolean }) =>
      dismissLinkSuggestion(change.id, change.isDismissed),

    /** Reads the offers again. */
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: LINK_QUERY_KEYS.suggestions });
    },
  });

  const all = suggestions.data ?? [];
  const dismissed = all.filter((each) => each.dismissedAt !== null);
  const shown = all.filter((each) => each.dismissedAt === null || isShowingDismissed);
  const fresh = found.filter((each) => each.notes.includes('new')).length;

  if (shown.length === 0 && found.length === 0 && dismissed.length === 0) {
    return null;
  }

  /**
   * Why two devices look like one, in a sentence.
   *
   * @param suggestion - The offer.
   * @returns The sentence.
   */
  const whyOf = (suggestion: LinkSuggestionView): string => {
    const alike = listFormat({ type: 'conjunction' }).format(
      suggestion.reasons.map((reason) =>
        reason.kind === 'mac'
          ? t('library.vendorSuggestions.macAddress', 'MAC address')
          : reason.kind === 'serial'
            ? t('library.vendorSuggestions.serialNumber', 'serial number')
            : t('library.vendorSuggestions.model', 'model'),
      ),
    );
    const twin = suggestion.twin.model ?? suggestion.twin.name;
    const line =
      suggestion.twin.transport === MATTER_TRANSPORT
        ? t(
            'library.vendorSuggestions.sameAsMatter',
            'Same {{alike}} as the Matter node {{twin}}.',
            {
              alike,
              twin,
            },
          )
        : t('library.vendorSuggestions.sameAs', 'Same {{alike}} as {{twin}}.', { alike, twin });

    return suggestion.dismissedAt === null
      ? line
      : `${line} ${t('library.vendorSuggestions.keptSeparate', 'Kept separate on {{date}}.', {
          date: dateTimeFormat({ day: 'numeric', month: 'long' }).format(suggestion.dismissedAt),
        })}`;
  };

  return (
    <Section
      title={t('library.vendorSuggestions.suggestions', 'Suggestions')}
      actions={
        dismissed.length === 0 ? undefined : (
          <button
            type="button"
            aria-pressed={isShowingDismissed}
            className="inline-flex items-center gap-1.5 text-caption text-foreground-muted transition-colors hover:text-foreground"
            onClick={() => {
              setShowingDismissed(!isShowingDismissed);
            }}
          >
            <AppIcon id="rotate-ccw-clock" size={13} />
            {t('library.vendorSuggestions.dismissedCount', '{{count}} dismissed', {
              count: dismissed.length,
            })}
          </button>
        )
      }
    >
      <RowList>
        {shown.map((suggestion) => (
          <ListRow
            key={suggestion.id}
            icon={<AppIcon id="link-2" size={18} className="text-primary" />}
            title={
              suggestion.twin.transport === MATTER_TRANSPORT
                ? t('library.vendorSuggestions.alsoOnMatter', '{{name}} is also on Matter', {
                    name: suggestion.device.name,
                  })
                : t(
                    'library.vendorSuggestions.alsoThrough',
                    '{{name}} is also reached through {{way}}',
                    {
                      name: suggestion.device.name,
                      way: wayName(suggestion.twin, vendors, t('library.matterTag', 'Matter')),
                    },
                  )
            }
            subtitle={whyOf(suggestion)}
            trailing={
              canLink ? (
                <>
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => {
                      void navigate(
                        `${devicePath(suggestion.device.id)}?link=${encodeURIComponent(suggestion.twin.id)}`,
                      );
                    }}
                  >
                    <AppIcon id="link-2" size={14} />
                    {t('library.vendorSuggestions.linkThem', 'Link them…')}
                  </Button>
                  {suggestion.dismissedAt === null ? (
                    <IconButton
                      size="small"
                      label={t('library.vendorSuggestions.keepSeparate', 'Keep them separate')}
                      onClick={() => {
                        setAside.mutate({ id: suggestion.id, isDismissed: true });
                      }}
                    >
                      <AppIcon id="x" size={15} />
                    </IconButton>
                  ) : (
                    <Button
                      variant="bare"
                      size="compact"
                      onClick={() => {
                        setAside.mutate({ id: suggestion.id, isDismissed: false });
                      }}
                    >
                      {t('library.vendorSuggestions.restore', 'Restore')}
                    </Button>
                  )}
                </>
              ) : undefined
            }
          />
        ))}
        {found.length === 0 ? null : (
          <ListRow
            icon={<AppIcon id="radio" size={18} className="text-cyan" />}
            title={t('library.vendorSuggestions.foundCount', {
              count: found.length,
              defaultValue_one: '{{count}} device found on your network',
              defaultValue_other: '{{count}} devices found on your network',
            })}
            subtitle={
              fresh === 0
                ? t('library.vendorSuggestions.notInHouse', 'Not in the house yet')
                : t(
                    'library.vendorSuggestions.notInHouseNew',
                    'Not in the house yet · {{count}} new since yesterday',
                    { count: fresh },
                  )
            }
            trailing={
              <Button variant="ghost" size="compact" onClick={onReviewFound}>
                <AppIcon id="chevron-right" size={14} />
                {t('library.vendorSuggestions.review', 'Review')}
              </Button>
            }
          />
        )}
      </RowList>
    </Section>
  );
}

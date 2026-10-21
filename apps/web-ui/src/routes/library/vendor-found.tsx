/**
 * The Found tab of an integration's page: what it found on the network that the house does not
 * have, as a table to go through.
 *
 * Each row is the model with its glyph, the address and the MAC in mono, a note when there is
 * something to know - new since yesterday, also reached through Matter, a device that sleeps and
 * wakes to answer, one that needs a password - when it was last heard, and Adopt. Rows can be
 * ticked, all of a page at once, and adopted or dismissed together. Adopting needs no dialog: a
 * device comes in under its model's name, with no room, and a toast says so and leads to the
 * Devices tab to name them. A device the house has, found at another address, offers Move here.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DiscoveredDevice, IntegrationVendorView } from '@nebulahome/contracts';
import { AppIcon, Button, Checkbox, cn, TableFooter, toast, type UiIconId } from '@nebulahome/ui';

import { listFormat } from '@/i18n/formatters';
import { toMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/format-time';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { adoptFound, dismissFound, fetchFound, LINK_QUERY_KEYS } from '@/library/links-api';
import { DeviceIcon, useCatalogueIcons } from '@/routes/library/device-icon';
import { useMoveDevice } from '@/routes/library/use-move-device';

/** The sizes a page of the table can be. */
const SIZES = [10, 20, 50] as const;

/** What a note says and looks like, the first that applies shown. */
const NOTES: readonly {
  readonly note: DiscoveredDevice['notes'][number];
  readonly icon: UiIconId | null;
  readonly tone: string;
}[] = [
  { note: 'password', icon: 'lock', tone: 'text-warning' },
  { note: 'also-on-matter', icon: 'link-2', tone: 'text-primary' },
  { note: 'wakes', icon: 'hourglass', tone: 'text-foreground-subtle' },
  { note: 'new', icon: null, tone: 'text-primary' },
];

/** What the tab needs. */
export type VendorFoundProps = {
  readonly vendor: IntegrationVendorView;

  /** Whether the person may add devices. */
  readonly canAdopt: boolean;

  /** Opens the Devices tab. */
  readonly onOpenDevices: () => void;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link VendorFoundProps}.
 * @returns The tab's content.
 */
export function VendorFound(props: VendorFoundProps) {
  const { t } = useTranslation();
  const { vendor, canAdopt, onOpenDevices } = props;
  const queryClient = useQueryClient();
  const mover = useMoveDevice();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(SIZES[0]);

  const found = useQuery({
    queryKey: [...LINK_QUERY_KEYS.found, vendor.id],

    /**
     * Reads what the vendor found.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the tab goes away.
     * @returns What it found.
     */
    queryFn: async ({ signal }) => fetchFound(vendor.id, signal),
  });
  const rows = (found.data ?? []).filter((each) => !each.isDismissed);
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const shownPage = Math.min(page, pageCount);
  const shown = rows.slice((shownPage - 1) * size, shownPage * size);
  const chosen = rows.filter((each) => picked.has(each.id));
  const icons = useCatalogueIcons(
    rows.map(
      (each) => vendor.drivers.find((driver) => driver.id === each.kind)?.defaultIcon ?? null,
    ),
  );

  /** Reads every list a found device moves between. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: LINK_QUERY_KEYS.found });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.discovered });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
  };

  const adopt = useMutation({
    /**
     * Adopts them, each under its model's name.
     *
     * @param ids - Which.
     * @returns What became of each.
     */
    mutationFn: async (ids: readonly string[]) => adoptFound(ids),

    /**
     * Says which came in, and reads the lists again.
     *
     * @param items - What became of each.
     */
    onSuccess: (items) => {
      const adopted = items.flatMap((item) =>
        item.deviceId === null ? [] : [item.name ?? item.deviceId],
      );
      const failed = items.filter((item) => item.error !== null);

      if (adopted.length > 0) {
        toast.success({
          title: t('library.vendorFound.adoptedJustNow', {
            count: adopted.length,
            defaultValue_one: '{{count}} adopted just now',
            defaultValue_other: '{{count}} adopted just now',
          }),
          message: t(
            'library.vendorFound.underModelName',
            '{{names}} are in Devices under their model name. Give them a name and a room there.',
            { names: listFormat({ type: 'conjunction' }).format(adopted) },
          ),
          action: {
            label: t('library.vendorFound.openDevices', 'Open Devices'),
            onSelect: onOpenDevices,
          },
        });
      }
      if (failed.length > 0) {
        toast.warning({
          title: t('library.vendorFound.notAdopted', {
            count: failed.length,
            defaultValue_one: '{{count}} not adopted',
            defaultValue_other: '{{count}} not adopted',
          }),
          message: failed.map((item) => `${item.name ?? item.id}: ${item.error ?? ''}`).join(' · '),
        });
      }
      setPicked(new Set());
      refresh();
    },

    /**
     * Says why none came in.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('library.vendorFound.adoptFailed', 'Couldn’t adopt them'),
        message: toMessage(error),
      });
    },
  });

  const dismiss = useMutation({
    /**
     * Sets them aside.
     *
     * @param ids - Which.
     * @returns How many the hub still had.
     */
    mutationFn: async (ids: readonly string[]) => dismissFound(ids, true),

    /** Forgets the ticks and reads the lists again. */
    onSuccess: () => {
      setPicked(new Set());
      refresh();
    },

    /**
     * Says why they are still there.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('library.vendorFound.dismissFailed', 'Couldn’t dismiss them'),
        message: toMessage(error),
      });
    },
  });

  /**
   * Ticks or unticks rows.
   *
   * @param ids - Which.
   * @param isPicked - Which way.
   */
  const pick = (ids: readonly string[], isPicked: boolean): void => {
    setPicked((before) => {
      const after = new Set(before);

      for (const id of ids) {
        if (isPicked) {
          after.add(id);
        } else {
          after.delete(id);
        }
      }

      return after;
    });
  };

  const pageIds = shown.filter((each) => each.movedFrom === null).map((each) => each.id);
  const pickedOnPage = pageIds.filter((id) => picked.has(id)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ui text-foreground-muted">
          <span className="font-medium text-foreground tabular">{rows.length}</span>{' '}
          {t('library.vendorFound.foundOnNetwork', 'found on your network')}
          {chosen.length === 0 ? null : (
            <>
              {' · '}
              <span className="font-medium text-foreground tabular">{chosen.length}</span>{' '}
              {t('library.vendorFound.selected', 'selected')}
            </>
          )}
        </p>
        {canAdopt && chosen.length > 0 ? (
          <span className="flex items-center gap-2">
            <Button
              variant="ghost"
              isBusy={dismiss.isPending}
              onClick={() => {
                dismiss.mutate(chosen.map((each) => each.id));
              }}
            >
              <AppIcon id="x" size={15} />
              {t('library.vendorFound.dismissCount', 'Dismiss {{count}}', { count: chosen.length })}
            </Button>
            <Button
              isBusy={adopt.isPending}
              onClick={() => {
                adopt.mutate(chosen.map((each) => each.id));
              }}
            >
              <AppIcon id="plus" size={15} />
              {t('library.vendorFound.adoptCount', 'Adopt {{count}}', { count: chosen.length })}
            </Button>
          </span>
        ) : null}
      </div>

      {found.isPending ? (
        <p className="text-ui text-foreground-subtle">
          {t('library.vendorFound.reading', 'Reading…')}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong px-5.5 py-4 text-ui text-foreground-muted">
          {t(
            'library.vendorFound.nothingFound',
            'Nothing of {{name}} found that the house does not have.',
            { name: vendor.name },
          )}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-200 border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="w-12 py-3.5 pl-5">
                  {canAdopt ? (
                    <Checkbox
                      label={
                        <span className="sr-only">
                          {t('library.vendorFound.pickPage', 'Pick every row of the page')}
                        </span>
                      }
                      isChecked={pickedOnPage > 0 && pickedOnPage === pageIds.length}
                      isMixed={pickedOnPage > 0 && pickedOnPage < pageIds.length}
                      onChange={(isPicked) => {
                        pick(pageIds, isPicked);
                      }}
                    />
                  ) : null}
                </th>
                {[
                  t('library.vendorFound.model', 'Model'),
                  t('library.vendorFound.address', 'Address'),
                  t('library.vendorFound.mac', 'MAC'),
                  '',
                  t('library.vendorFound.seen', 'Seen'),
                  '',
                ].map((heading, index) => (
                  <th
                    // The headings are fixed, in order.
                    // eslint-disable-next-line react/no-array-index-key -- see above
                    key={index}
                    scope="col"
                    className="py-3.5 pr-4 font-mono text-label font-normal text-foreground-subtle uppercase"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const icon = vendor.drivers.find((driver) => driver.id === row.kind)?.defaultIcon;
                const note = NOTES.find((each) => row.notes.includes(each.note));
                const model = row.model ?? row.name ?? row.modelChoices[0] ?? row.kind;

                return (
                  <tr key={row.id} className="border-t border-border first:border-t-0">
                    <td className="py-3 pl-5">
                      {canAdopt && row.movedFrom === null ? (
                        <Checkbox
                          label={<span className="sr-only">{model}</span>}
                          isChecked={picked.has(row.id)}
                          onChange={(isPicked) => {
                            pick([row.id], isPicked);
                          }}
                        />
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="flex items-center gap-3">
                        <span className="flex size-7.5 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-muted">
                          <DeviceIcon
                            icon={icon === undefined ? undefined : icons.get(icon)}
                            size={15}
                          />
                        </span>
                        <span className="text-ui font-medium text-foreground">{model}</span>
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-mono-ui text-foreground">
                      {row.address}
                    </td>
                    <td className="py-3 pr-4 font-mono text-mono-caption text-foreground-muted">
                      {row.mac?.toUpperCase() ?? '—'}
                    </td>
                    <td className="py-3 pr-4">
                      {row.movedFrom === null ? (
                        note === undefined ? null : (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 text-caption whitespace-nowrap',
                              note.tone,
                              note.icon === null &&
                                'h-6 rounded-pill border border-border-strong px-2.5',
                            )}
                          >
                            {note.icon === null ? (
                              <span
                                aria-hidden="true"
                                className="size-1.5 rounded-full bg-primary"
                              />
                            ) : (
                              <AppIcon id={note.icon} size={13} />
                            )}
                            {note.note === 'new'
                              ? t('library.vendorFound.new', 'New')
                              : note.note === 'also-on-matter'
                                ? t('library.vendorFound.alsoOnMatter', 'Also on Matter')
                                : note.note === 'wakes'
                                  ? t('library.vendorFound.wakes', 'Wakes to answer')
                                  : t('library.vendorFound.password', 'Password')}
                          </span>
                        )
                      ) : (
                        <span className="text-caption text-warning">
                          {t('library.vendorFound.wasAt', 'Was at {{address}}', {
                            address: row.movedFrom.address,
                          })}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-ui-sm whitespace-nowrap text-foreground-muted">
                      {relativeTime(row.lastSeenAt)}
                    </td>
                    <td className="py-3 pr-5 text-right">
                      {!canAdopt ? null : row.movedFrom === null ? (
                        <Button
                          variant="ghost"
                          size="compact"
                          isBusy={
                            adopt.isPending &&
                            adopt.variables.length === 1 &&
                            adopt.variables[0] === row.id
                          }
                          onClick={() => {
                            adopt.mutate([row.id]);
                          }}
                        >
                          {t('library.vendorFound.adopt', 'Adopt')}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="compact"
                          isBusy={mover.movingId === row.id}
                          onClick={() => {
                            mover.move(row);
                          }}
                        >
                          {t('library.vendorFound.moveHere', 'Move here')}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TableFooter
            page={shownPage}
            size={size}
            total={rows.length}
            sizes={SIZES}
            onPage={setPage}
            onSize={(next) => {
              setSize(next);
              setPage(1);
            }}
          />
        </div>
      )}
    </div>
  );
}

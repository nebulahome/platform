/**
 * The Matter broker's Devices tab: every device of the fabric, in one panel.
 *
 * All, Online or Linked, with how many of each, and a search over names, models and rooms. A
 * bridge's row folds and unfolds the devices behind it, which hang from a line beside the icons;
 * a bridge stays when one of its devices matches. A row opens the device's page, which is where a
 * device is removed from.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MatterIdentity } from '@nebulahome/contracts';
import { RowList, Segmented } from '@nebulahome/ui';

import { foldForSearch } from '@/lib/search-text';
import {
  everyRow,
  MatterDeviceRow,
  type MatterRow,
} from '@/routes/library/broker-matter/matter-rows';
import type { DeviceIcons } from '@/routes/library/device-icon';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';

/** Which devices show. */
type Shown = 'all' | 'online' | 'linked';

/** What the tab needs. */
export type MatterDevicesProps = {
  readonly rows: readonly MatterRow[];
  readonly icons: DeviceIcons;
  readonly vendorNames: ReadonlyMap<string, string>;

  /** Adds a device taken out of the house back; absent when the person may not. */
  readonly onRestore?: (identity: MatterIdentity) => void;
  readonly isRestoring: boolean;

  /** Takes a node off the fabric; absent when the person may not. */
  readonly onLeave?: (nodeId: string) => void;
  readonly isLeaving: boolean;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link MatterDevicesProps}.
 * @returns The tab's content.
 */
export function MatterDevices(props: MatterDevicesProps) {
  const { t } = useTranslation();
  const { rows, icons, vendorNames, onRestore, isRestoring, onLeave, isLeaving } = props;
  const [shown, setShown] = useState<Shown>('all');
  const [search, setSearch] = useState('');
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const all = everyRow(rows).filter((row) => !row.device.isRemoved);
  const needle = foldForSearch(search.trim());

  /**
   * Whether a row is one the filter and the search keep.
   *
   * @param row - The row.
   * @returns True to show it.
   */
  const isKept = (row: MatterRow): boolean =>
    (shown === 'all' || (shown === 'online' ? row.node.isAvailable : row.view?.linked != null)) &&
    (needle === '' || foldForSearch([row.name, ...row.parts].join(' ')).includes(needle));

  const kept = rows.flatMap((row) => {
    const children = row.children.filter((child) => child.device.isRemoved || isKept(child));
    const isBridgeKept = isKept(row) || children.some((child) => !child.device.isRemoved);

    return isBridgeKept ? [{ row, children }] : [];
  });
  /**
   * How many devices a choice shows, before the search.
   *
   * @param what - The choice.
   * @returns The count.
   */
  const count = (what: Shown): number =>
    what === 'all'
      ? all.length
      : all.filter((row) => (what === 'online' ? row.node.isAvailable : row.view?.linked != null))
          .length;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t('brokers.matter.show', 'Show')}
          value={shown}
          onChange={setShown}
          options={[
            {
              value: 'all',
              label: t('brokers.matter.showAll', 'All · {{count}}', { count: count('all') }),
            },
            {
              value: 'online',
              label: t('brokers.matter.showOnline', 'Online · {{count}}', {
                count: count('online'),
              }),
            },
            {
              value: 'linked',
              label: t('brokers.matter.showLinked', 'Linked · {{count}}', {
                count: count('linked'),
              }),
            },
          ]}
        />
        <SearchField
          className="w-65 lg:w-65"
          placeholder={t('brokers.matter.search', 'Search Matter devices')}
          value={search}
          onChange={setSearch}
        />
      </div>
      {rows.length === 0 ? (
        <p className="text-ui text-foreground-subtle">
          {t(
            'brokers.matter.noNodes',
            'No Matter device yet. Add one with the code its app shares.',
          )}
        </p>
      ) : kept.length === 0 ? (
        <NoMatches
          query={search}
          onClear={() => {
            setSearch('');
            setShown('all');
          }}
        />
      ) : (
        <RowList>
          {kept.flatMap(({ row, children }) => {
            const isOpen = !folded.has(row.key);
            /**
             * How a row adds its device back, when the person may.
             *
             * @param each - The row.
             * @returns Its props for that.
             */
            const restore = (each: MatterRow) => ({
              ...(onRestore === undefined
                ? {}
                : {
                    /** Adds it back. */
                    onRestore: () => {
                      onRestore(each.device.identity);
                    },
                    isRestoring,
                  }),

              // A node nothing of which is in the house any more, still on the fabric: it did
              // not leave by itself, so it can be sent off by hand.
              ...(onLeave === undefined ||
              each.device.identity.endpoint !== null ||
              !each.node.devices.every((device) => device.isRemoved || device.deviceId === null)
                ? {}
                : {
                    /** Takes it off the fabric. */
                    onLeave: () => {
                      onLeave(each.node.nodeId);
                    },
                    isLeaving,
                  }),
            });

            return [
              <MatterDeviceRow
                key={row.key}
                row={row}
                icons={icons}
                vendorNames={vendorNames}
                isTagged
                {...restore(row)}
                {...(row.children.length === 0
                  ? {}
                  : {
                      isOpen,
                      /** Folds or unfolds the bridge. */
                      onToggle: () => {
                        setFolded((before) => {
                          const after = new Set(before);

                          if (after.has(row.key)) {
                            after.delete(row.key);
                          } else {
                            after.add(row.key);
                          }

                          return after;
                        });
                      },
                    })}
              />,
              ...(isOpen
                ? children.map((child, index) => (
                    <MatterDeviceRow
                      key={child.key}
                      row={child}
                      icons={icons}
                      vendorNames={vendorNames}
                      isTagged
                      hang={index === children.length - 1 ? 'last' : 'middle'}
                      {...restore(child)}
                    />
                  ))
                : []),
            ];
          })}
        </RowList>
      )}
    </div>
  );
}

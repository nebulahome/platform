/**
 * The Modbus broker's settings, opened from the button in the page's header: whether the network
 * is searched for Modbus servers, where, and how often.
 *
 * The switch has how the last search went under it. With the search on, the owner gives the
 * ranges to search - a network, a span, or one address, each said how many addresses it holds -
 * or none, for the networks the hub is on. Saving with the search on starts one at once, which the
 * toast says; a refusal stays in the dialog.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ipv4RangeOf,
  MODBUS_SEARCH_MAXIMUM,
  type ModbusSearchRun,
  type ModbusSettings,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  IconButton,
  Modal,
  PanelRow,
  Switch,
  TextField,
  toast,
} from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { toMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/format-time';
import { saveModbusSettings } from '@/library/modbus-api';

/** What the dialog needs. */
export type ModbusSettingsDialogProps = {
  readonly isOpen: boolean;
  readonly saved: ModbusSettings;
  readonly lastRun: ModbusSearchRun | null;
  readonly onClose: () => void;
};

/**
 * How many addresses of a range are searched.
 *
 * @param range - The range, as written.
 * @returns The count; 0 for one that is not a range.
 */
function sizeOf(range: string): number {
  const span = ipv4RangeOf(range);
  const size = span === null ? 0 : span.last - span.first + 1;

  // A network's own address and its broadcast are not searched: a /24 is 254 hosts.
  return range.includes('/') && size > 2 ? size - 2 : size;
}

/**
 * Renders the dialog. Keyed by its opening, so each opening starts from what is saved.
 *
 * @param props - See {@link ModbusSettingsDialogProps}.
 * @returns The dialog.
 */
export function ModbusSettingsDialog(props: ModbusSettingsDialogProps) {
  const { isOpen, saved, lastRun, onClose } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ModbusSettings>(saved);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | undefined>(undefined);
  const [minutes, setMinutes] = useState(String(saved.intervalMinutes));
  const count = numberFormat({ maximumFractionDigits: 0 });
  const total = draft.ranges.reduce((sum, range) => sum + sizeOf(range), 0);
  const interval = Number(minutes);
  const isIntervalValid = Number.isInteger(interval) && interval >= 15 && interval <= 1440;
  const next: ModbusSettings = { ...draft, intervalMinutes: isIntervalValid ? interval : 120 };
  const isChanged = JSON.stringify(next) !== JSON.stringify(saved);
  const save = useMutation({
    /**
     * Saves the settings.
     *
     * @returns Where the broker stands then.
     */
    mutationFn: async () => saveModbusSettings(next),

    /** Says so, and closes. */
    onSuccess: () => {
      toast.success({
        title: next.isSearchEnabled
          ? total === 0
            ? t('brokers.modbus.savedSearchingOwn', 'Saved. Searching the hub’s networks now.')
            : t('brokers.modbus.savedSearching', 'Saved. Searching {{addresses}} addresses now.', {
                addresses: count.format(total),
              })
          : t('brokers.modbus.settingsSaved', 'Settings saved'),
      });
      onClose();
    },

    /** Reads the broker again. */
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['brokers'] });
    },
  });

  /** Adds the range typed, when it is one. */
  const addRange = (): void => {
    const range = typed.trim();

    if (ipv4RangeOf(range) === null) {
      setTypedError(
        t(
          'brokers.modbus.notRange',
          'Not a range: write 10.0.0.0/24, 10.0.0.20-10.0.0.40 or 10.0.0.7.',
        ),
      );

      return;
    }

    if (total + sizeOf(range) > MODBUS_SEARCH_MAXIMUM) {
      setTypedError(
        t('brokers.modbus.tooMany', 'At most {{addresses}} addresses in all.', {
          addresses: count.format(MODBUS_SEARCH_MAXIMUM),
        }),
      );

      return;
    }

    setDraft({ ...draft, ranges: [...draft.ranges.filter((each) => each !== range), range] });
    setTyped('');
    setTypedError(undefined);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="large"
      title={t('brokers.modbus.settingsTitle', 'Modbus settings')}
      description={t(
        'brokers.modbus.settingsLine',
        'How the hub looks for Modbus devices on your network.',
      )}
      footer={
        <>
          <span className="mr-auto text-ui-sm text-foreground-subtle">
            {draft.isSearchEnabled
              ? t('brokers.modbus.savingSearches', 'Saving starts a search now.')
              : t('brokers.modbus.savingNothing', 'Search is off: saving starts nothing.')}
          </span>
          <Button variant="bare" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            isBusy={save.isPending}
            disabled={!isIntervalValid || save.isPending || (!isChanged && !draft.isSearchEnabled)}
            onClick={() => {
              save.mutate();
            }}
          >
            {t('common.save', 'Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col">
        <PanelRow
          className="border-t-0 px-0 pt-0"
          title={t('brokers.modbus.searchNetwork', 'Search the network')}
          note={
            lastRun === null
              ? draft.isSearchEnabled
                ? t('brokers.modbus.neverSearched', 'Not searched yet')
                : t('brokers.modbus.searchOff', 'Off')
              : [
                  ...(draft.isSearchEnabled ? [] : [t('brokers.modbus.searchOff', 'Off')]),
                  t('brokers.modbus.lastSearch', 'Last search {{when}}', {
                    when: relativeTime(lastRun.at),
                  }),
                  `${String(Math.max(1, Math.round(lastRun.durationMs / 1000)))} s`,
                ].join(' · ')
          }
          control={
            <Switch
              label={t('brokers.modbus.searchNetwork', 'Search the network')}
              isOn={draft.isSearchEnabled}
              disabled={save.isPending}
              onChange={(isSearchEnabled) => {
                setDraft({ ...draft, isSearchEnabled });
              }}
            />
          }
        />
        {draft.isSearchEnabled ? (
          <>
            <PanelRow
              className="px-0"
              title={t('brokers.modbus.ranges', 'Address ranges')}
              note={
                draft.ranges.length === 0
                  ? t(
                      'brokers.modbus.rangesNone',
                      'None: the networks the hub is on, up to a /22 each.',
                    )
                  : t('brokers.modbus.rangesTotal', '{{addresses}} addresses in all', {
                      addresses: count.format(total),
                    })
              }
            >
              <div className="flex flex-col gap-2.5">
                {draft.ranges.length === 0 ? null : (
                  <ul className="flex flex-col overflow-hidden rounded-field border border-border">
                    {draft.ranges.map((range) => (
                      <li
                        key={range}
                        className="flex items-center gap-3 border-t border-border px-3.5 py-2 first:border-t-0"
                      >
                        <span className="grow font-mono text-mono-ui text-foreground">{range}</span>
                        <span className="text-ui-sm text-foreground-subtle">
                          {t('brokers.modbus.addresses', {
                            count: sizeOf(range),
                            defaultValue_one: '{{count}} address',
                            defaultValue_other: '{{count}} addresses',
                          })}
                        </span>
                        <IconButton
                          label={t('brokers.modbus.removeRange', 'Remove {{range}}', { range })}
                          size="small"
                          onClick={() => {
                            setDraft({
                              ...draft,
                              ranges: draft.ranges.filter((each) => each !== range),
                            });
                          }}
                        >
                          <AppIcon id="x" size={14} />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-start gap-2.5">
                  <div className="grow">
                    <TextField
                      label={t('brokers.modbus.addRange', 'Add a range')}
                      isLabelHidden
                      placeholder="192.168.1.0/24"
                      value={typed}
                      error={typedError}
                      className="font-mono"
                      onChange={(event) => {
                        setTyped(event.target.value);
                        setTypedError(undefined);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addRange();
                        }
                      }}
                    />
                  </div>
                  <Button variant="ghost" disabled={typed.trim() === ''} onClick={addRange}>
                    <AppIcon id="plus" size={15} />
                    {t('brokers.modbus.add', 'Add')}
                  </Button>
                </div>
              </div>
            </PanelRow>
            <PanelRow
              className="px-0 pb-0"
              title={t('brokers.modbus.searchEveryTitle', 'Search every')}
              note={t(
                'brokers.modbus.searchEveryNote',
                'From 15 minutes to a day; 120 unless said.',
              )}
              control={
                <div className="w-40">
                  <TextField
                    label={t('brokers.modbus.searchEveryTitle', 'Search every')}
                    isLabelHidden
                    inputMode="numeric"
                    value={minutes}
                    trail={t('brokers.modbus.minutes', 'minutes')}
                    error={
                      isIntervalValid ? undefined : t('brokers.modbus.intervalRange', '15 to 1440')
                    }
                    onChange={(event) => {
                      setMinutes(event.target.value.trim());
                    }}
                  />
                </div>
              }
            />
          </>
        ) : null}
        {save.error === null ? null : (
          <p role="alert" className="mt-3.5 text-ui text-danger">
            {toMessage(save.error)}
          </p>
        )}
      </div>
    </Modal>
  );
}

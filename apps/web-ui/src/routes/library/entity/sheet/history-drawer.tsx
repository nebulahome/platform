/**
 * The History of the entity dialog: a sheet that rises over the controls, as the settings do,
 * opened by the History button in the header - the band or the line of the window chosen, three
 * figures under it, and the activity: each change in words, newest first, scrolling back.
 */
import { useTranslation } from 'react-i18next';

import type { EntityView } from '@nebulahome/contracts';

import { ActivityList } from '@/routes/library/entity/sheet/activity-list';
import { AxisRow, BandChart, LineChart } from '@/routes/library/entity/sheet/charts';
import { axisLabels, withUnit, type DrawerContent } from '@/routes/library/entity/sheet/history';
import {
  MonoLabel,
  RaisedHead,
  RangePill,
  StatTiles,
} from '@/routes/library/entity/sheet/parts/sheet-parts';
import {
  SHEET_RANGES,
  type SheetHistory,
  type SheetRange,
} from '@/routes/library/entity/sheet/sheet-types';
import type { SheetTone } from '@/routes/library/entity/sheet/tones';

/** What the sheet needs. */
export type HistorySheetProps = {
  /** The entity. */
  readonly entity: EntityView;

  /** What it draws, worked out from the history. */
  readonly content: DrawerContent;

  /** The history, for its window, its range and its changes. */
  readonly history: SheetHistory;

  /** The kind's colour. */
  readonly tone: SheetTone;

  /** Called to put the sheet away. */
  readonly onClose: () => void;
};

/**
 * The windows a history offers, with their short names.
 *
 * @param label - Names a window.
 * @returns The choices.
 */
export function rangeChoices(
  label: (range: SheetRange) => string,
): { value: SheetRange; label: string }[] {
  return SHEET_RANGES.map((range) => ({ value: range, label: label(range) }));
}

/**
 * Renders the sheet's head, chart, figures and activity.
 *
 * @param props - See {@link HistorySheetProps}.
 * @returns The sheet's content.
 */
export function HistorySheet(props: HistorySheetProps) {
  const { t } = useTranslation();
  const { entity, content, history, tone, onClose } = props;
  const isStale = !entity.isAvailable;

  return (
    <>
      <RaisedHead
        title={t('entity.sheet.history.title', 'History')}
        sub={entity.name}
        closeLabel={t('entity.sheet.history.close', 'Close history')}
        onClose={onClose}
        trail={
          <RangePill
            size="medium"
            ground="well"
            choices={rangeChoices((range) => range)}
            value={history.range}
            onChange={history.onRange}
          />
        }
      />
      <div className="flex min-h-0 grow flex-col gap-4 px-5 pb-5">
        <div
          // Drawn again each time the window changes.
          key={history.range}
          className="flex shrink-0 flex-col gap-2.5 rounded-panel border border-border bg-well p-4"
        >
          {content.kind === 'band' ? (
            <BandChart
              segments={content.segments}
              window={history.window}
              tone={isStale ? 'muted' : tone}
              label={t('entity.sheet.history.whenOn', 'When it was on, over the last {{range}}', {
                range: history.range,
              })}
            />
          ) : (
            <LineChart
              points={content.points}
              window={history.window}
              domain={content.domain}
              tone={tone}
              isStepped
              isStale={isStale}
              format={(value) => withUnit(value, content.unit)}
              label={t('entity.sheet.history.overTime', '{{what}} over the last {{range}}', {
                what: content.label,
                range: history.range,
              })}
            />
          )}
          <AxisRow labels={axisLabels(history.window, history.range)} />
        </div>
        {content.stats.length === 0 ? null : (
          <div className="shrink-0">
            <StatTiles stats={content.stats} isBoxed />
          </div>
        )}
        <div className="flex min-h-0 grow flex-col gap-1.5">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <MonoLabel>{t('entity.sheet.history.activity', 'Activity')}</MonoLabel>
            <span className="text-caption text-foreground-subtle">
              {t('entity.sheet.history.changes', '{{count}} changes', {
                count: history.states.length,
              })}
            </span>
          </div>
          <ActivityList entity={entity} points={history.states} window={history.window} />
        </div>
      </div>
    </>
  );
}

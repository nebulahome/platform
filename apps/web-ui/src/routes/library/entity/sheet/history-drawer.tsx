/**
 * The History drawer of the entity dialog: under the controls, opened by the History button in
 * the header, it slides down with the band or the line of the window chosen and three figures
 * under it (canvas board `N-Entity-Modal-B`).
 */
import { useTranslation } from 'react-i18next';

import type { CapabilityState, EntityView } from '@nebulahome/contracts';
import { cn } from '@nebulahome/ui';

import { AxisRow, BandChart, LineChart } from '@/routes/library/entity/sheet/charts';
import { axisLabels, withUnit, type DrawerContent } from '@/routes/library/entity/sheet/history';
import { MonoLabel, RangePill, StatTiles } from '@/routes/library/entity/sheet/parts/sheet-parts';
import {
  SHEET_RANGES,
  type SheetHistory,
  type SheetRange,
} from '@/routes/library/entity/sheet/sheet-types';
import type { SheetTone } from '@/routes/library/entity/sheet/tones';

/** What the drawer needs. */
export type HistoryDrawerProps = {
  /** Whether it is open. */
  readonly isOpen: boolean;

  /** The entity. */
  readonly entity: EntityView;

  /** Its state now. */
  readonly state: CapabilityState;

  /** What it draws, worked out from the history. */
  readonly content: DrawerContent;

  /** The history, for its window and its range. */
  readonly history: SheetHistory;

  /** The kind's colour. */
  readonly tone: SheetTone;
};

/**
 * The windows a drawer offers, with their short names.
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
 * Renders the drawer, open or folded away.
 *
 * @param props - See {@link HistoryDrawerProps}.
 * @returns The drawer.
 */
export function HistoryDrawer(props: HistoryDrawerProps) {
  const { t } = useTranslation();
  const { isOpen, entity, content, history, tone } = props;
  const isStale = !entity.isAvailable;

  return (
    <div
      inert={!isOpen}
      className={cn(
        'grid transition-[grid-template-rows] duration-460 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
        isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex flex-col gap-3 px-5 pb-5">
          <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
            <MonoLabel>{t('entity.sheet.history.title', 'History')}</MonoLabel>
            <RangePill
              size="medium"
              ground="well"
              choices={rangeChoices((range) => range)}
              value={history.range}
              onChange={history.onRange}
            />
          </div>
          <div
            // Drawn again each time the drawer opens, or the window changes.
            key={`${String(isOpen)}:${history.range}`}
            className="flex flex-col gap-2.5 rounded-panel border border-border bg-well p-4"
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
          {content.stats.length === 0 ? null : <StatTiles stats={content.stats} isBoxed />}
        </div>
      </div>
    </div>
  );
}

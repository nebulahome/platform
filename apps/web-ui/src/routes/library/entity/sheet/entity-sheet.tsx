/**
 * An entity, in one dialog: the sheet chosen on the Nebula canvas (`N-Entity-Modal-B`).
 *
 * A 400 px card with the entity's tile, name and kind at the top, and three round buttons:
 * History folds a drawer open under the controls, Settings lifts a sheet over them, Close puts
 * the dialog away. Between them, the body of its kind: a lamp's level, a lock's bolt, a sensor's
 * chart. A disabled entity says so under the header and greys its controls; one that no longer
 * answers says how long it has been silent, and shows its last value greyed.
 *
 * It draws the platform's own shapes and fetches nothing: whatever opens it passes the entity,
 * its state, its commander and its history.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { IconView } from '@nebulahome/contracts';
import { AppIcon, CatalogueIcon, cn } from '@nebulahome/ui';

import { durationText } from '@/library/history-stats';
import { drawerContentOf } from '@/routes/library/entity/sheet/history';
import { HistoryDrawer } from '@/routes/library/entity/sheet/history-drawer';
import { sheetKindOf } from '@/routes/library/entity/sheet/kinds';
import {
  ListViewContext,
  ListViewPanel,
  type ListView,
} from '@/routes/library/entity/sheet/parts/option-list';
import { SheetIconButton } from '@/routes/library/entity/sheet/parts/sheet-parts';
import {
  SettingsSheet,
  type SheetSettingsChange,
} from '@/routes/library/entity/sheet/settings-sheet';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';
import { TILE_LIT, TILE_REST } from '@/routes/library/entity/sheet/tones';

/** What the dialog needs. */
export type EntitySheetProps = SheetBodyProps & {
  /** The entity's own icon from the catalogue; undefined for none, or while it is read. */
  readonly icon?: IconView | undefined;

  /** The name of its device, for the settings; null for an entity without one. */
  readonly deviceName: string | null;

  /** Called when the dialog is put away. */
  readonly onClose: () => void;

  /** Called with what changed when the settings are saved. */
  readonly onSave: (change: SheetSettingsChange) => void;

  /** Called when Enable is pressed on a disabled entity. */
  readonly onEnable: () => void;

  /** Called when the device's row of the settings is pressed. */
  readonly onOpenDevice?: () => void;
};

/** Where the dialog is: on its controls, with its history open, or in its settings. */
type SheetView = 'control' | 'history' | 'settings';

/**
 * Renders the dialog's card.
 *
 * @param props - See {@link EntitySheetProps}.
 * @returns The card.
 */
export function EntitySheet(props: EntitySheetProps) {
  const { t } = useTranslation();
  const { entity, state, history, now, icon, deviceName, onClose, onSave, onEnable } = props;
  const [view, setView] = useState<SheetView>('control');
  // Each opening of the settings starts from the entity as it is now.
  const [openings, setOpenings] = useState(0);
  // A list too long for its chips, open in place of the body.
  const [list, setList] = useState<ListView | null>(null);
  const kind = sheetKindOf(entity, state);
  const Body = kind.Body;
  const tone = kind.tone;
  const glyph = kind.icon;
  const isSettings = view === 'settings';
  const isEnabled = entity.isEnabled;
  const drawer =
    kind.history === 'drawer'
      ? drawerContentOf(entity, state, history.states, history.window)
      : null;
  const silentFor =
    entity.lastUpdated === null ? null : Math.max(0, now - entity.lastUpdated.getTime());
  const sub = [kind.words, entity.areaName].filter(Boolean).join(' · ');
  const isLit = isEnabled && entity.isAvailable && kind.isLit;

  return (
    <div
      role="dialog"
      aria-label={entity.name}
      className={cn(
        'entity-arrive relative flex w-[400px] max-w-full flex-col overflow-hidden rounded-[24px] border',
        'border-border-strong bg-surface shadow-dialog',
        'transition-[min-height] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
        isSettings ? 'min-h-[640px]' : 'min-h-0',
      )}
    >
      {list === null ? null : (
        <ListViewPanel
          {...list}
          entityName={entity.name}
          onBack={() => {
            setList(null);
          }}
          onClose={onClose}
        />
      )}
      <div
        inert={isSettings}
        aria-hidden={isSettings}
        className={cn(
          'flex origin-top flex-col transition-[transform,opacity] duration-500',
          'ease-[cubic-bezier(0.2,0.8,0.2,1)]',
          isSettings && 'pointer-events-none -translate-y-1.5 scale-[0.94] opacity-45',
          list !== null && 'hidden',
        )}
      >
        <div className="flex items-center gap-3 pt-5 pr-3.5 pb-4 pl-5">
          <span
            className={cn(
              'relative flex size-11 shrink-0 items-center justify-center rounded-[13px] border',
              'transition-[color,background-color,border-color,box-shadow] duration-500',
              isLit ? cn(TILE_LIT[tone], 'shadow-[0_0_24px_-6px_currentColor]') : TILE_REST,
            )}
          >
            {icon === undefined ? (
              <AppIcon id={glyph} size={20} />
            ) : (
              <CatalogueIcon node={icon.node} frame={icon.frame} size={20} />
            )}
            {entity.isAvailable ? null : (
              <span
                aria-hidden="true"
                className="entity-pop absolute -top-0.75 -right-0.75 size-2.5 rounded-full border-2 border-surface bg-danger"
              />
            )}
          </span>
          <div className="flex min-w-0 grow flex-col gap-0.75">
            <span className="truncate text-[17px] font-medium tracking-[-0.01em]">
              {entity.name}
            </span>
            <span className="truncate text-ui-sm text-foreground-subtle">{sub}</span>
          </div>
          {drawer === null ? null : (
            <SheetIconButton
              icon="chart-line"
              label={t('entity.sheet.history.title', 'History')}
              isPressed={view === 'history'}
              onClick={() => {
                setView(view === 'history' ? 'control' : 'history');
              }}
            />
          )}
          <SheetIconButton
            icon="settings"
            label={t('entity.sheet.settings.title', 'Settings')}
            onClick={() => {
              setOpenings(openings + 1);
              setView('settings');
            }}
          />
          <SheetIconButton icon="x" label={t('common.close', 'Close')} onClick={onClose} />
        </div>

        {isEnabled ? null : (
          <div className="mx-5 flex animate-arrive items-center gap-2.5 rounded-tile border border-border-strong bg-foreground-muted/8 px-3 py-2.5 text-ui-sm text-foreground-muted">
            <AppIcon id="eye-off" size={16} />
            <span className="grow">
              {t('entity.sheet.disabled', 'Disabled. Hidden from pickers, states not recorded.')}
            </span>
            <button
              type="button"
              onClick={onEnable}
              className="press h-7 cursor-pointer rounded-pill border border-border-strong bg-surface-raised px-2.5 text-caption font-medium whitespace-nowrap text-foreground transition-colors duration-200 hover:border-foreground-subtle"
            >
              {t('entity.sheet.enable', 'Enable')}
            </button>
          </div>
        )}

        {!isEnabled || entity.isAvailable ? null : (
          <div className="mx-5 flex animate-arrive items-center gap-2.5 rounded-tile border border-danger/30 bg-danger/8 px-3 py-2.5 text-ui-sm text-danger">
            <AppIcon id="wifi-off" size={16} />
            <span>
              {silentFor === null
                ? t('entity.sheet.neverAnswered', 'Not answering yet.')
                : t(
                    'entity.sheet.notAnswering',
                    'Not answering for {{duration}}. Showing the last value.',
                    { duration: durationText(silentFor) },
                  )}
            </span>
          </div>
        )}

        <div
          className={cn(
            'entity-stagger-deep flex min-h-[300px] flex-col px-6 pt-2 pb-6 transition-opacity duration-240',
            !isEnabled && 'pointer-events-none opacity-35',
          )}
        >
          <ListViewContext value={setList}>
            <Body {...props} disabled={props.disabled || !isEnabled} />
          </ListViewContext>
        </div>

        {drawer === null ? null : (
          <HistoryDrawer
            isOpen={view === 'history'}
            entity={entity}
            state={state}
            content={drawer}
            history={history}
            tone={tone}
          />
        )}
      </div>

      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 bg-canvas/55 transition-opacity duration-420',
          isSettings ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div
        inert={!isSettings}
        aria-hidden={!isSettings}
        className={cn(
          'absolute inset-x-0 top-3.5 bottom-0 flex flex-col rounded-t-[22px] border-t',
          'border-border-strong bg-sheet shadow-[0_-24px_60px_rgb(0_0_0/0.55)]',
          'transition-transform duration-520 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
          isSettings ? 'translate-y-0' : 'pointer-events-none translate-y-[105%]',
        )}
      >
        <SettingsSheet
          key={openings}
          entity={entity}
          deviceName={deviceName}
          onSave={onSave}
          onClose={() => {
            setView('control');
          }}
          {...(props.onOpenDevice === undefined ? {} : { onOpenDevice: props.onOpenDevice })}
        />
      </div>
    </div>
  );
}

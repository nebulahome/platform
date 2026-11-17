/**
 * The keys bar at the foot of the command palette (docs: command palette, 6.4): what the keys do
 * on the active row - Enter, and Tab where it does something - and, apart on the right, Esc. The
 * only place Esc is written.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon } from '@nebulahome/ui';

import { PaletteKey } from '@/palette/palette-key';
import type { PaletteOption } from '@/palette/palette-layout';
import { usePowerHint } from '@/palette/use-power-hint';

/** What the bar needs. */
export type PaletteKeysProps = {
  /** The active row; none while the list is empty. */
  readonly option: PaletteOption | undefined;
};

/**
 * One key and what it does.
 *
 * @param props - The key and the words.
 * @param props.keys - The key.
 * @param props.label - What it does.
 * @returns The pair.
 */
function Hint(props: { readonly keys: ReactNode; readonly label: string }) {
  return (
    <span className="inline-flex items-center gap-1.75 whitespace-nowrap">
      <PaletteKey>{props.keys}</PaletteKey>
      <span key={props.label} className="animate-fade-in">
        {props.label}
      </span>
    </span>
  );
}

/**
 * Renders the keys bar.
 *
 * @param props - See {@link PaletteKeysProps}.
 * @returns The bar.
 */
export function PaletteKeys(props: PaletteKeysProps) {
  const { t } = useTranslation();
  const { option } = props;
  const item = option?.kind === 'item' ? option.item : undefined;
  const action = item?.secondaryAction;
  const power = usePowerHint(action?.command.type === 'power' ? action.command.entity : undefined);
  const primary =
    option === undefined
      ? undefined
      : option.kind === 'item'
        ? option.item.primary.hint
        : option.kind === 'more'
          ? t('palette.hint.showAll', 'Show all')
          : t('palette.hint.search', 'Search');

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-4 border-t border-foreground/7 px-4.5 text-caption text-foreground/50">
      <span className="flex min-w-0 items-center gap-4.5">
        <Hint
          keys={
            <>
              <AppIcon id="arrow-up" size={11} />
              <AppIcon id="arrow-down" size={11} />
            </>
          }
          label={t('palette.keys.move', 'Move')}
        />
        {primary === undefined ? null : (
          <Hint keys={<AppIcon id="corner-down-left" size={11} />} label={primary} />
        )}
        {action === undefined ? null : (
          <Hint keys="Tab" label={action.command.type === 'power' ? power.hint : action.hint} />
        )}
      </span>
      <Hint keys="Esc" label={t('palette.keys.close', 'Close')} />
    </div>
  );
}

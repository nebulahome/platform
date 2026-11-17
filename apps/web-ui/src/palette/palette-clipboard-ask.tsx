/**
 * The one quiet line at the foot of the command palette's empty field that offers to read the
 * system clipboard (board N-Command-Palette-Clipboard-Rules): only where the browser would ask,
 * and only until the person answers - Allow or Not now. Opening the palette never asks by itself.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon } from '@nebulahome/ui';

/** What the line needs. */
export type PaletteClipboardAskProps = {
  readonly onAllow: () => void;
  readonly onDismiss: () => void;
};

/**
 * Renders the line.
 *
 * @param props - See {@link PaletteClipboardAskProps}.
 * @returns The line.
 */
export function PaletteClipboardAsk(props: PaletteClipboardAskProps) {
  const { t } = useTranslation();
  const button =
    'press shrink-0 rounded-check px-1.5 py-0.5 text-ui-sm focus-visible:-outline-offset-2';

  return (
    <div className="mt-1 flex min-h-10 items-center gap-3 border-t border-foreground/7 px-3 pt-1 text-ui-sm text-foreground-subtle">
      <AppIcon id="copy" size={15} className="shrink-0" />
      <span className="grow">
        {t('palette.clipboard.ask', 'See the id you just copied as the first result.')}
      </span>
      <button
        type="button"
        tabIndex={-1}
        onPointerDown={(event) => {
          // The field keeps the focus.
          event.preventDefault();
        }}
        onClick={props.onAllow}
        className={`${button} font-medium text-primary hover:bg-primary/10`}
      >
        {t('palette.clipboard.allow', 'Allow')}
      </button>
      <button
        type="button"
        tabIndex={-1}
        onPointerDown={(event) => {
          event.preventDefault();
        }}
        onClick={props.onDismiss}
        className={`${button} hover:bg-foreground/7 hover:text-foreground`}
      >
        {t('palette.clipboard.notNow', 'Not now')}
      </button>
    </div>
  );
}

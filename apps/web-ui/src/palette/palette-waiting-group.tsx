/**
 * A group of the command palette whose list has not come yet, or failed (boards
 * N-Command-Palette-Loading, -Group-Error): its name, and two quiet placeholder rows while it
 * comes; one line and a way to try again when it failed. The rest of the palette works meanwhile.
 */
import { useTranslation } from 'react-i18next';

import type { PaletteSourceState } from '@/palette/use-palette-items';

/** What the group needs. */
export type PaletteWaitingGroupProps = {
  /** The group's name. */
  readonly label: string;
  readonly source: PaletteSourceState;
};

/**
 * Renders the group.
 *
 * @param props - See {@link PaletteWaitingGroupProps}.
 * @returns The group.
 */
export function PaletteWaitingGroup(props: PaletteWaitingGroupProps) {
  const { t } = useTranslation();
  const { label, source } = props;

  return (
    <div className="flex flex-col">
      <div className="flex h-8.5 items-center px-3 pt-2 font-mono text-label text-foreground/42 uppercase">
        {label}
      </div>
      {source.isError ? (
        <p className="flex h-10 items-center gap-2 px-3 text-ui-sm text-foreground-subtle">
          {t('palette.failed', '{{group}} could not be loaded.', { group: label })}
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={(event) => {
              // The field keeps the focus.
              event.preventDefault();
            }}
            onClick={source.retry}
            className="rounded-check text-primary hover:underline"
          >
            {t('palette.retry', 'Try again')}
          </button>
        </p>
      ) : (
        ['w-35', 'w-24 opacity-60'].map((width) => (
          // A row of name over details, as most rows are, so nothing moves when they arrive.
          <div key={width} aria-hidden="true" className="flex h-14 items-center gap-3.5 px-2.5">
            <span className="size-8 shrink-0 rounded-full bg-foreground/7" />
            <span className="flex flex-col gap-2">
              <span className={`h-2.5 rounded-full bg-foreground/7 ${width}`} />
              <span className="h-2 w-20 rounded-full bg-foreground/5" />
            </span>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * The dashed "Drop a file here · Choose a file" zone a file is brought in through: an aliases
 * file, a remote's codes, a calendar's `.ics`.
 *
 * It only hands the file over; reading it (`file.text()`), its size and what is wrong with it are
 * the caller's, which knows what the file should be. What the zone holds (`children`, a text area
 * to paste into) takes a drop too, so "anywhere here" stays true.
 */
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, cn } from '@nebulahome/ui';

/** What the zone needs. */
export type FileDropProps = {
  /** The file types the chooser offers, as an input's `accept`: `.ics,text/calendar`. */
  readonly accept: string;

  /** Called with the file dropped or chosen. */
  readonly onFile: (file: File) => void;

  /** The line while nothing is chosen: "Drop an aliases file here". */
  readonly hint: string;

  /** The line while a file is dragged over it; the hint when absent. */
  readonly overHint?: string;

  /** The file taken, in place of the hint: its name, and a word about it (its size, a count). */
  readonly chosen?: { readonly name: string; readonly detail: string } | null;

  /** While the file is being read or tested: the chooser waits. */
  readonly isBusy?: boolean;

  /** Drawn above the dashed line, and taking a drop too. */
  readonly children?: ReactNode;

  readonly className?: string;
};

/**
 * Renders the zone.
 *
 * @param props - See {@link FileDropProps}.
 * @returns The zone.
 */
export function FileDrop(props: FileDropProps) {
  const { t } = useTranslation();
  const { accept, onFile, hint, overHint, chosen, isBusy = false, children, className } = props;
  const input = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);

  /**
   * Takes a dropped file.
   *
   * @param event - The drop.
   */
  const drop = (event: DragEvent<HTMLDivElement>): void => {
    const [file] = event.dataTransfer.files;
    setIsOver(false);

    if (file === undefined) {
      return;
    }

    event.preventDefault();
    onFile(file);
  };

  return (
    <div
      className={cn('flex flex-col gap-2.5', className)}
      onDragOver={(event) => {
        event.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={(event) => {
        // Leaving for a child is not leaving.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOver(false);
        }
      }}
      onDrop={drop}
    >
      {children}
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const [file] = event.target.files ?? [];

          if (file !== undefined) {
            onFile(file);
          }

          // The same file chosen again is a change too.
          event.target.value = '';
        }}
      />
      <div
        className={cn(
          'flex min-w-0 flex-wrap items-center justify-center gap-2 rounded-inner border border-dashed px-4 py-3 text-ui-sm text-foreground-muted',
          isOver ? 'border-primary bg-primary-soft text-foreground' : 'border-border-strong',
        )}
      >
        <AppIcon id="file" size={15} className="shrink-0 text-primary" />
        {isOver ? (
          (overHint ?? hint)
        ) : chosen === undefined || chosen === null ? (
          hint
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-foreground">{chosen.name}</span>
            <span className="shrink-0 text-foreground-subtle">· {chosen.detail}</span>
          </span>
        )}
        <Button
          variant="bare"
          size="compact"
          isBusy={isBusy}
          onClick={() => {
            input.current?.click();
          }}
        >
          {chosen === undefined || chosen === null
            ? t('fileDrop.choose', 'Choose a file')
            : t('fileDrop.another', 'Another file')}
        </Button>
      </div>
    </div>
  );
}

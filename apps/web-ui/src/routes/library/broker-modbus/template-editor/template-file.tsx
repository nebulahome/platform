/**
 * The template as a file: the JSON the blocks write, edited in place.
 *
 * The editor is the compose files' - a JSON file is YAML - with marks of the template's own over
 * its colours (`template-file-editor.tsx`), so what a line is reads at a glance: a capability, a
 * read or a write, a domain in its colour, a value type, a function code. The status bar says whether the file is valid and the
 * blocks follow it; a file that is not stays as typed, the blocks keep the last valid one, and the
 * line the parser stopped at is marked.
 */
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, cn } from '@nebulahome/ui';

import { copyText } from '@/lib/clipboard';

/** The editor, loaded when a file is first shown. */
const TemplateFileEditor = lazy(async () => import('./template-file-editor'));

/** What the file view needs. */
export type TemplateFileProps = {
  readonly text: string;
  readonly fileName: string;
  readonly onChange: (text: string) => void;

  /** Why the file does not parse; null when it does. */
  readonly error: string | null;

  /** How many entities and capabilities the blocks hold, for the status bar. */
  readonly entities: number;
  readonly capabilities: number;
  readonly onFormat: () => void;
};

/**
 * The line a parser's message names a position on, for the editor to mark.
 *
 * @param text - The file.
 * @param error - The message.
 * @returns The line, from 1, or null when it names none.
 */
function lineOf(text: string, error: string | null): number | null {
  const position = /position (\d+)/u.exec(error ?? '')?.[1];

  return position === undefined ? null : text.slice(0, Number(position)).split('\n').length;
}

/**
 * Renders the file view.
 *
 * @param props - See {@link TemplateFileProps}.
 * @returns The view.
 */
export function TemplateFile(props: TemplateFileProps) {
  const { t } = useTranslation();
  const { error } = props;
  const line = lineOf(props.text, error);

  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-2.5">
        <AppIcon id="file" size={14} className="text-foreground-subtle" />
        <span className="font-mono text-mono-ui text-foreground">{props.fileName}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span
            translate="no"
            className="rounded-chip bg-primary-soft px-1.5 font-mono text-mono-caption text-primary-hover"
          >
            capability
          </span>
          <span
            translate="no"
            className="rounded-chip bg-cyan/18 px-1.5 font-mono text-mono-caption text-cyan"
          >
            function
          </span>
          <span
            translate="no"
            className="rounded-chip bg-violet/16 px-1.5 font-mono text-mono-caption text-violet"
          >
            type
          </span>
        </span>
        <span className="grow" />
        <Button variant="bare" size="compact" disabled={error !== null} onClick={props.onFormat}>
          {t('brokers.modbus.format', 'Format')}
        </Button>
        <Button
          variant="bare"
          size="compact"
          onClick={() => {
            void copyText(props.text);
          }}
        >
          <AppIcon id="copy" size={13} />
          {t('brokers.modbus.copy', 'Copy')}
        </Button>
      </div>
      <Suspense fallback={<div className="h-130" />}>
        <TemplateFileEditor
          label={props.fileName}
          value={props.text}
          onChange={props.onChange}
          minHeight="max(32.5rem, calc(100vh - 13rem))"
          maxHeight="max(32.5rem, calc(100vh - 13rem))"
          problems={error === null ? [] : [{ line, message: error }]}
        />
      </Suspense>
      <div
        className={cn(
          'flex items-center gap-2 border-t border-border px-4 py-2 text-ui-sm',
          error === null ? 'text-foreground-muted' : 'text-danger',
        )}
        role="status"
      >
        <AppIcon
          id={error === null ? 'circle-check' : 'circle-x'}
          size={14}
          className={error === null ? 'text-success' : 'text-danger'}
        />
        {error === null
          ? t(
              'brokers.modbus.fileValid',
              'Valid · {{entities}} entities, {{capabilities}} capabilities. Blocks are up to date.',
              { entities: props.entities, capabilities: props.capabilities },
            )
          : t('brokers.modbus.fileInvalid', '{{error}} Blocks keep the last valid version.', {
              error,
            })}
      </div>
    </div>
  );
}

/**
 * Importing codes written down elsewhere into a remote.
 *
 * One text area that is also where a file is dropped: pasted Broadlink base64, Pronto hex or raw
 * timings, a line each, or a Flipper Zero `.ir` file with several buttons in it. The hub reads it
 * (the web never parses a code itself) and the codes it understood are listed, each with a
 * checkbox, its name to change, its protocol and Test; the lines it did not are in a fold below
 * with why. Import adds the ones ticked into the remote's next empty cells.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { InfraredRemote } from '@nebulahome/contracts';
import { AppIcon, Button, Checkbox, cn, Modal, Note, TextArea, TextField } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import {
  importInfraredButtons,
  parseInfraredImport,
  testInfraredCode,
} from '@/library/infrared-api';
import { BrokerMark } from '@/routes/library/brokers-page';

import { ProtocolPill } from './infrared-parts';

/** How long the text rests before the hub reads it. */
const SETTLE_MS = 400;

/** What the dialog needs. */
export type ImportDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly remote: InfraredRemote;

  /** Text to start from, for the gallery. */
  readonly initialText?: string;

  /** The file it came from, for the gallery. */
  readonly initialFileName?: string;
};

/**
 * Renders the dialog.
 *
 * @param props - See {@link ImportDialogProps}.
 * @returns The dialog.
 */
export function ImportDialog(props: ImportDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isOpen, onClose, remote } = props;
  const [text, setText] = useState(props.initialText ?? '');
  const [fileName, setFileName] = useState<string | null>(props.initialFileName ?? null);
  const [settled, setSettled] = useState(text);
  const [names, setNames] = useState<ReadonlyMap<number, string>>(new Map());
  const [left, setLeft] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(text);
    }, SETTLE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  const parsed = useQuery({
    queryKey: ['brokers', 'infrared', 'import', fileName ?? '', settled],
    enabled: settled.trim() !== '',
    placeholderData: keepPreviousData,

    /**
     * Has the hub read the text.
     *
     * @returns The codes understood, and the lines that were not.
     */
    queryFn: async () => parseInfraredImport(settled, fileName ?? undefined),
  });
  const items = settled.trim() === '' ? [] : (parsed.data?.items ?? []);
  const problems = settled.trim() === '' ? [] : (parsed.data?.problems ?? []);
  const picked = items.flatMap((item, index) =>
    left.has(index) ? [] : [{ name: (names.get(index) ?? item.name).trim(), code: item.code }],
  );

  const test = useMutation({
    /**
     * Sends one code, as a test.
     *
     * @param index - Which.
     * @returns When it went.
     */
    mutationFn: async (index: number) => {
      const item = items[index];

      return item === undefined || remote.blasterId === null
        ? null
        : testInfraredCode(remote.blasterId, item.code);
    },
  });
  const save = useMutation({
    /**
     * Adds the codes ticked.
     *
     * @returns The remote, with them.
     */
    mutationFn: async () => importInfraredButtons(remote.id, picked),

    /** Reads the remote again and closes. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brokers', 'infrared'] });
      onClose();
    },
  });

  /**
   * Reads a file dropped on the text area.
   *
   * @param event - The drop.
   */
  const drop = (event: DragEvent<HTMLDivElement>): void => {
    const [file] = event.dataTransfer.files;

    if (file === undefined) {
      return;
    }

    event.preventDefault();
    void file.text().then((content) => {
      setFileName(file.name);
      setText(content);
      setNames(new Map());
      setLeft(new Set());
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="picker"
      layout="sections"
      lead={<BrokerMark broker="infrared" size={44} isLit />}
      title={t('brokers.infrared.import.title', 'Import codes')}
      description={t(
        'brokers.infrared.import.line',
        'Into {{remote}} · Broadlink base64, Pronto hex, raw timings or a Flipper .ir file',
        { remote: remote.name },
      )}
      closeLabel={t('common.close', 'Close')}
      closesOnBackdrop={text === ''}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={picked.length === 0 || picked.some((item) => item.name === '')}
              isBusy={save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              <AppIcon id="upload" size={15} />
              {t('brokers.infrared.import.submit', {
                count: picked.length,
                defaultValue_one: 'Import {{count}} button',
                defaultValue_other: 'Import {{count}} buttons',
              })}
            </Button>
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4 px-6 py-5">
        <div
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={drop}
          className="flex flex-col gap-2.5"
        >
          <TextArea
            label={t('brokers.infrared.import.codes', 'Codes')}
            isLabelHidden
            rows={8}
            value={text}
            spellCheck={false}
            className="font-mono text-mono-caption"
            placeholder={t(
              'brokers.infrared.import.placeholder',
              'Paste one code a line, or drop a Flipper Zero .ir file here',
            )}
            onChange={(event) => {
              setText(event.target.value);
              setFileName(null);
            }}
          />
          <p className="flex items-center justify-center gap-2 rounded-inner border border-dashed border-border-strong px-4 py-3 text-ui-sm text-foreground-muted">
            <AppIcon id="file" size={15} className="text-[#f7895c]" />
            {fileName === null
              ? t('brokers.infrared.import.drop', 'Drop a .ir file anywhere here')
              : t('brokers.infrared.import.dropped', '{{file}} dropped · {{count}} codes', {
                  file: fileName,
                  count: items.length,
                })}
          </p>
        </div>

        {items.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <span className="text-ui-sm text-foreground-muted">
              {t('brokers.infrared.import.found', 'Found {{found}} codes · {{picked}} picked', {
                found: items.length,
                picked: picked.length,
              })}
            </span>
            <ul className="flex flex-col rounded-card border border-border">
              {items.map((item, index) => (
                <li
                  key={`${item.name}-${String(item.code.pulses.length)}-${String(item.code.pulses[0] ?? 0)}`}
                  className={cn(
                    'flex items-center gap-3 border-t border-border px-3.5 py-2 first:border-t-0',
                    left.has(index) && 'opacity-60',
                  )}
                >
                  <Checkbox
                    label={
                      <span className="sr-only">
                        {t('brokers.infrared.import.pick', 'Import {{name}}', { name: item.name })}
                      </span>
                    }
                    isChecked={!left.has(index)}
                    onChange={(isChecked) => {
                      const next = new Set(left);

                      if (isChecked) {
                        next.delete(index);
                      } else {
                        next.add(index);
                      }

                      setLeft(next);
                    }}
                  />
                  <TextField
                    label={t('brokers.infrared.import.name', 'Name')}
                    isLabelHidden
                    value={names.get(index) ?? item.name}
                    className="max-w-60"
                    onChange={(event) => {
                      setNames(new Map(names).set(index, event.target.value));
                    }}
                  />
                  <span className="grow" />
                  <ProtocolPill protocol={item.code.protocol} />
                  <Button
                    variant="bare"
                    size="compact"
                    disabled={remote.blasterId === null}
                    isBusy={test.isPending && test.variables === index}
                    onClick={() => {
                      test.mutate(index);
                    }}
                  >
                    <AppIcon id="send" size={14} />
                    {t('brokers.infrared.learn.test', 'Test')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {problems.length === 0 ? null : (
          <details className="rounded-card border border-border px-4 py-3">
            <summary className="flex cursor-pointer items-center gap-2 text-ui-sm text-warning">
              <AppIcon id="triangle-alert" size={14} />
              {t('brokers.infrared.import.notUnderstood', {
                count: problems.length,
                defaultValue_one: '{{count}} line not understood',
                defaultValue_other: '{{count}} lines not understood',
              })}
            </summary>
            <ul className="mt-3 flex flex-col gap-2">
              {problems.map((problem) => (
                <li
                  key={`${String(problem.line)}-${problem.text}`}
                  className="flex flex-col gap-0.5 text-ui-sm"
                >
                  <span className="truncate font-mono text-mono-caption text-foreground">
                    {problem.line === null
                      ? problem.text
                      : t('brokers.infrared.import.lineText', 'Line {{line}}: {{text}}', {
                          line: problem.line,
                          text: problem.text,
                        })}
                  </span>
                  <span className="text-foreground-muted">{problem.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {[parsed.error, test.error, save.error].map((error) =>
          error === null ? null : (
            <Note key={toMessage(error)} tone="danger">
              {toMessage(error)}
            </Note>
          ),
        )}
      </div>
    </Modal>
  );
}

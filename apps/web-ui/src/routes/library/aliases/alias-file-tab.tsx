/**
 * The File tab: the alias's whole setup as one JSON file - the same format a whole house of
 * aliases is exported in - to read, copy, export, or change by typing or pasting. What is pasted
 * is read back before anything is saved: the Changes it makes to the saved setup, and the
 * Problems that stop it (a wrong shape, a part the type has not got, an entity this house has
 * not got). A file without problems goes into the page's draft, and Save keeps it.
 */
import { lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ALIAS_SOURCES,
  ALIAS_TYPES,
  aliasEntryCode,
  aliasesFile,
  aliasFileEntry,
  aliasPartsReads,
  diffAliasEntry,
  readAliasFile,
  type AliasCustomField,
  type AliasFileEntry,
  type AliasPartDef,
  type AliasTypeDef,
  type AliasView,
} from '@nebulahome/contracts';
import { AppIcon, Button, toast } from '@nebulahome/ui';

import { copyText } from '@/lib/clipboard';
import { relativeTime } from '@/lib/format-time';
import { codeEntityReads } from '@/library/alias-model';
import { saveJsonFile } from '@/library/library-file';
import { useInstalledPackages } from '@/packages/use-packages';
import type { AliasDraft } from '@/routes/library/aliases/alias-page';
import { Ent } from '@/routes/library/aliases/alias-text';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';

/** What `device` may be in a file: code, never translated. */
const FILE_DEVICES = ['aliases', '{ "virtual": name }', '{ "device": name }'];

const JsonEditor = lazy(async () => import('@/routes/containers/yaml-editor'));

/**
 * An alias's file entry, from its draft.
 *
 * @param alias - The alias as saved.
 * @param draft - What the page holds.
 * @returns The entry.
 */
export function entryOf(alias: AliasView, draft: AliasDraft): AliasFileEntry {
  return aliasFileEntry({ ...alias, ...draft, area: alias.area }, draft.area);
}

/**
 * A file's text, as the tab shows it.
 *
 * @param entry - The alias's entry.
 * @returns Two-space JSON.
 */
function textOf(entry: AliasFileEntry): string {
  return `${JSON.stringify(aliasesFile([entry]), null, 2)}\n`;
}

/**
 * A draft from a file entry.
 *
 * @param entry - The entry.
 * @param draft - The draft it replaces, for what the file does not hold.
 * @returns The draft.
 */
function draftFrom(entry: AliasFileEntry, draft: AliasDraft): AliasDraft {
  return {
    ...draft,
    name: entry.name,
    icon: entry.icon,
    area: entry.area,
    parts: entry.parts,
    code: aliasEntryCode(entry),
    cases: entry.cases,
    ifOneStops: entry.ifOneStops,
    debounceMs: entry.debounceMs,
    display: entry.display,
  };
}

/** What the tab needs. */
type AliasFileTabProps = {
  readonly alias: AliasView;

  /** The draft as saved, which Changes compare with. */
  readonly saved: AliasDraft;

  /** The draft as the page holds it. */
  readonly draft: AliasDraft;
  readonly defs: readonly AliasPartDef[];
  readonly canEdit: boolean;
  readonly savedAt: Date;
  readonly onChange: (draft: AliasDraft) => void;
};

/**
 * The File tab.
 *
 * @param props - See {@link AliasFileTabProps}.
 * @returns The editor and its review.
 */
export function AliasFileTab(props: AliasFileTabProps) {
  const { t } = useTranslation();
  const { alias, saved, draft, canEdit, savedAt, onChange } = props;
  const { packages } = useInstalledPackages();
  const { entities } = useEntityDirectory(false);
  const input = useRef<HTMLInputElement>(null);
  const savedEntry = entryOf(alias, saved);
  const [text, setText] = useState(() => textOf(entryOf(alias, draft)));
  const [panel, setPanel] = useState<'changes' | 'problems'>('changes');
  const known = new Set(entities.map((entity) => entity.entityId as string));
  const isPasted = text !== textOf(savedEntry);

  /**
   * A custom type's fields, from the installed packages.
   *
   * @param packageId - The package.
   * @param type - Its entity type.
   * @returns The fields, or undefined when it is not installed.
   */
  const customFieldsOf = (
    packageId: string,
    type: string,
  ): readonly AliasCustomField[] | undefined =>
    packages.find((each) => each.id === packageId)?.entityTypes.find((each) => each.id === type)
      ?.state;

  /**
   * Reads a text: the entry, and what stops it.
   *
   * @param value - The text.
   * @returns The entry, when it reads, and the problems.
   */
  const review = (value: string): { entry: AliasFileEntry | null; problems: string[] } => {
    const read = readAliasFile(value, customFieldsOf);

    if (!read.ok) {
      return {
        entry: null,
        problems: read.problems.map((problem) =>
          problem.path === '' ? problem.message : `${problem.path} · ${problem.message}`,
        ),
      };
    }

    const [entry, ...more] = read.file.aliases;
    const problems: string[] = [];

    if (entry === undefined || more.length > 0) {
      return {
        entry: null,
        problems: [t('library.aliasPage.fileOne', 'The file must hold this alias alone')],
      };
    }

    if (entry.key !== alias.key) {
      problems.push(t('library.aliasPage.fileKey', 'The key stays {{key}}', { key: alias.key }));
    }

    if (entry.behavesAs !== alias.behavesAs) {
      problems.push(
        t('library.aliasPage.fileType', 'The type stays {{type}}', { type: alias.behavesAs }),
      );
    }

    if (JSON.stringify(entry.device) !== JSON.stringify(savedEntry.device)) {
      problems.push(
        t('library.aliasPage.fileDevice', 'The device stays: make a new alias to move it'),
      );
    }

    const code = aliasEntryCode(entry);
    const reads = new Set([
      ...aliasPartsReads(entry.parts),
      ...codeEntityReads(code, Object.keys(entry.parts)),
    ]);

    for (const id of reads) {
      if (known.size > 0 && !known.has(id)) {
        problems.push(t('library.aliasPage.fileMissing', '{{id}} is not in this house', { id }));
      }
    }

    return { entry, problems };
  };

  const { entry, problems } = review(text);
  const changes = entry === null ? [] : diffAliasEntry(savedEntry, entry);
  const missing = new Set(
    entry === null
      ? []
      : [...aliasPartsReads(entry.parts)].filter((id) => known.size > 0 && !known.has(id)),
  );

  /**
   * Takes a new text, and puts it in the draft when nothing stops it.
   *
   * @param value - The text.
   */
  const edit = (value: string): void => {
    setText(value);
    const next = review(value);

    if (next.entry !== null && next.problems.length === 0) {
      onChange(draftFrom(next.entry, draft));
    }
  };

  /**
   * Puts a part back as saved, in the text.
   *
   * @param part - The part's key.
   */
  const keepOld = (part: string): void => {
    if (entry === null) {
      return;
    }

    const parts = { ...entry.parts };
    const old = savedEntry.parts[part];

    if (old === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- a part is removed by its key
      delete parts[part];
    } else {
      parts[part] = old;
    }

    edit(textOf({ ...entry, parts }));
  };

  /**
   * A value in a change row.
   *
   * @param value - The value.
   * @returns It, short.
   */
  const shown = (value: unknown): string => {
    const json = typeof value === 'string' ? value : JSON.stringify(value);

    return json.length > 40 ? `${json.slice(0, 39)}…` : json;
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex items-center gap-2.5 border-b border-border bg-canvas px-4 py-2">
        <AppIcon id="braces" size={14} className="text-tag-amber" />
        <span className="font-mono text-ui-sm text-foreground">
          {t('library.aliasPage.fileName', '{{key}}.json', { key: alias.key })}
        </span>
        {isPasted ? (
          <span className="flex items-center gap-1.5 text-caption text-warning">
            <AppIcon id="clipboard-paste" size={13} />
            {t('library.aliasPage.pasted', 'Changed · unsaved')}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-caption text-success">
            <AppIcon id="check" size={13} />
            {t('library.aliasPage.valid', 'Valid')}
          </span>
        )}
        <span className="grow" />
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const [file] = event.target.files ?? [];

            if (file !== undefined) {
              void file.text().then(edit);
            }

            event.target.value = '';
          }}
        />
        {canEdit ? (
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              input.current?.click();
            }}
          >
            {t('library.aliasPage.importDots', 'Import…')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="compact"
          onClick={() => {
            saveJsonFile(aliasesFile([entry ?? savedEntry]), `${alias.key}.aliases.json`);
          }}
        >
          {t('library.aliasPage.export', 'Export')}
        </Button>
        <Button
          variant="ghost"
          size="compact"
          onClick={() => {
            void copyText(text).then((isCopied) => {
              if (isCopied) {
                toast.success({ title: t('library.aliasPage.copied', 'Copied') });
              }
            });
          }}
        >
          {t('library.aliasPage.copy', 'Copy')}
        </Button>
      </div>
      <div className="p-3">
        <Suspense fallback={<div className="h-80" />}>
          <JsonEditor
            label={t('library.aliasPage.file', 'File')}
            value={text}
            onChange={edit}
            isReadOnly={!canEdit}
            minHeight="320px"
            maxHeight="640px"
          />
        </Suspense>
      </div>
      {/[Aa]uthorization/u.test(aliasEntryCode(entry ?? savedEntry)) ? (
        <p className="flex items-center gap-1.5 border-t border-border px-4 py-2 text-caption text-warning">
          <AppIcon id="triangle-alert" size={12} />
          {t(
            'library.aliasPage.tokenInCode',
            'The code holds an Authorization header: its token travels with Export and Copy.',
          )}
        </p>
      ) : null}
      <div className="flex items-center gap-1 border-t border-border px-2">
        {(['changes', 'problems'] as const).map((each) => {
          const count = each === 'changes' ? changes.length : problems.length;

          return (
            <button
              key={each}
              type="button"
              aria-pressed={panel === each}
              className={`relative flex items-center gap-1.5 px-2.5 py-2 text-ui-sm transition-colors ${
                panel === each ? 'text-foreground' : 'text-foreground-subtle hover:text-foreground'
              }`}
              onClick={() => {
                setPanel(each);
              }}
            >
              {each === 'changes'
                ? t('library.aliasPage.changes', 'Changes')
                : t('library.aliasPage.problems', 'Problems')}
              <span
                className={`rounded-pill px-1.5 text-caption ${
                  each === 'problems' && count > 0
                    ? 'bg-danger/15 text-danger'
                    : 'bg-foreground/6 text-foreground-muted'
                }`}
              >
                {count}
              </span>
              {panel === each ? (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />
              ) : null}
            </button>
          );
        })}
        <span className="grow" />
        <span className="pr-2 text-caption text-foreground-subtle">
          {t('library.aliasPage.comparedWithSaved', 'Compared with the saved setup')}
        </span>
      </div>
      <div className="flex flex-col border-t border-border py-2">
        {panel === 'problems' ? (
          problems.length === 0 ? (
            <Empty>{t('library.aliasPage.noProblems', 'No problems')}</Empty>
          ) : (
            problems.map((problem) => (
              <div
                key={problem}
                className="flex items-center gap-2 px-4 py-1.5 text-ui-sm text-danger"
              >
                <AppIcon id="triangle-alert" size={13} className="shrink-0" />
                <span className="min-w-0 truncate">{problem}</span>
              </div>
            ))
          )
        ) : changes.length === 0 ? (
          <Empty>{t('library.aliasPage.sameAsSaved', 'Same as saved')}</Empty>
        ) : (
          changes.map((change) => {
            const [part = '', setting] = change.path.split('.');
            const ids = [change.after]
              .flat()
              .filter((value): value is string => typeof value === 'string');
            const bad =
              (setting === 'entity' || setting === 'entities') && ids.some((id) => missing.has(id));

            return (
              <div
                key={`${change.sign}${change.path}`}
                className="grid grid-cols-[16px_200px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-1.5 font-mono text-mono-caption"
              >
                <span
                  className={
                    change.sign === '+'
                      ? 'text-success'
                      : change.sign === '-'
                        ? 'text-danger'
                        : 'text-warning'
                  }
                >
                  {change.sign}
                </span>
                <span className="truncate text-foreground-muted">{change.path}</span>
                <span className="flex min-w-0 items-center gap-2 truncate">
                  {change.before === undefined ? null : (
                    <span className="truncate text-foreground-subtle line-through">
                      {shown(change.before)}
                    </span>
                  )}
                  {change.before !== undefined && change.after !== undefined ? (
                    <AppIcon
                      id="arrow-right"
                      size={12}
                      className="shrink-0 text-foreground-subtle"
                    />
                  ) : null}
                  {change.after === undefined ? null : bad ? (
                    <span className="truncate">
                      {ids.map((id) => (
                        <Ent key={id} id={id} isMissing={missing.has(id)} />
                      ))}
                    </span>
                  ) : (
                    <span className="truncate text-foreground">{shown(change.after)}</span>
                  )}
                </span>
                {bad && canEdit ? (
                  <span className="flex items-center gap-2 font-sans">
                    <span className="flex items-center gap-1.5 rounded-pill bg-danger/12 px-2 py-0.5 text-caption text-danger">
                      <AppIcon id="triangle-alert" size={12} />
                      {t('library.aliasPage.notInThisHouse', 'Not in this house')}
                    </span>
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() => {
                        keepOld(part);
                      }}
                    >
                      {t('library.aliasPage.keepOld', 'Keep the old one')}
                    </Button>
                  </span>
                ) : (
                  <span />
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="flex items-center gap-4 border-t border-border bg-canvas px-3 py-1.5 font-mono text-label text-foreground-subtle">
        {problems.length === 0 ? (
          <span className="flex items-center gap-1.5 text-success">
            <AppIcon id="check" size={12} />
            {t('library.aliasPage.valid', 'Valid')}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-danger">
            <AppIcon id="triangle-alert" size={12} />
            {t('library.aliasPage.problemCount', {
              count: problems.length,
              defaultValue_one: '{{count}} problem',
              defaultValue_other: '{{count}} problems',
            })}
          </span>
        )}
        <span>{t('library.aliasPage.json', 'JSON')}</span>
        <span className="grow" />
        <span>
          {changes.length === 0
            ? t('library.aliasPage.savedAgo', 'Saved {{when}}', { when: relativeTime(savedAt) })
            : t('library.aliasPage.changeCount', {
                count: changes.length,
                defaultValue_one: '{{count}} change',
                defaultValue_other: '{{count}} changes',
              })}
        </span>
      </div>
    </div>
  );
}

/**
 * A line saying a list is empty.
 *
 * @param props - The words.
 * @param props.children - The words.
 * @returns The line.
 */
function Empty(props: { readonly children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-ui-sm text-foreground-subtle">
      <AppIcon id="check" size={14} />
      {props.children}
    </div>
  );
}

/**
 * A word of the format, as a chip.
 *
 * @param props - The word.
 * @param props.children - The word.
 * @returns The chip.
 */
function Chip(props: { readonly children: ReactNode }) {
  return (
    <span className="rounded-[5px] border border-border bg-canvas px-1.5 font-mono text-mono-caption text-foreground-muted">
      {props.children}
    </span>
  );
}

/**
 * A heading of the format fold.
 *
 * @param props - The words.
 * @param props.children - The words.
 * @returns The heading.
 */
function Head(props: { readonly children: ReactNode }) {
  return (
    <span className="pb-1 font-mono text-label text-foreground-subtle uppercase">
      {props.children}
    </span>
  );
}

/**
 * What the file may hold: the types, the sources, the devices, this type's parts.
 *
 * @param props - The alias's type and parts.
 * @param props.type - The type.
 * @param props.defs - Its parts.
 * @returns The fold's body.
 */
export function FileFormatBody(props: {
  readonly type: AliasTypeDef;
  readonly defs: readonly AliasPartDef[];
}) {
  const { t } = useTranslation();
  const { type, defs } = props;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Head>{t('library.aliasPage.formatType', 'Type · behavesAs')}</Head>
        <span className="flex flex-wrap gap-1">
          {ALIAS_TYPES.map((each) => (
            <Chip key={each.id}>{each.id}</Chip>
          ))}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Head>{t('library.aliasPage.formatSource', 'Source · parts.*.from')}</Head>
        <span className="flex flex-wrap gap-1">
          {ALIAS_SOURCES.map((each) => (
            <Chip key={each}>{each}</Chip>
          ))}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Head>{t('library.aliasPage.formatDevice', 'Device')}</Head>
        <span className="flex flex-wrap gap-1">
          {FILE_DEVICES.map((each) => (
            <Chip key={each}>{each}</Chip>
          ))}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Head>{t('library.aliasPage.formatParts', '{{type}} parts', { type: type.label })}</Head>
        <span className="text-caption text-foreground-subtle">
          {t('library.aliases.required', 'Required')}
        </span>
        <span className="flex flex-wrap gap-1">
          {defs
            .filter((def) => def.isRequired)
            .map((def) => (
              <Chip key={def.key}>{def.key}</Chip>
            ))}
        </span>
        <span className="mt-1 text-caption text-foreground-subtle">
          {t('library.aliases.optional', 'Optional')}
        </span>
        <span className="flex flex-wrap gap-1">
          {defs
            .filter((def) => !def.isRequired)
            .map((def) => (
              <Chip key={def.key}>{def.key}</Chip>
            ))}
        </span>
      </div>
    </div>
  );
}

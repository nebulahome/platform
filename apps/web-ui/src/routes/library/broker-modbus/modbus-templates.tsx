/**
 * The Modbus broker's Templates tab: the owner's templates, and those the integrations ship.
 *
 * A template is a device's entities mapped to its registers. The owner's open in the editor, are
 * exported as their file and duplicated; a file is imported as a new one. An integration's are
 * grouped under it, folded but for the first, read-only: duplicated to be changed. The search
 * runs over every list, unfolding a group it finds something in.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import {
  modbusTemplateSchema,
  type ModbusTemplate,
  type ModbusTemplateRecord,
} from '@nebulahome/contracts';
import { AppIcon, Button, IconButton, RowList, Section, toast } from '@nebulahome/ui';

import { foldForSearch } from '@/lib/search-text';
import { saveJsonFile } from '@/library/library-file';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';

import { parseFile, documentOf } from './template-editor/template-model';

/** What the tab needs. */
export type ModbusTemplatesProps = {
  readonly templates: readonly ModbusTemplateRecord[];

  /** Saves a template as a new one of the owner's - a copy, a file - and opens it; absent when the person may not. */
  readonly onCreate?: ((document: ModbusTemplate) => void) | undefined;

  /** Removes one of the owner's templates no device uses; absent when the person may not. */
  readonly onRemove?: ((template: ModbusTemplateRecord) => void) | undefined;
};

/**
 * The file a template is exported as.
 *
 * @param template - The template.
 * @returns `waveshare-relay-8ch.json`.
 */
function fileNameOf(template: ModbusTemplate): string {
  const slug = template.name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '');

  return `${slug === '' ? 'template' : slug}.json`;
}

/**
 * Renders the tab.
 *
 * @param props - See {@link ModbusTemplatesProps}.
 * @returns The tab's content.
 */
export function ModbusTemplates(props: ModbusTemplatesProps) {
  const { t } = useTranslation();
  const { templates, onCreate, onRemove } = props;
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const picker = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const needle = foldForSearch(search.trim());

  /**
   * Whether a template is one the search keeps.
   *
   * @param template - The template.
   * @returns True to show it.
   */
  const isKept = (template: ModbusTemplateRecord): boolean =>
    needle === '' ||
    foldForSearch(
      [template.document.name, template.document.device, template.vendorName ?? ''].join(' '),
    ).includes(needle);
  const own = templates.filter((template) => template.vendorId === null);
  const groups = [...new Set(templates.flatMap((each) => each.vendorId ?? []))].map((vendorId) => {
    const all = templates.filter((each) => each.vendorId === vendorId);

    return { vendorId, name: all[0]?.vendorName ?? vendorId, all, kept: all.filter(isKept) };
  });
  const keptOwn = own.filter(isKept);
  const isNothing = keptOwn.length === 0 && groups.every((group) => group.kept.length === 0);

  /**
   * Whether a group is unfolded: the first unless folded, any the search finds something in.
   *
   * @param vendorId - The group.
   * @param index - Its place.
   * @returns True when unfolded.
   */
  const isOpen = (vendorId: string, index: number): boolean =>
    needle !== '' || open.has(vendorId) || (index === 0 && !closed.has(vendorId));

  /**
   * Folds or unfolds a group.
   *
   * @param vendorId - The group.
   * @param index - Its place.
   */
  const toggle = (vendorId: string, index: number): void => {
    const isNow = isOpen(vendorId, index);

    setOpen((current) => {
      const next = new Set(current);

      if (isNow) {
        next.delete(vendorId);
      } else {
        next.add(vendorId);
      }

      return next;
    });
    setClosed((current) => {
      const next = new Set(current);

      if (isNow) {
        next.add(vendorId);
      } else {
        next.delete(vendorId);
      }

      return next;
    });
  };

  /**
   * Imports a file as a new template.
   *
   * @param file - The file picked.
   */
  const importFile = async (file: File): Promise<void> => {
    const parsed = parseFile(await file.text());
    const checked =
      parsed.draft === null ? null : modbusTemplateSchema.safeParse(documentOf(parsed.draft));

    if (checked?.success === true) {
      onCreate?.(checked.data);

      return;
    }

    toast.error({
      title: t('brokers.modbus.importFailed', 'Couldn’t import {{file}}', { file: file.name }),
      message:
        parsed.error ??
        checked?.error.issues[0]?.message ??
        t('brokers.modbus.notTemplate', 'Not a template'),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          className="w-65 lg:w-72"
          placeholder={t('brokers.modbus.searchTemplates', 'Search templates')}
          value={search}
          onChange={setSearch}
        />
        {onCreate === undefined ? null : (
          <>
            <input
              ref={picker}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const [file] = event.target.files ?? [];

                event.target.value = '';

                if (file !== undefined) {
                  void importFile(file);
                }
              }}
            />
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                picker.current?.click();
              }}
            >
              <AppIcon id="upload" size={15} />
              {t('brokers.modbus.importFile', 'Import file')}
            </Button>
            <Button
              onClick={() => {
                void navigate('/brokers/modbus/templates/new');
              }}
            >
              <AppIcon id="plus" size={15} />
              {t('brokers.modbus.newTemplate', 'New template')}
            </Button>
          </>
        )}
      </div>

      {isNothing && needle !== '' ? (
        <NoMatches
          query={search}
          onClear={() => {
            setSearch('');
          }}
        />
      ) : (
        <>
          <Section title={t('brokers.modbus.yours', 'Yours')}>
            {own.length === 0 ? (
              <p className="text-ui text-foreground-subtle">
                {t(
                  'brokers.modbus.noTemplates',
                  'No template of yours yet. Start one, import a file, or duplicate an integration’s.',
                )}
              </p>
            ) : keptOwn.length === 0 ? null : (
              <RowList>
                {keptOwn.map((template) => (
                  <li key={template.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Link
                      to={`/brokers/modbus/templates/${template.id}`}
                      className="flex min-w-0 grow basis-60 items-center gap-3"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-field bg-cyan/14 text-cyan">
                        <AppIcon id="braces" size={15} />
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-ui font-medium text-foreground hover:text-primary">
                          {template.document.name}
                        </span>
                        <span className="truncate text-ui-sm text-foreground-muted">
                          {[
                            template.document.device,
                            t('brokers.modbus.entityCount', {
                              count: template.document.entities.length,
                              defaultValue_one: '{{count}} entity',
                              defaultValue_other: '{{count}} entities',
                            }),
                          ]
                            .filter((part) => part !== '')
                            .join(' · ')}
                        </span>
                      </span>
                    </Link>
                    <span className="text-ui-sm whitespace-nowrap text-foreground-subtle">
                      {template.usedBy === 0
                        ? t('brokers.modbus.unused', 'Not used')
                        : t('brokers.modbus.usedBy', {
                            count: template.usedBy,
                            defaultValue_one: 'Used by {{count}} device',
                            defaultValue_other: 'Used by {{count}} devices',
                          })}
                    </span>
                    <Button
                      variant="bare"
                      size="compact"
                      onClick={() => {
                        saveJsonFile(template.document, fileNameOf(template.document));
                      }}
                    >
                      {t('brokers.modbus.export', 'Export')}
                    </Button>
                    {onCreate === undefined ? null : (
                      <Button
                        variant="bare"
                        size="compact"
                        onClick={() => {
                          onCreate({
                            ...template.document,
                            name: t('brokers.modbus.copyOf', '{{name}} copy', {
                              name: template.document.name,
                            }).slice(0, 64),
                          });
                        }}
                      >
                        {t('brokers.modbus.duplicate', 'Duplicate')}
                      </Button>
                    )}
                    {onRemove === undefined || template.usedBy > 0 ? null : (
                      <IconButton
                        label={t('brokers.modbus.removeTemplate', 'Remove {{name}}', {
                          name: template.document.name,
                        })}
                        onClick={() => {
                          onRemove(template);
                        }}
                      >
                        <AppIcon id="trash-2" size={15} />
                      </IconButton>
                    )}
                  </li>
                ))}
              </RowList>
            )}
          </Section>

          {groups.length === 0 ? null : (
            <Section title={t('brokers.modbus.fromIntegrations', 'From integrations')}>
              <div className="flex flex-col gap-3">
                {groups.map((group, index) =>
                  needle !== '' && group.kept.length === 0 ? null : (
                    <div
                      key={group.vendorId}
                      className="overflow-hidden rounded-card border border-border bg-surface"
                    >
                      <button
                        type="button"
                        aria-expanded={isOpen(group.vendorId, index)}
                        className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-surface-raised"
                        onClick={() => {
                          toggle(group.vendorId, index);
                        }}
                      >
                        <AppIcon
                          id={isOpen(group.vendorId, index) ? 'chevron-down' : 'chevron-right'}
                          size={15}
                          className="text-foreground-subtle"
                        />
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-chip bg-surface-raised font-mono text-mono-ui text-foreground">
                          {group.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="grow text-ui font-medium text-foreground">
                          {group.name}
                        </span>
                        <span className="text-ui-sm text-foreground-subtle">
                          {needle === ''
                            ? t('brokers.modbus.templateCount', {
                                count: group.all.length,
                                defaultValue_one: '{{count}} template',
                                defaultValue_other: '{{count}} templates',
                              })
                            : t('brokers.modbus.someOf', '{{kept}} of {{all}}', {
                                kept: group.kept.length,
                                all: group.all.length,
                              })}
                        </span>
                      </button>
                      {isOpen(group.vendorId, index) ? (
                        <ul className="flex flex-col border-t border-border">
                          {group.kept.map((template) => (
                            <li
                              key={template.id}
                              className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3 first:border-t-0"
                            >
                              <span className="flex min-w-0 grow basis-60 flex-col gap-0.5 pl-7">
                                <span className="truncate text-ui font-medium text-foreground">
                                  {template.document.name}
                                </span>
                                <span className="truncate text-ui-sm text-foreground-muted">
                                  {[
                                    group.name,
                                    t('brokers.modbus.entityCount', {
                                      count: template.document.entities.length,
                                      defaultValue_one: '{{count}} entity',
                                      defaultValue_other: '{{count}} entities',
                                    }),
                                  ].join(' · ')}
                                </span>
                              </span>
                              {onCreate === undefined ? null : (
                                <Button
                                  variant="bare"
                                  size="compact"
                                  onClick={() => {
                                    onCreate(template.document);
                                  }}
                                >
                                  {t('brokers.modbus.duplicateToEdit', 'Duplicate to edit')}
                                </Button>
                              )}
                              <span
                                role="img"
                                aria-label={t('brokers.modbus.readOnly', 'Read only')}
                                title={t('brokers.modbus.readOnly', 'Read only')}
                                className="text-foreground-subtle"
                              >
                                <AppIcon id="lock" size={14} />
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ),
                )}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

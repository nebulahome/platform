/**
 * The template editor: one of the owner's Modbus templates, as blocks or as its file, switched
 * live.
 *
 * The way back is the trail Brokers › Modbus › Templates. The header says how many entities the
 * template has, how many devices use it, and where it stands - saved, unsaved changes, things to
 * fix, a file that does not parse - beside Blocks | File, Export and Save. Both views keep the
 * cards at the side: the template's fields, the device the tests read from, the function codes.
 *
 * The blocks and the file are one template: a change in the file that parses is the blocks at
 * once, and one that does not stays as typed, the blocks locked on the last valid version until it
 * does. Saving is refused while anything is wrong, and the devices that use the template read it
 * as saved at once.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import {
  modbusTemplateSchema,
  type ModbusDomain,
  type ModbusTarget,
  type ModbusTemplateRecord,
} from '@nebulahome/contracts';
import { AppIcon, Button, DetailHero, Note, Segmented, toast } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { saveJsonFile } from '@/library/library-file';
import {
  fetchModbusDevices,
  fetchModbusFound,
  fetchModbusTemplates,
  MODBUS_QUERY_KEYS,
  saveModbusTemplate,
  testModbusTemplate,
} from '@/library/modbus-api';
import { DetailFrame } from '@/routes/library/detail-page';

import { AddEntityDialog } from './add-entity-dialog';
import { EntityBlock, type LiveValue } from './entity-block';
import { TemplateAside, testChoicesOf, type TestChoice } from './template-aside';
import { TemplateFile } from './template-file';
import { domainLooks } from './template-meta';
import {
  documentOf,
  draftOf,
  emptyTemplate,
  entityOf,
  fileOf,
  parseFile,
  problemsOf,
  type TemplateDraft,
} from './template-model';

/** How the template is shown. */
type View = 'blocks' | 'file';

/**
 * A new template, from what the add dialog knew of the device.
 *
 * @param params - The page's query: `host`, `port`, `unit`, `device`.
 * @returns The blocks.
 */
function newDraftOf(params: URLSearchParams): TemplateDraft {
  return {
    ...emptyTemplate(),
    device: params.get('device') ?? '',
    port: params.get('port') ?? '502',
    unitId: params.get('unit') ?? '1',
  };
}

/**
 * The device the add dialog was reading, when it sent the owner here.
 *
 * @param params - The page's query.
 * @returns The device, or null.
 */
function targetOf(params: URLSearchParams): ModbusTarget | null {
  const host = params.get('host');

  return host === null || host === ''
    ? null
    : {
        host,
        port: Number(params.get('port') ?? 502),
        unitId: Number(params.get('unit') ?? 1),
        framing: params.get('framing') === 'rtu' ? 'rtu' : 'tcp',
      };
}

/**
 * The name a template's file is exported as.
 *
 * @param name - The template's name.
 * @returns `waveshare-relay-8ch.json`.
 */
function fileNameOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '');

  return `${slug === '' ? 'template' : slug}.json`;
}

/**
 * Renders the editor's page: the template read, or a new one; the editor once it is there.
 *
 * @returns The page.
 */
export function ModbusTemplatePage() {
  const { t } = useTranslation();
  const { templateId = 'new' } = useParams();
  const [params] = useSearchParams();
  const isNew = templateId === 'new';

  const templates = useQuery({
    queryKey: MODBUS_QUERY_KEYS.templates,

    /**
     * Reads the templates.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The templates.
     */
    queryFn: async ({ signal }) => fetchModbusTemplates(signal),
  });
  const devices = useQuery({
    queryKey: MODBUS_QUERY_KEYS.devices,

    /**
     * Reads the devices, for the test device.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchModbusDevices(signal),
  });
  const found = useQuery({
    queryKey: MODBUS_QUERY_KEYS.found,

    /**
     * Reads the servers found, for the test device.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Them.
     */
    queryFn: async ({ signal }) => fetchModbusFound(signal),
  });
  const record = isNew ? undefined : templates.data?.find((each) => each.id === templateId);
  const choices = testChoicesOf(
    isNew ? undefined : templateId,
    devices.data ?? [],
    found.data?.items ?? [],
    t('brokers.modbus.unknown', 'Unknown device'),
  );

  if (!isNew && templates.isSuccess && record === undefined) {
    return (
      <DetailFrame isPending={false} error={null} hero={null}>
        <Note tone="danger">
          {t('brokers.modbus.noTemplate', 'There is no such template of yours.')}{' '}
          <Link to="/brokers/modbus?tab=templates" className="underline">
            {t('brokers.modbus.backToTemplates', 'Back to the templates')}
          </Link>
        </Note>
      </DetailFrame>
    );
  }

  if (!isNew && record === undefined) {
    return (
      <DetailFrame isPending error={templates.error} hero={null}>
        {null}
      </DetailFrame>
    );
  }

  return (
    <TemplateEditor
      record={record}
      savedId={isNew ? undefined : templateId}
      params={params}
      choices={choices}
    />
  );
}

/** What the editor needs. */
type TemplateEditorProps = {
  /** The template as saved; undefined for a new one. */
  readonly record: ModbusTemplateRecord | undefined;
  readonly savedId: string | undefined;

  /** The page's query: what the add dialog knew of the device. */
  readonly params: URLSearchParams;
  readonly choices: readonly TestChoice[];
};

/**
 * Renders the editor, from the template as it was when the page opened.
 *
 * @param props - See {@link TemplateEditorProps}.
 * @returns The page.
 */
function TemplateEditor(props: TemplateEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { record, savedId, params, choices } = props;
  const isNew = savedId === undefined;
  const [initial] = useState(() =>
    record === undefined ? newDraftOf(params) : draftOf(record.document),
  );
  const [draft, setDraft] = useState<TemplateDraft>(initial);
  const [savedText, setSavedText] = useState<string | null>(() =>
    record === undefined ? null : JSON.stringify(documentOf(initial)),
  );
  const [view, setView] = useState<View>('blocks');
  const [fileText, setFileText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [picked, setTarget] = useState<ModbusTarget | null>(() => targetOf(params));
  const [live, setLive] = useState<ReadonlyMap<string, LiveValue>>(new Map());
  const [readAt, setReadAt] = useState<Date | null>(null);

  // The first device that uses the template is what the tests read from, until the owner picks.
  const target = picked ?? choices.find((choice) => choice.group === 'uses')?.target ?? null;

  const save = useMutation({
    /**
     * Saves the template.
     *
     * @param document - It, checked.
     * @returns It, saved, every entity with its id.
     */
    mutationFn: saveModbusTemplate,

    /**
     * Takes what was saved as the blocks - every entity has its id now - and opens a new
     * template at its own address.
     *
     * @param saved - The template saved.
     */
    onSuccess: (saved) => {
      const blocks = draftOf(saved.document);

      setDraft((current) => ({
        ...blocks,
        entities: blocks.entities.map((entity, index) => ({
          ...entity,
          key: current.entities[index]?.key ?? entity.key,
        })),
      }));
      setSavedText(JSON.stringify(documentOf(blocks)));
      setFileText(fileOf(blocks));
      toast.success({
        title: t('brokers.modbus.templateSaved', 'Template saved'),
        ...(saved.usedBy === 0
          ? {}
          : {
              message: t('brokers.modbus.devicesReread', {
                count: saved.usedBy,
                defaultValue_one: 'Its device reads it now.',
                defaultValue_other: 'Its {{count}} devices read it now.',
              }),
            }),
      });

      if (isNew) {
        // Known before the list is read again, so the page finds it at its new address.
        queryClient.setQueryData<ModbusTemplateRecord[]>(MODBUS_QUERY_KEYS.templates, (list) => [
          ...(list ?? []),
          saved,
        ]);
        void navigate(`/brokers/modbus/templates/${saved.id}`, { replace: true });
      }
    },

    /**
     * Says why it is not saved.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.modbus.saveFailed', 'Couldn’t save the template'),
        message: toMessage(error),
      });
    },

    /** Reads the templates and the devices again. */
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['brokers', 'modbus'] });
    },
  });
  const readAll = useMutation({
    mutationFn: testModbusTemplate,

    /**
     * Shows each value on its block.
     *
     * @param reply - What was read.
     */
    onSuccess: (reply) => {
      const { entities } = draft;

      setLive(
        new Map(
          reply.values.map((each) => [
            `${entities[each.entity]?.key ?? ''}:${each.capability}`,
            { value: each.value, error: each.error },
          ]),
        ),
      );
      setReadAt(reply.at);
    },

    /**
     * Says why nothing was read.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.modbus.readAllFailed', 'Couldn’t read the device'),
        message: toMessage(error),
      });
    },
  });

  const problems = problemsOf(draft);
  const isDirty = JSON.stringify(documentOf(draft)) !== savedText;
  const name = draft.name.trim();
  const capabilities = draft.entities.reduce(
    (sum, entity) => sum + Object.keys(entity.capabilities).length,
    0,
  );
  const standing =
    fileError !== null
      ? t('brokers.modbus.fileHasError', 'the file has an error')
      : problems.size > 0
        ? t('brokers.modbus.thingsToFix', {
            count: problems.size,
            defaultValue_one: '{{count}} thing to fix',
            defaultValue_other: '{{count}} things to fix',
          })
        : isDirty
          ? t('brokers.modbus.unsaved', 'unsaved changes')
          : t('brokers.modbus.saved', 'saved');

  /**
   * Changes the blocks; what Read all showed no longer holds for an entity that changed.
   *
   * @param next - The blocks.
   */
  const change = (next: TemplateDraft): void => {
    setDraft(next);
  };

  /**
   * Shows the template as blocks or as its file.
   *
   * @param next - The view.
   */
  const show = (next: View): void => {
    if (next === 'blocks' && fileError !== null) {
      return;
    }

    if (next === 'file') {
      setFileText(fileOf(draft));
      setFileError(null);
    }

    setView(next);
  };

  /**
   * Takes a change in the file: blocks when it parses, the error when it does not.
   *
   * @param value - The file.
   */
  const changeFile = (value: string): void => {
    setFileText(value);

    const parsed = parseFile(value, draft);

    if (parsed.draft === null) {
      setFileError(parsed.error);
    } else {
      setDraft(parsed.draft);
      setFileError(null);
    }
  };

  return (
    <DetailFrame
      isPending={false}
      error={null}
      hero={
        <DetailHero
          back={
            <nav
              aria-label={t('brokers.modbus.trail', 'Where you are')}
              className="flex flex-wrap items-center gap-1.5 text-ui-sm text-foreground-muted"
            >
              <Link to="/brokers" className="hover:text-foreground">
                {t('brokers.title', 'Brokers')}
              </Link>
              <AppIcon id="chevron-right" size={13} />
              <Link to="/brokers/modbus" className="hover:text-foreground">
                {t('brokers.modbus.title', 'Modbus')}
              </Link>
              <AppIcon id="chevron-right" size={13} />
              <Link to="/brokers/modbus?tab=templates" className="hover:text-foreground">
                {t('brokers.modbus.templates', 'Templates')}
              </Link>
              <AppIcon id="chevron-right" size={13} />
              <span className="text-foreground">
                {name === '' ? t('brokers.modbus.newTemplate', 'New template') : name}
              </span>
            </nav>
          }
          mark={
            <span className="flex size-14 items-center justify-center rounded-inner border border-border-strong bg-surface-raised modbus-glow text-cyan">
              <AppIcon id="braces" size={26} />
            </span>
          }
          title={name === '' ? t('brokers.modbus.newTemplate', 'New template') : name}
          description={[
            t('brokers.modbus.template', 'Template'),
            t('brokers.modbus.entityCount', {
              count: draft.entities.length,
              defaultValue_one: '{{count}} entity',
              defaultValue_other: '{{count}} entities',
            }),
            ...(record === undefined || record.usedBy === 0
              ? []
              : [
                  t('brokers.modbus.usedByLower', {
                    count: record.usedBy,
                    defaultValue_one: 'used by {{count}} device',
                    defaultValue_other: 'used by {{count}} devices',
                  }),
                ]),
            standing,
          ].join(' · ')}
          actions={
            <>
              <Segmented
                label={t('brokers.modbus.view', 'View')}
                value={view}
                onChange={show}
                options={[
                  { value: 'blocks', label: t('brokers.modbus.blocksView', 'Blocks') },
                  { value: 'file', label: t('brokers.modbus.fileView', 'File') },
                ]}
              />
              <Button
                variant="ghost"
                onClick={() => {
                  saveJsonFile(documentOf(draft), fileNameOf(name));
                }}
              >
                <AppIcon id="download" size={15} />
                {t('brokers.modbus.export', 'Export')}
              </Button>
              <Button
                isBusy={save.isPending}
                disabled={
                  save.isPending ||
                  fileError !== null ||
                  problems.size > 0 ||
                  (!isDirty && !isNew) ||
                  record?.isReadOnly === true
                }
                onClick={() => {
                  const checked = modbusTemplateSchema.safeParse(documentOf(draft));

                  if (checked.success) {
                    save.mutate({ id: savedId, document: checked.data });
                  }
                }}
              >
                {t('common.save', 'Save')}
              </Button>
            </>
          }
        />
      }
    >
      {
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(17.5rem,21.25rem)]">
          <div className="flex min-w-0 flex-col gap-3.5">
            {view === 'file' ? (
              <>
                {fileError === null ? null : (
                  <Note tone="warning">
                    {t(
                      'brokers.modbus.fixFileFirst',
                      'Fix the file before going back to blocks: they keep the last valid version until it parses.',
                    )}
                  </Note>
                )}
                <TemplateFile
                  text={fileText}
                  fileName={fileNameOf(name)}
                  error={fileError}
                  entities={draft.entities.length}
                  capabilities={capabilities}
                  onChange={changeFile}
                  onFormat={() => {
                    setFileText(fileOf(draft));
                  }}
                />
              </>
            ) : (
              <>
                {draft.entities.map((entity, index) => (
                  <EntityBlock
                    key={entity.key}
                    entity={entity}
                    index={index}
                    problems={problems}
                    wordOrder={draft.wordOrder}
                    target={target}
                    live={live}
                    onChange={(next) => {
                      change({
                        ...draft,
                        entities: draft.entities.map((each) =>
                          each.key === entity.key ? next : each,
                        ),
                      });
                    }}
                    onRemove={() => {
                      change({
                        ...draft,
                        entities: draft.entities.filter((each) => each.key !== entity.key),
                      });
                    }}
                  />
                ))}
                {problems.get('entities') === undefined ? null : (
                  <p role="alert" className="text-ui-sm text-danger">
                    {problems.get('entities')}
                  </p>
                )}
                <button
                  type="button"
                  className="flex h-14 items-center justify-center gap-2 rounded-card border border-dashed border-border-strong text-ui text-foreground-muted hover:border-primary hover:text-foreground"
                  onClick={() => {
                    setIsAdding(true);
                  }}
                >
                  <AppIcon id="plus" size={16} />
                  {t('brokers.modbus.addEntity', 'Add an entity')}
                </button>
              </>
            )}
          </div>
          <TemplateAside
            draft={draft}
            problems={problems}
            isLocked={fileError !== null}
            onChange={change}
            choices={choices}
            target={target}
            onTarget={setTarget}
            readAt={readAt}
            isReading={readAll.isPending}
            onReadAll={() => {
              const checked = modbusTemplateSchema.safeParse(documentOf(draft));

              if (target === null) {
                return;
              }

              if (!checked.success) {
                toast.warning({
                  title: t(
                    'brokers.modbus.fixBeforeRead',
                    'Fix the template before reading it all',
                  ),
                  message: checked.error.issues[0]?.message ?? '',
                });

                return;
              }

              readAll.mutate({ target, document: checked.data });
            }}
          />
        </div>
      }
      <AddEntityDialog
        isOpen={isAdding}
        onClose={() => {
          setIsAdding(false);
        }}
        onPick={(domain: ModbusDomain) => {
          const look = domainLooks()[domain];
          const same = draft.entities.filter((entity) => entity.domain === domain).length;

          change({
            ...draft,
            entities: [...draft.entities, entityOf(domain, `${look.label} ${String(same + 1)}`)],
          });
        }}
      />
    </DetailFrame>
  );
}

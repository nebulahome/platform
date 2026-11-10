/**
 * One alias: its hero (back to the aliases, its mark, Edited or Failing, its type, area and
 * device; Enabled, a menu, and Discard and Save once anything changed), its tabs - Parts, Code
 * (when a part comes from code), File, History - and the card of folds beside them, which Hide
 * panel puts away.
 *
 * Save stays on the page. Everything the tabs change is one draft, saved together.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import {
  aliasCodeExpectation,
  checkCode,
  functionTemplate,
  type AliasCustomField,
  type AliasDetail,
  type AliasPartDef,
  type AliasUpdate,
  type AliasView,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  DetailHero,
  HeroFact,
  HeroMark,
  Modal,
  Note,
  OverflowMenu,
  Pill,
  Switch,
  Tabs,
  toast,
  type UiIconId,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/format-time';
import { useTab } from '@/lib/use-tab';
import { aliasDefs, typeLabel, typeOf, uiIcon } from '@/library/alias-model';
import { fetchAlias, LIBRARY_QUERY_KEYS, updateAlias } from '@/library/api';
import { readingOf } from '@/library/entity-reading';
import { useInstalledPackages } from '@/packages/use-packages';
import { useStateChanges } from '@/routes/dashboard/cards/use-card-history';
import {
  AliasCodeTab,
  CodeSideFolds,
  failingCases,
  type CaseRun,
} from '@/routes/library/aliases/alias-code-tab';
import { DeleteAliasDialog } from '@/routes/library/aliases/alias-dialogs';
import { AliasFileTab, FileFormatBody } from '@/routes/library/aliases/alias-file-tab';
import { AliasHistoryTab } from '@/routes/library/aliases/alias-history-tab';
import { AliasParts, DisplaySection } from '@/routes/library/aliases/alias-parts';
import {
  DetailsBody,
  Fold,
  InputsBody,
  PreviewBody,
  Side,
  UsedByBody,
} from '@/routes/library/aliases/alias-side';
import { AliasIcon } from '@/routes/library/aliases/alias-text';
import { useAliasActions } from '@/routes/library/aliases/aliases-page';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';

/** What the page edits, saved together. */
export type AliasDraft = Pick<
  AliasView,
  'name' | 'icon' | 'parts' | 'code' | 'cases' | 'memory' | 'ifOneStops' | 'debounceMs' | 'display'
> & {
  /** The area's key; null for none. */
  readonly area: string | null;
};

/** The tabs, the first the one a plain address opens. */
const TABS = ['parts', 'code', 'file', 'history'] as const;

/** One tab. */
type AliasTab = (typeof TABS)[number];

/**
 * An alias's draft as saved.
 *
 * @param alias - The alias.
 * @returns The draft.
 */
export function draftOf(alias: AliasView): AliasDraft {
  return {
    name: alias.name,
    icon: alias.icon,
    area: alias.area?.key ?? null,
    parts: alias.parts,
    code: alias.code,
    cases: alias.cases,
    memory: alias.memory,
    ifOneStops: alias.ifOneStops,
    debounceMs: alias.debounceMs,
    display: alias.display,
  };
}

/**
 * What changed between two drafts, as a PATCH body.
 *
 * @param before - As saved.
 * @param after - As edited.
 * @returns The fields that differ.
 */
export function changesOf(before: AliasDraft, after: AliasDraft): AliasUpdate {
  const changes: Record<string, unknown> = {};

  for (const key of Object.keys(after) as (keyof AliasDraft)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = after[key];
    }
  }

  return changes;
}

/**
 * The alias page.
 *
 * @returns The page.
 */
export function AliasPage() {
  const { t } = useTranslation();
  const { aliasId = '' } = useParams();
  const detail = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.aliases, aliasId],
    /**
     * Reads the alias whole.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The alias, its inputs and its users.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAlias(aliasId, signal),
  });

  if (detail.data === undefined) {
    return (
      <DetailFrame
        hero={
          <DetailHero
            back={<BackLink to="/aliases">{t('library.aliases.aliases', 'Aliases')}</BackLink>}
            title={t('library.aliasPage.alias', 'Alias')}
          />
        }
        isPending={detail.isPending}
        error={detail.error}
      >
        {null}
      </DetailFrame>
    );
  }

  return <LoadedAliasPage key={aliasId} detail={detail.data} isFetching={detail.isFetching} />;
}

/**
 * The page once the alias is read.
 *
 * @param props - The alias whole, and whether it is being read again.
 * @param props.detail - The alias.
 * @param props.isFetching - Whether a newer answer is on its way.
 * @returns The page.
 */
function LoadedAliasPage(props: { readonly detail: AliasDetail; readonly isFetching: boolean }) {
  const { t } = useTranslation();
  const { detail, isFetching } = props;
  const { alias } = detail;
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const canWrite = can('alias:write');
  const canEditCode = canWrite && detail.developerMode;
  const actions = useAliasActions();
  const { packages } = useInstalledPackages();
  const { entities, readings } = useEntityDirectory(false);
  const [seededFrom, setSeededFrom] = useState(alias);
  const [initial, setInitial] = useState(() => draftOf(alias));
  const [draft, setDraft] = useState(() => draftOf(alias));
  const [isPanel, setPanel] = useState(true);
  const [isDeleting, setDeleting] = useState(false);
  const [failing, setFailing] = useState<readonly CaseRun[] | null>(null);
  const [codeAt, setCodeAt] = useState<string | null>(null);
  const [resets, setResets] = useState(0);
  const [openedAt] = useState(Date.now);
  const [tab, setTab] = useTab<AliasTab>(TABS);
  const isEdited = JSON.stringify(draft) !== JSON.stringify(initial);

  // A newer answer replaces what is shown while nothing is edited: a command changes a stored
  // value, and `core` writes it back into the parts.
  if (alias !== seededFrom && !isFetching) {
    setSeededFrom(alias);

    if (!isEdited) {
      setInitial(draftOf(alias));
      setDraft(draftOf(alias));
    }
  }

  const type = typeOf(alias.behavesAs);
  const customFields =
    alias.customType === null
      ? undefined
      : (packages
          .find((each) => each.id === alias.customType?.packageId)
          ?.entityTypes.find((each) => each.id === alias.customType?.type)?.state as
          readonly AliasCustomField[] | undefined);
  const defs = aliasDefs(alias.behavesAs, customFields);
  const entity = entities.find((each) => each.entityId === alias.entityId);
  const state = readings[alias.entityId]?.state ?? entity?.state;
  const hasCode = Object.values(draft.parts).some((part) => part.from === 'code');
  const shown: AliasTab = tab === 'code' && !hasCode ? 'parts' : tab;
  const history = useStateChanges(alias.entityId, '24h', can('history:read'));
  const known = new Set(entities.map((each) => each.entityId as string));
  const check = checkCode(draft.code, {
    parts: defs.flatMap((def) => {
      const config = draft.parts[def.key];

      return config?.from === 'code'
        ? [
            {
              key: def.key,
              functionName: config.function,
              expectation: aliasCodeExpectation(def, config),
            },
          ]
        : [];
    }),
    /**
     * Whether an entity is in the house; any while the house is not read yet.
     *
     * @param entityId - The entity.
     * @returns True when it is.
     */
    knownEntity: (entityId) => known.size === 0 || known.has(entityId),
    partKeys: Object.keys(draft.parts),
  });

  const save = useMutation({
    /**
     * Saves what changed.
     *
     * @param sent - The draft as sent.
     * @returns The alias as saved.
     */
    mutationFn: async (sent: AliasDraft) => updateAlias(alias.id, changesOf(initial, sent)),

    /**
     * Keeps what was sent as saved, and reads the alias again.
     *
     * @param view - The alias as saved.
     */
    onSuccess: async (view) => {
      setInitial(draftOf(view));
      setDraft(draftOf(view));
      setSeededFrom(view);
      setResets((count) => count + 1);
      setFailing(null);
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.aliases });
      toast.success({
        title: t('library.aliasPage.saved', '{{name}} saved', { name: alias.name }),
      });
    },

    /**
     * Says why it was not saved.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('library.aliasPage.notSaved', 'Not saved'),
        message: toMessage(error),
      });
    },
  });

  /**
   * Saves, after trying the code's cases: failing ones ask first.
   */
  const onSave = async (): Promise<void> => {
    const failed =
      draft.cases.length === 0 ? [] : await failingCases(draft.code, draft.cases, alias.memory);

    if (failed.length > 0) {
      setFailing(failed);
      return;
    }

    save.mutate(draft);
  };

  /**
   * Opens the Code tab at a function, adding it from the part's template when asked.
   *
   * @param name - The function.
   * @param template - The part to start a new function for.
   * @param template.def - The part.
   */
  const openCode = (name: string, template?: { readonly def: AliasPartDef }): void => {
    if (template !== undefined && !check.functions.some((fn) => fn.name === name)) {
      const config = draft.parts[template.def.key];
      const body = functionTemplate(
        name,
        config === undefined ? { kind: 'text' } : aliasCodeExpectation(template.def, config),
      );

      setDraft((current) => ({
        ...current,
        code:
          current.code.trim() === '' ? body : `${current.code.replace(/\n*$/u, '')}\n\n\n${body}`,
      }));
    }

    setCodeAt(name);
    setTab('code');
  };

  const now = entity === undefined ? undefined : readingOf(entity, readings[alias.entityId]).text;

  /**
   * The Preview fold.
   *
   * @param isOpen - Whether it starts open.
   * @returns The fold.
   */
  const preview = (isOpen: boolean) => (
    <Fold title={t('library.aliasPage.preview', 'Preview')} isOpen={isOpen} meta={now}>
      <PreviewBody entityId={alias.entityId} isEdited={isEdited} />
    </Fold>
  );
  const usedBy = (
    <Fold
      title={t('library.aliasPage.usedBy', 'Used by')}
      meta={String(
        detail.usedBy.automations.length +
          detail.usedBy.scenes.length +
          detail.usedBy.dashboards.length +
          detail.usedBy.aliases.length,
      )}
    >
      <UsedByBody usedBy={detail.usedBy} />
    </Fold>
  );
  const side =
    shown === 'code' ? (
      <Side>
        {preview(false)}
        <CodeSideFolds
          code={draft.code}
          check={check}
          inputs={detail.inputs}
          parts={draft.parts}
          defs={defs}
          state={state}
          memory={alias.memory}
          functionName={codeAt}
          canEdit={canEditCode}
          onInsert={(snippet) => {
            setDraft((current) => ({
              ...current,
              code: `${current.code.replace(/\n*$/u, '')}\n${snippet}\n`,
            }));
          }}
        />
        {usedBy}
      </Side>
    ) : shown === 'file' ? (
      <Side>
        {preview(false)}
        <Fold title={t('library.aliasPage.fileFormat', 'File format')} isOpen>
          <FileFormatBody type={type} defs={defs} />
        </Fold>
        {usedBy}
      </Side>
    ) : (
      <Side>
        {preview(true)}
        <Fold title={t('library.aliasPage.inputs', 'Inputs')} meta={String(detail.inputs.length)}>
          <InputsBody inputs={detail.inputs} />
        </Fold>
        {usedBy}
        <Fold title={t('library.aliasPage.details', 'Details')} meta={alias.entityId}>
          <DetailsBody
            alias={alias}
            policy={draft.ifOneStops}
            onPolicy={(ifOneStops) => {
              setDraft({ ...draft, ifOneStops });
            }}
            canEdit={canWrite}
          />
        </Fold>
      </Side>
    );

  const titleAside = isEdited ? (
    <Pill tone="warning">{t('library.aliasPage.edited', 'Edited')}</Pill>
  ) : alias.health === 'failing' ? (
    <Pill tone="danger">{t('library.aliases.failing', 'Failing')}</Pill>
  ) : alias.health === 'unavailable' ? (
    <Pill tone="warning">{t('library.aliases.unavailable', 'Unavailable')}</Pill>
  ) : undefined;

  const hero = (
    <DetailHero
      back={<BackLink to="/aliases">{t('library.aliases.aliases', 'Aliases')}</BackLink>}
      mark={
        <HeroMark>
          <AliasIcon id={alias.icon ?? type.icon} size={24} />
        </HeroMark>
      }
      title={alias.name}
      titleAside={titleAside}
      facts={
        <>
          <HeroFact icon={uiIcon(type.icon)}>
            {alias.display.deviceClass === null
              ? typeLabel(type)
              : `${typeLabel(type)} · ${alias.display.deviceClass}`}
          </HeroFact>
          {alias.area === null ? null : <HeroFact icon="map-pin">{alias.area.name}</HeroFact>}
          <HeroFact icon={alias.device.isVirtual ? 'layers' : 'cpu'}>
            <span className="text-foreground-subtle">{t('library.aliases.device', 'Device')}</span>
            {alias.device.isShared
              ? t('library.aliasPage.aliasesVirtual', 'Aliases · virtual')
              : alias.device.isVirtual
                ? `${alias.device.name} · ${t('library.aliases.virtual', 'virtual')}`
                : alias.device.name}
          </HeroFact>
        </>
      }
      actions={
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span className="mr-1 flex items-center gap-2.5 text-ui-sm text-foreground-muted">
            {t('library.aliases.enabled', 'Enabled')}
            <Switch
              label={t('library.aliases.enabled', 'Enabled')}
              isOn={alias.isEnabled}
              disabled={!canWrite}
              onChange={(isEnabled) => {
                actions.setEnabled(alias.id, isEnabled);
              }}
            />
          </span>
          <OverflowMenu
            label={t('library.aliasPage.more', 'More')}
            items={[
              ...(canWrite
                ? [
                    {
                      label: t('library.aliases.duplicate', 'Duplicate'),
                      icon: 'copy' as UiIconId,
                      /** Duplicate. */
                      onSelect: () => {
                        actions.duplicate(alias);
                      },
                    },
                  ]
                : []),
              {
                label: t('library.aliases.exportFile', 'Export as a file'),
                icon: 'upload',
                /** Export as a file. */
                onSelect: () => {
                  actions.exportFile([alias.id], `${alias.key}.aliases.json`);
                },
              },
              ...(canWrite
                ? [
                    {
                      label: t('common.delete', 'Delete'),
                      icon: 'trash-2' as UiIconId,
                      tone: 'danger' as const,
                      /** Delete. */
                      onSelect: () => {
                        setDeleting(true);
                      },
                    },
                  ]
                : []),
            ]}
          />
          {isEdited && canWrite ? (
            <>
              <Button
                variant="bare"
                onClick={() => {
                  setDraft(initial);
                  setResets(resets + 1);
                }}
              >
                {t('library.aliasPage.discard', 'Discard')}
              </Button>
              <Button
                isBusy={save.isPending}
                onClick={() => {
                  void onSave();
                }}
              >
                <AppIcon id="check" size={15} />
                {t('common.save', 'Save')}
              </Button>
            </>
          ) : null}
        </span>
      }
      tabs={
        <div className="relative">
          <Tabs
            label={t('library.aliasPage.alias', 'Alias')}
            idPrefix="alias"
            items={[
              {
                id: 'parts' as const,
                label: t('library.aliasPage.parts', 'Parts'),
                count: Object.keys(draft.parts).length,
              },
              ...(hasCode
                ? [{ id: 'code' as const, label: t('library.aliasPage.code', 'Code') }]
                : []),
              { id: 'file' as const, label: t('library.aliasPage.file', 'File') },
              { id: 'history' as const, label: t('library.aliasPage.history', 'History') },
            ]}
            value={shown}
            onChange={setTab}
          />
          <span className="absolute right-0 bottom-1.5 hidden lg:block">
            <Button
              variant="bare"
              size="compact"
              onClick={() => {
                setPanel(!isPanel);
              }}
            >
              <AppIcon id="columns-2" size={14} />
              {isPanel
                ? t('library.aliasPage.hidePanel', 'Hide panel')
                : t('library.aliasPage.showPanel', 'Show panel')}
            </Button>
          </span>
        </div>
      }
    />
  );

  const error = alias.lastError;

  return (
    <DetailFrame hero={hero}>
      <div
        className={`grid items-start gap-8 ${isPanel ? 'lg:grid-cols-[minmax(0,1fr)_340px]' : ''}`}
      >
        <div className="flex min-w-0 flex-col gap-6">
          {error !== null && shown !== 'code' ? (
            <Note
              tone="danger"
              action={
                error.function === null || !hasCode ? undefined : (
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => {
                      setCodeAt(error.function);
                      setTab('code');
                    }}
                  >
                    {t('library.aliasPage.openInCode', 'Open in Code')}
                  </Button>
                )
              }
            >
              {error.line === null
                ? error.message
                : t('library.aliasPage.errorAtLine', '{{message}} · line {{line}}', {
                    message: error.message,
                    line: error.line,
                  })}
              {' · '}
              {t('library.aliasPage.errorSince', 'since {{when}}, {{count}} times', {
                when: relativeTime(error.since),
                count: error.count,
              })}
            </Note>
          ) : null}

          {shown === 'parts' ? (
            <>
              <AliasParts
                type={type}
                defs={defs}
                parts={draft.parts}
                saved={initial.parts}
                onChange={(parts) => {
                  setDraft({ ...draft, parts });
                }}
                state={state}
                unit={alias.display.unit}
                history={history?.points}
                window={history?.window ?? { from: openedAt - 86_400_000, to: openedAt }}
                canEdit={canWrite}
                canUseCode={canEditCode}
                functions={check.functions}
                onOpenCode={openCode}
              />
              <DisplaySection
                type={type}
                display={draft.display}
                canEdit={canWrite}
                onChange={(display) => {
                  setDraft({ ...draft, display });
                }}
              />
            </>
          ) : null}
          {shown === 'code' ? (
            <AliasCodeTab
              alias={alias}
              draft={draft}
              defs={defs}
              check={check}
              state={state}
              canEdit={canEditCode}
              canWrite={canWrite}
              isEdited={isEdited}
              functionName={codeAt}
              onChange={(change) => {
                setDraft((current) => ({ ...current, ...change }));
              }}
              onSave={() => {
                void onSave();
              }}
            />
          ) : null}
          {shown === 'file' ? (
            <AliasFileTab
              key={resets}
              alias={alias}
              saved={initial}
              draft={draft}
              defs={defs}
              canEdit={canWrite}
              savedAt={alias.lastEvaluatedAt ?? alias.createdAt}
              onChange={(next) => {
                setDraft(next);
              }}
            />
          ) : null}
          {shown === 'history' ? <AliasHistoryTab alias={alias} defs={defs} /> : null}
        </div>
        {isPanel ? side : null}
      </div>

      <DeleteAliasDialog
        alias={isDeleting ? alias : null}
        isOnItsPage
        onClose={() => {
          setDeleting(false);
        }}
      />
      <Modal
        isOpen={failing !== null}
        size="medium"
        layout="card"
        title={t('library.aliasPage.casesFail', {
          count: failing?.length ?? 0,
          defaultValue_one: '{{count}} case fails',
          defaultValue_other: '{{count}} cases fail',
        })}
        onClose={() => {
          setFailing(null);
        }}
        footer={
          <>
            <span />
            <span className="flex items-center gap-2">
              <Button
                variant="bare"
                onClick={() => {
                  setFailing(null);
                }}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                isBusy={save.isPending}
                onClick={() => {
                  save.mutate(draft);
                }}
              >
                {t('library.aliasPage.saveAnyway', 'Save anyway')}
              </Button>
            </span>
          </>
        }
      >
        <ul className="flex flex-col gap-1.5 text-ui-sm">
          {(failing ?? []).map((run) => (
            <li key={run.id} className="flex items-center gap-2">
              <AppIcon id="circle-x" size={13} className="shrink-0 text-danger" />
              <span className="font-medium">{run.name}</span>
              <span className="truncate text-foreground-subtle">{run.message}</span>
            </li>
          ))}
        </ul>
      </Modal>
    </DetailFrame>
  );
}

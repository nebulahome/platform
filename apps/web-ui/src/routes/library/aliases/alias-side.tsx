/**
 * The card beside an alias's tabs: one card of folds. Preview (the real entity card, its controls
 * active once the alias is saved), Inputs (what it reads, now), Used by (what stops working if it
 * goes), Details (its id, device, area, what it does when an input goes silent, when it was made).
 * The Code and File tabs put their own folds in the same card.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  ALIAS_FALLBACK_POLICIES,
  type AliasDetail,
  type AliasFallbackPolicy,
} from '@nebulahome/contracts';
import { AppIcon, IconButton, SelectField, toast } from '@nebulahome/ui';

import { defineMessage, text, type Message } from '@/i18n/messages';
import { copyText } from '@/lib/clipboard';
import { absoluteTime } from '@/lib/format-time';
import { NO_READING, readingOf } from '@/library/entity-reading';
import { USE_KINDS, usedByCount } from '@/routes/library/aliases/alias-dialogs';
import { Ent } from '@/routes/library/aliases/alias-text';
import { devicePath } from '@/routes/library/device/device-path';
import { EntityPreview } from '@/routes/library/entity/entity-dialog';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';

/**
 * The card the folds sit in.
 *
 * @param props - The folds.
 * @param props.children - The folds.
 * @returns The card.
 */
export function Side(props: { readonly children: ReactNode }) {
  return (
    <aside className="flex flex-col self-start rounded-panel border border-border bg-surface shadow-[0_24px_60px_-28px_rgba(0,0,0,0.8)]">
      {props.children}
    </aside>
  );
}

/** What a fold needs. */
type FoldProps = {
  readonly title: string;

  /** What it says while shut, on the right. */
  readonly meta?: ReactNode;

  /** Whether it starts open. */
  readonly isOpen?: boolean;

  readonly children: ReactNode;
};

/**
 * A fold: a row that opens and shuts what is under it.
 *
 * @param props - See {@link FoldProps}.
 * @returns The fold.
 */
export function Fold(props: FoldProps) {
  const [isOpen, setOpen] = useState(props.isOpen === true);

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        aria-expanded={isOpen}
        className="group flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-raised/40"
        onClick={() => {
          setOpen(!isOpen);
        }}
      >
        <AppIcon
          id="chevron-right"
          size={14}
          className={`shrink-0 transition-[transform,color] duration-200 ${
            isOpen
              ? 'rotate-90 text-foreground'
              : 'text-foreground-subtle group-hover:text-foreground-muted'
          }`}
        />
        <span className="text-ui-sm font-semibold text-foreground">{props.title}</span>
        <span className="grow" />
        {props.meta === undefined ? null : (
          <span className="min-w-0 truncate text-caption text-foreground-subtle">{props.meta}</span>
        )}
      </button>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
        inert={!isOpen}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-4 pb-4">{props.children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * The real entity card, smaller, with its controls off while the alias is edited.
 *
 * @param props - The alias's entity and whether it is edited.
 * @param props.entityId - The alias's entity.
 * @param props.isEdited - Whether there are unsaved changes.
 * @returns The preview.
 */
export function PreviewBody(props: { readonly entityId: string; readonly isEdited: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="w-full [zoom:0.72] overflow-hidden">
        <EntityPreview entityId={props.entityId} isDisabled={props.isEdited} />
      </div>
      {props.isEdited ? (
        <span className="text-caption text-foreground-subtle">
          {t('library.aliasPage.activeAfterSaving', 'Controls active after saving')}
        </span>
      ) : null}
    </div>
  );
}

/**
 * What the alias reads: each entity's name, id and value now.
 *
 * @param props - The inputs.
 * @param props.inputs - The inputs.
 * @returns The list.
 */
export function InputsBody(props: { readonly inputs: AliasDetail['inputs'] }) {
  const { t } = useTranslation();
  const { entities, readings } = useEntityDirectory(false);
  const byId = new Map(entities.map((entity) => [entity.entityId as string, entity]));

  if (props.inputs.length === 0) {
    return (
      <p className="text-caption text-foreground-subtle">
        {t('library.aliasPage.readsNothing', 'It reads no entity.')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {props.inputs.map((input) => {
        const entity = byId.get(input.entityId);
        const value =
          entity === undefined ? NO_READING : readingOf(entity, readings[input.entityId]).text;

        return (
          <div
            key={input.entityId}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-ui-sm">{input.name}</span>
              <span className="truncate font-mono text-mono-caption">
                <Ent id={input.entityId} isMissing={!input.isPresent} />
              </span>
            </span>
            <span className="text-ui-sm text-foreground-muted tabular">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * What the alias's actions act on: the entities they command, the scenes they apply, the
 * automations they start, each with the parts whose actions name it.
 *
 * @param props - The targets.
 * @param props.targets - The targets.
 * @returns The list.
 */
export function TargetsBody(props: { readonly targets: AliasDetail['targets'] }) {
  const { t } = useTranslation();
  const kinds = {
    entity: t('library.aliasPage.targetEntity', 'Entity'),
    scene: t('library.aliasPage.targetScene', 'Scene'),
    automation: t('library.aliasPage.targetAutomation', 'Automation'),
  };

  return (
    <div className="flex flex-col gap-2.5">
      {props.targets.map((target) => (
        <div
          key={`${target.kind}:${target.id}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3"
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ui-sm">{target.name}</span>
            <span className="truncate font-mono text-mono-caption">
              {target.kind === 'entity' ? (
                <Ent id={target.id} isMissing={!target.isPresent} />
              ) : (
                <span className={target.isPresent ? 'text-foreground-subtle' : 'text-danger'}>
                  {target.id}
                </span>
              )}
            </span>
          </span>
          <span className="text-caption text-foreground-subtle">{kinds[target.kind]}</span>
        </div>
      ))}
    </div>
  );
}

/** Where each kind of user lives. */
const USER_PATHS: Readonly<Record<keyof AliasDetail['usedBy'], string>> = {
  automations: '/automations',
  scenes: '/scenes',
  dashboards: '/dashboards',
  aliases: '/aliases',
};

/**
 * What uses the alias, by kind.
 *
 * @param props - The users.
 * @param props.usedBy - The users.
 * @returns The list.
 */
export function UsedByBody(props: { readonly usedBy: AliasDetail['usedBy'] }) {
  const { t } = useTranslation();

  if (usedByCount(props.usedBy) === 0) {
    return (
      <p className="text-caption text-foreground-subtle">
        {t('library.aliases.nothingUsesIt', 'Nothing uses it.')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {USE_KINDS.filter(({ kind }) => props.usedBy[kind].length > 0).map(
        ({ kind, icon, label }) => (
          <div key={kind} className="flex items-start gap-3 py-0.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-raised text-foreground-muted">
              <AppIcon id={icon} size={13} />
            </span>
            <span className="flex min-w-0 grow flex-col">
              <span className="text-ui-sm">
                {text(label)} · {props.usedBy[kind].length}
              </span>
              <span className="flex flex-wrap gap-x-1 text-caption text-foreground-subtle">
                {props.usedBy[kind].map((user, index) => (
                  <Link
                    key={user.id}
                    to={`${USER_PATHS[kind]}/${user.id}`}
                    className="hover:text-foreground"
                  >
                    {user.name}
                    {index < props.usedBy[kind].length - 1 ? ',' : ''}
                  </Link>
                ))}
              </span>
            </span>
          </div>
        ),
      )}
    </div>
  );
}

/** What a silent input does, in words. */
const POLICY_LABELS: Readonly<Record<AliasFallbackPolicy, Message>> = {
  unavailable: defineMessage('library.aliasPolicies.unavailable', 'Alias unavailable'),
  ignore_missing: defineMessage('library.aliasPolicies.ignoreMissing', 'Left out'),
  last_known: defineMessage('library.aliasPolicies.lastKnown', 'Last value kept'),
};

/**
 * One fact: its name and its value.
 *
 * @param props - The fact.
 * @param props.label - Its name.
 * @param props.children - Its value.
 * @returns The row.
 */
function Fact(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-ui-sm">
      <span className="shrink-0 text-foreground-subtle">{props.label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1 text-right">
        {props.children}
      </span>
    </div>
  );
}

/**
 * The alias's details.
 *
 * @param props - The alias, its silent-input policy as edited, and how to change it.
 * @param props.alias - The alias.
 * @param props.policy - What a silent input does, as edited.
 * @param props.onPolicy - Changes it.
 * @param props.canEdit - Whether it can be changed.
 * @returns The facts.
 */
export function DetailsBody(props: {
  readonly alias: AliasDetail['alias'];
  readonly policy: AliasFallbackPolicy;
  readonly onPolicy: (policy: AliasFallbackPolicy) => void;
  readonly canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { alias, policy, onPolicy, canEdit } = props;

  return (
    <div className="flex flex-col gap-3">
      <Fact label={t('library.aliasPage.entityId', 'Entity id')}>
        <span className="truncate font-mono text-caption">{alias.entityId}</span>
        <IconButton
          label={t('library.aliasPage.copy', 'Copy')}
          size="small"
          onClick={() => {
            void copyText(alias.entityId).then((isCopied) => {
              if (isCopied) {
                toast.success({ title: t('library.aliasPage.copied', 'Copied') });
              }
            });
          }}
        >
          <AppIcon id="copy" size={13} />
        </IconButton>
      </Fact>
      <Fact label={t('library.aliases.device', 'Device')}>
        {alias.device.isVirtual ? (
          <span className="flex items-center gap-1.5">
            <AppIcon id="layers" size={13} className="text-foreground-subtle" />
            {alias.device.isShared
              ? t('library.aliases.aliasesDevice', 'Aliases')
              : alias.device.name}
          </span>
        ) : (
          <Link
            to={devicePath(alias.device.id)}
            className="flex items-center gap-1.5 text-foreground hover:text-primary"
          >
            <AppIcon id="cpu" size={13} className="text-foreground-subtle" />
            {alias.device.name}
          </Link>
        )}
      </Fact>
      <Fact label={t('library.aliases.area', 'Area')}>
        {alias.area === null
          ? NO_READING
          : alias.device.isVirtual
            ? alias.area.name
            : t('library.aliasPage.fromDevice', '{{name}} · from the device', {
                name: alias.area.name,
              })}
      </Fact>
      <div className="flex items-center justify-between gap-3 text-ui-sm">
        <span className="shrink-0 text-foreground-subtle">
          {t('library.aliasPage.silentInput', 'Silent input')}
        </span>
        <span className="w-44">
          <SelectField
            label={t('library.aliasPage.silentInput', 'Silent input')}
            isLabelHidden
            size="compact"
            disabled={!canEdit}
            options={ALIAS_FALLBACK_POLICIES.map((each) => ({
              value: each,
              label: text(POLICY_LABELS[each]),
            }))}
            value={policy}
            onChange={(value) => {
              onPolicy(ALIAS_FALLBACK_POLICIES.find((each) => each === value) ?? 'unavailable');
            }}
          />
        </span>
      </div>
      <Fact label={t('library.aliasPage.created', 'Created')}>{absoluteTime(alias.createdAt)}</Fact>
    </div>
  );
}

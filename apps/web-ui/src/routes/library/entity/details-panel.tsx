/**
 * The facts about an entity: what it is called by automations, where it is, what it belongs to,
 * what it can do and when it last spoke.
 *
 * The address is here, in the mono face with a button to copy it, because this is the page
 * someone opens when an automation or the API needs it; everywhere else it is a tooltip. What it
 * can do is written in words with the device's own limits - "Colour temperature, 2000-9000 K" -
 * since those limits are what decide whether an automation's command will be accepted.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { getSensorClass, type CapabilityName, type EntityView } from '@nebulahome/contracts';
import { AppIcon, IconButton, Panel, TagChip } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { copyText } from '@/lib/clipboard';
import { absoluteTime, relativeTime } from '@/lib/format-time';
import { miredsToKelvin, paramsOf } from '@/library/entity-control';
import { capabilityLabel, entityKindOf } from '@/library/entity-kind';
import { devicePath } from '@/routes/library/device/device-path';
import type { EntityWays } from '@/routes/library/entity/transport-panel';
import type { EntityPageView } from '@/routes/library/entity/use-entity-page';

/**
 * A capability's limits, in words.
 *
 * @param entity - The entity, with its params.
 * @param capability - Which capability.
 * @returns "2000-9000 K", "7-30 °C", or null when there is nothing to say.
 */
function limitsOf(entity: EntityView, capability: CapabilityName): string | null {
  switch (capability) {
    case 'color_temp': {
      const params = paramsOf(entity, 'color_temp');

      return params === null
        ? translate('entity.detailsPanel.rangeNotDeclared', 'range not declared')
        : `${String(miredsToKelvin(params.maxMireds))}–${String(miredsToKelvin(params.minMireds))} K`;
    }

    case 'thermostat': {
      const params = paramsOf(entity, 'thermostat');

      return params === null
        ? null
        : `${String(params.minTemperature)}–${String(params.maxTemperature)} °C`;
    }

    case 'cover': {
      const params = paramsOf(entity, 'cover');

      return params?.hasTilt === true
        ? translate('entity.detailsPanel.positionAndTilt', 'position and tilt')
        : null;
    }

    case 'level':
      return paramsOf(entity, 'level')?.hasTransition === true ? 'fades' : null;

    default:
      return null;
  }
}

/** What one fact needs. */
export type FactProps = {
  readonly term: string;
  readonly children: ReactNode;
};

/**
 * One line of the list: what it is, and its value.
 *
 * @param props - See {@link FactProps}.
 * @returns The line.
 */
export function Fact(props: FactProps) {
  const { term, children } = props;

  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
      <dt className="text-caption text-foreground-subtle">{term}</dt>
      <dd className="min-w-0 text-ui break-words text-foreground">{children}</dd>
    </div>
  );
}

/**
 * A moment, relative with the exact time on hover.
 *
 * @param props - The moment.
 * @param props.when - When, or null for never.
 * @returns The phrase.
 */
export function When(props: { readonly when: Date | null }) {
  const { t } = useTranslation();

  const { when } = props;

  return when === null ? (
    <span className="text-foreground-subtle">{t('entity.detailsPanel.never', 'Never')}</span>
  ) : (
    <time dateTime={when.toISOString()} title={absoluteTime(when)}>
      {relativeTime(when)}
    </time>
  );
}

/** What the panel needs. */
export type DetailsPanelProps = {
  readonly view: EntityPageView;

  /** How it is read, for one read two ways. */
  readonly ways?: EntityWays | null;
};

/**
 * Renders the details.
 *
 * @param props - See {@link DetailsPanelProps}.
 * @returns The panel.
 */
export function DetailsPanel(props: DetailsPanelProps) {
  const { t } = useTranslation();

  const { view, ways = null } = props;
  const { entity, device, vendorName, room, floor, tags, icons } = view;
  const [isCopied, setCopied] = useState(false);
  const sensorClass = getSensorClass(entity.deviceClass);
  const place = [floor?.name, room?.name ?? entity.areaName].filter(Boolean).join(' › ');

  return (
    <Panel title={t('entity.detailsPanel.details', 'Details')}>
      <dl>
        <Fact term={t('entity.detailsPanel.address', 'Address')}>
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 font-mono text-caption break-all">{entity.entityId}</span>
            <IconButton
              size="small"
              label={
                isCopied
                  ? t('common.copied', 'Copied')
                  : t('entity.detailsPanel.copyTheAddress', 'Copy the address')
              }
              onClick={() => {
                void copyText(entity.entityId).then(setCopied);
              }}
            >
              <AppIcon id={isCopied ? 'check' : 'copy'} size={13} />
            </IconButton>
          </span>
        </Fact>
        <Fact term={t('entity.detailsPanel.kind', 'Kind')}>{entityKindOf(entity).label}</Fact>
        <Fact term={t('entity.detailsPanel.device', 'Device')}>
          {device === undefined ? (
            <span className="text-foreground-subtle">
              {entity.source === 'derived'
                ? t('entity.detailsPanel.calculated', 'Calculated')
                : entity.source}
            </span>
          ) : (
            <Link
              to={devicePath(device.id)}
              className="text-primary underline-offset-2 hover:underline"
            >
              {device.name}
            </Link>
          )}
          {vendorName === null || ways !== null ? null : (
            <span className="text-foreground-subtle"> · {vendorName}</span>
          )}
        </Fact>
        {ways === null ? null : (
          <Fact term={t('entity.detailsPanel.transport', 'Transport')}>
            {t('entity.detailsPanel.firstThenFallback', '{{first}} first, {{second}} as fallback', {
              first: ways.first.name,
              second: ways.second.name,
            })}
          </Fact>
        )}
        <Fact term={t('entity.detailsPanel.room', 'Room')}>
          {place === '' ? (
            <span className="text-foreground-subtle">
              {t('entity.detailsPanel.notInARoom', 'Not in a room')}
            </span>
          ) : (
            place
          )}
        </Fact>
        {sensorClass === undefined && entity.unitOfMeasurement === null ? null : (
          <Fact term={t('entity.detailsPanel.measures', 'Measures')}>
            {[sensorClass?.label, entity.unitOfMeasurement].filter(Boolean).join(', ')}
          </Fact>
        )}
        <Fact term={t('entity.detailsPanel.can', 'Can')}>
          <ul className="flex flex-col gap-0.5">
            {entity.capabilities.map((entry) => {
              const limits = limitsOf(entity, entry.capability);

              return (
                <li key={entry.capability}>
                  {capabilityLabel(entry.capability, entity.domain)}
                  {limits === null ? null : (
                    <span className="text-foreground-subtle">, {limits}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Fact>
        <Fact term={t('entity.detailsPanel.tags', 'Tags')}>
          {tags.length === 0 ? (
            <span className="text-foreground-subtle">{t('entity.detailsPanel.none', 'None')}</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <TagChip
                  key={tag.id}
                  color={tag.color}
                  icon={tag.icon === null ? undefined : icons.get(tag.icon)}
                >
                  {tag.name}
                </TagChip>
              ))}
            </span>
          )}
        </Fact>
        <Fact term={t('entity.detailsPanel.changed', 'Changed')}>
          <When when={entity.lastChanged} />
        </Fact>
        <Fact term={t('entity.detailsPanel.reported', 'Reported')}>
          <When
            when={view.live === undefined ? entity.lastUpdated : new Date(view.live.receivedAt)}
          />
        </Fact>
        {entity.isHidden ? (
          <Fact term={t('entity.detailsPanel.lists', 'Lists')}>
            {t('entity.detailsPanel.hiddenByDefault', 'Hidden by default')}
          </Fact>
        ) : null}
      </dl>
    </Panel>
  );
}

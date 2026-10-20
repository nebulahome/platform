/**
 * Linking or unlinking, asked first: what it joins or splits, and what follows from it.
 *
 * The server says what the change would do - which entity leads and keeps its address and
 * history, what uses each address, which way is read first, since when they were linked - and
 * the dialog words it. Linking two readings: the two cards, an arrow, the one entity they become
 * with its linked tag, then one entity from now on and through which way first, which address
 * stays and what follows it, that both histories are kept, and that it can be undone. Unlinking:
 * the other way round, and that there is no fallback any more. A whole device the same, its
 * readings counted.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { LinkPreview, LinkSide, LinkUse } from '@nebulahome/contracts';
import { AppIcon, Button, cn, Modal, Note, type UiIconId } from '@nebulahome/ui';

import { dateTimeFormat, listFormat } from '@/i18n/formatters';
import { toMessage } from '@/lib/error-message';
import { entityKindOf } from '@/library/entity-kind';
import { link, LINK_QUERY_KEYS, unlink, type LinkTarget } from '@/library/links-api';
import type { EntityLine } from '@/routes/library/entity-row';
import { EntityTile } from '@/routes/library/entity-tile';
import {
  TransportMark,
  useVendorsById,
  wayName,
  WaysTag,
  type TransportWay,
} from '@/routes/library/transport-marks';

/** A link or an unlink to ask about. */
export type LinkRequest = {
  readonly action: 'link' | 'unlink';
  readonly target: LinkTarget;

  /** The other one, for a link. */
  readonly withId?: string;
};

/** What the dialog needs. */
export type LinkDialogProps = {
  readonly request: LinkRequest | null;

  /** The page's readings, for their glyphs. */
  readonly lines: readonly EntityLine[];

  /** The device's glyph, for a device's link. */
  readonly deviceMark?: ReactNode;
  readonly onClose: () => void;

  /** Called once it is done. */
  readonly onDone: () => void;
};

/**
 * A list of parts, joined as the language joins them: "A, B and C".
 *
 * @param parts - The parts.
 * @returns The list.
 */
function joined(parts: readonly ReactNode[]): ReactNode {
  return listFormat({ style: 'long', type: 'conjunction' })
    .formatToParts(Array.from(parts.keys(), String))
    .map((part, index) =>
      part.type === 'element' ? (
        <span key={`part-${String(index)}`}>{parts[Number(part.value)]}</span>
      ) : (
        part.value
      ),
    );
}

/**
 * What uses an address, in words: "the automation **Dryer finished** and one card on **Utility**".
 *
 * @param use - What uses it.
 * @param t - The translator.
 * @returns The words, or null when nothing uses it.
 */
function usesOf(use: LinkUse, t: ReturnType<typeof useTranslation>['t']): ReactNode {
  /**
   * A name, as the sentence stresses it.
   *
   * @param name - The name.
   * @returns It, bold.
   */
  const bold = (name: string): ReactNode => <b className="font-medium text-foreground">{name}</b>;

  /**
   * One kind of user: the one named, or how many.
   *
   * @param names - Those of that kind.
   * @param one - The words for one, around its name.
   * @param many - The words for several.
   * @returns The part, or none.
   */
  const named = (
    names: readonly string[],
    one: (name: ReactNode) => ReactNode,
    many: string,
  ): ReactNode[] =>
    names.length === 0 ? [] : names.length === 1 ? [one(bold(names[0] ?? ''))] : [many];
  const parts: ReactNode[] = [
    ...named(
      use.automations,
      (name) => (
        <>
          {t('device.link.theAutomation', 'the automation')} {name}
        </>
      ),
      t('device.link.automations', '{{count}} automations', { count: use.automations.length }),
    ),
    ...named(
      use.scenes,
      (name) => (
        <>
          {t('device.link.theScene', 'the scene')} {name}
        </>
      ),
      t('device.link.scenes', '{{count}} scenes', { count: use.scenes.length }),
    ),
    ...named(
      use.aliases,
      (name) => (
        <>
          {t('device.link.theAlias', 'the alias')} {name}
        </>
      ),
      t('device.link.aliases', '{{count}} aliases', { count: use.aliases.length }),
    ),
    ...use.cards.map((card) => (
      <>
        {card.count === 1
          ? t('device.link.oneCardOn', 'one card on')
          : t('device.link.cardsOn', '{{count}} cards on', { count: card.count })}{' '}
        {bold(card.dashboard)}
      </>
    )),
  ];

  return parts.length === 0 ? null : joined(parts);
}

/**
 * One way of a side, as a mark and a name draw it.
 *
 * @param side - The side.
 * @returns Its way.
 */
function wayOf(side: Pick<LinkSide, 'vendorId' | 'transport'>): TransportWay {
  return { vendorId: side.vendorId, transport: side.transport };
}

/**
 * One of the things joined or split.
 *
 * @param props - What it shows.
 * @param props.mark - Its glyph.
 * @param props.name - What it is called.
 * @param props.address - Its address, or what it is.
 * @param props.way - The way it is read through.
 * @returns The card.
 */
function SideCard(props: {
  readonly mark: ReactNode;
  readonly name: string;
  readonly address: string;
  readonly way: TransportWay;
}) {
  const { mark, name, address, way } = props;
  const vendors = useVendorsById();

  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-tile border border-border bg-rail px-3 py-2.5">
      {mark}
      <span className="flex min-w-0 flex-col gap-0.75">
        <span className="truncate text-ui-sm font-medium whitespace-nowrap text-foreground">
          {name}
        </span>
        <span className="truncate font-mono text-label tracking-normal text-foreground-subtle">
          {address}
        </span>
      </span>
      <span className="grow" />
      <TransportMark way={way} vendors={vendors} size={20} />
    </div>
  );
}

/**
 * What they are, or were, together.
 *
 * @param props - What it shows.
 * @param props.mark - Its glyph.
 * @param props.name - What it is called.
 * @param props.address - Its address, or what it is.
 * @param props.ways - The ways it is read through.
 * @returns The card.
 */
function JoinedCard(props: {
  readonly mark: ReactNode;
  readonly name: string;
  readonly address: string;
  readonly ways: readonly TransportWay[];
}) {
  const { mark, name, address, ways } = props;

  return (
    <div className="link-halo flex min-w-0 items-center gap-2.5 rounded-inner border border-primary/50 bg-linear-to-r from-tag-blue/10 to-violet/10 px-3.5 py-4">
      {mark}
      <span className="flex min-w-0 flex-col gap-1">
        <span className="inline-flex min-w-0 items-center gap-2 text-ui font-medium text-foreground">
          <span className="truncate">{name}</span>
          <WaysTag ways={ways} />
        </span>
        <span className="truncate font-mono text-label tracking-normal text-foreground-subtle">
          {address}
        </span>
      </span>
    </div>
  );
}

/**
 * One thing that follows from it.
 *
 * @param props - What it says.
 * @param props.icon - Its glyph.
 * @param props.tone - The glyph's colour.
 * @param props.title - What follows, in a line.
 * @param props.children - Why, or what exactly.
 * @returns The item.
 */
function Consequence(props: {
  readonly icon: UiIconId;
  readonly tone: string;
  readonly title: ReactNode;
  readonly children: ReactNode;
}) {
  const { icon, tone, title, children } = props;

  return (
    <li className="flex items-start gap-3">
      <span className="flex size-7.5 shrink-0 items-center justify-center rounded-field bg-surface-raised">
        <AppIcon id={icon} size={15} className={tone} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.75">
        <span className="text-ui font-medium text-foreground">{title}</span>
        <span className="text-ui-sm leading-normal text-foreground-muted">{children}</span>
      </span>
    </li>
  );
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link LinkDialogProps}.
 * @returns The dialog, or nothing when nothing is asked.
 */
export function LinkDialog(props: LinkDialogProps) {
  const { t } = useTranslation();
  const { request, lines, deviceMark, onClose, onDone } = props;
  const vendors = useVendorsById();
  const matter = t('library.matterTag', 'Matter');

  const preview = useQuery({
    queryKey: [
      ...LINK_QUERY_KEYS.preview,
      request?.action ?? '',
      request?.target.scope ?? '',
      request?.target.id ?? '',
      request?.withId ?? '',
    ],
    enabled: request !== null,

    /**
     * Asks the server what it would do.
     *
     * @returns What it would do.
     */
    queryFn: async () =>
      request === null
        ? Promise.reject(new Error('Nothing asked'))
        : request.action === 'link'
          ? link(request.target, request.withId ?? '', true)
          : unlink(request.target, true),
  });

  const apply = useMutation({
    /**
     * Does it.
     *
     * @returns What it did.
     */
    mutationFn: async () =>
      request === null
        ? Promise.reject(new Error('Nothing asked'))
        : request.action === 'link'
          ? link(request.target, request.withId ?? '', false)
          : unlink(request.target, false),

    /** Tells the page. */
    onSuccess: onDone,
  });

  if (request === null) {
    return null;
  }

  const isLink = request.action === 'link';
  const isDevice = request.target.scope === 'device';
  const found: LinkPreview | undefined = preview.data;
  const [pair] = found?.pairs ?? [];
  const holder = pair?.holder;
  const [other] = pair?.others ?? [];
  const preferred = found?.preferred;

  /**
   * A reading's glyph, from the page's rows.
   *
   * @param entityId - The reading.
   * @returns Its glyph.
   */
  const markOf = (entityId: string): ReactNode => {
    const line = lines.find((each) => each.entity.entityId === entityId);

    return line === undefined ? (
      <span className="flex size-7.5 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-muted">
        <AppIcon id="activity" size={15} />
      </span>
    ) : (
      <EntityTile
        icon={line.icon}
        kind={entityKindOf(line.entity)}
        isActive={null}
        size="small"
        isPlain
        className="size-7.5 rounded-field"
      />
    );
  };
  /**
   * A reading's kind glyph, from the page's rows.
   *
   * @param entityId - The reading.
   * @returns Its glyph's id.
   */
  const kindIconOf = (entityId: string): UiIconId => {
    const line = lines.find((each) => each.entity.entityId === entityId);

    return line === undefined ? 'activity' : entityKindOf(line.entity).icon;
  };
  const deviceGlyph = deviceMark ?? (
    <span className="flex size-7.5 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-muted">
      <AppIcon id="plug" size={15} />
    </span>
  );

  // Which way is read first, then the other; for a device, its own and the other's.
  const sides: readonly Pick<LinkSide, 'deviceId' | 'vendorId' | 'transport'>[] = isDevice
    ? [found?.device, found?.other].flatMap((each) =>
        each == null
          ? []
          : [{ deviceId: each.id, vendorId: each.vendorId, transport: each.transport }],
      )
    : [holder, other].flatMap((each) => (each === undefined ? [] : [each]));
  const first = sides.find((side) => side.deviceId === preferred?.deviceId) ?? sides[0];
  const second = sides.find((side) => side !== first);
  const firstName = first === undefined ? '' : wayName(wayOf(first), vendors, matter);
  const secondName = second === undefined ? '' : wayName(wayOf(second), vendors, matter);
  const ways = sides.map(wayOf);
  const since =
    found?.linkedSince == null
      ? ''
      : dateTimeFormat({ day: 'numeric', month: 'long', year: 'numeric' }).format(
          found.linkedSince,
        );

  const title = isDevice
    ? isLink
      ? t('device.link.linkDevices', 'Link {{device}} and {{other}}?', {
          device: found?.device?.name ?? '…',
          other: found?.other?.name ?? '…',
        })
      : t('device.link.unlinkDevice', 'Unlink {{device}}?', { device: found?.device?.name ?? '…' })
    : isLink
      ? t('device.link.linkEntities', 'Link {{entity}} and {{other}}?', {
          entity: holder?.name ?? '…',
          other: other?.name ?? '…',
        })
      : t('device.link.unlinkEntity', 'Unlink {{entity}}?', { entity: holder?.name ?? '…' });
  const description = isDevice
    ? isLink
      ? t('device.link.oneDeviceTwoWays', 'One device, reached two ways')
      : t('device.link.splitDevice', 'Split it back into one device per transport')
    : isLink
      ? t('device.link.readTheSame', 'They read the same thing, one through each transport')
      : t('device.link.splitEntity', 'Split it back into one entity per transport');

  const cards =
    found === undefined || first === undefined
      ? null
      : isDevice
        ? (() => {
            const device = found.device;
            const another = found.other;

            if (device === null || another === null) {
              return null;
            }

            const separate = (
              <div className="flex min-w-0 flex-col gap-2">
                {[device, another].map((each) => (
                  <SideCard
                    key={each.id}
                    mark={deviceGlyph}
                    name={each.name}
                    address={[each.model, each.areaName].filter(Boolean).join(' · ') || each.id}
                    way={wayOf(each)}
                  />
                ))}
              </div>
            );
            const together = (
              <JoinedCard
                mark={deviceGlyph}
                name={device.name}
                address={[device.model, device.areaName].filter(Boolean).join(' · ') || device.id}
                ways={ways}
              />
            );

            return isLink ? [separate, together] : [together, separate];
          })()
        : holder === undefined || other === undefined
          ? null
          : (() => {
              const separate = (
                <div className="flex min-w-0 flex-col gap-2">
                  {[holder, ...(pair?.others ?? [])].map((each) => (
                    <SideCard
                      key={each.entityId}
                      mark={markOf(each.entityId)}
                      name={each.name}
                      address={each.entityId}
                      way={wayOf(each)}
                    />
                  ))}
                </div>
              );
              const together = (
                <JoinedCard
                  mark={markOf(holder.entityId)}
                  name={holder.name}
                  address={holder.entityId}
                  ways={ways}
                />
              );

              return isLink ? [separate, together] : [together, separate];
            })();

  const holderUses = holder === undefined ? null : usesOf(holder.usedBy, t);
  const otherUses = other === undefined ? null : usesOf(other.usedBy, t);

  const consequences =
    found === undefined ? null : isDevice ? (
      isLink ? (
        <>
          <Consequence
            icon="link-2"
            tone="text-primary"
            title={t('device.link.oneDevice', 'One device from now on')}
          >
            {t(
              'device.link.oneDeviceLine',
              '{{device}}, reached through {{first}} and {{second}}. Its name, room and tags stay, and what used either device keeps working.',
              { device: found.device?.name ?? '', first: firstName, second: secondName },
            )}
          </Consequence>
          {found.pairs.length === 0 ? null : (
            <Consequence
              icon="layers"
              tone="text-cyan"
              title={t('device.link.linkedAtOnce', {
                count: found.pairs.length,
                defaultValue_one: '{{count}} reading linked at once',
                defaultValue_other: '{{count}} readings linked at once',
              })}
            >
              {joined(found.pairs.map((each) => each.holder.name))}.
              {found.single.length === 0 ? null : (
                <>
                  {' '}
                  {t('device.link.restOneWay', 'The rest are read one way:')}{' '}
                  {joined(
                    found.single.map(
                      (each) => `${each.name} · ${wayName(wayOf(each), vendors, matter)}`,
                    ),
                  )}
                  .
                </>
              )}
            </Consequence>
          )}
          <Consequence
            icon="arrow-right-left"
            tone="text-warning"
            title={t('device.link.isPreferred', '{{first}} is preferred', { first: firstName })}
          >
            {t(
              'device.link.takesOver',
              '{{second}} takes over when {{first}} is silent. You can change it in the settings.',
              { first: firstName, second: secondName },
            )}
          </Consequence>
          <Consequence
            icon="rotate-ccw-clock"
            tone="text-cyan"
            title={t('device.link.historiesCarryOn', 'Histories carry on')}
          >
            {t(
              'device.link.historiesCarryOnLine',
              'Each linked reading keeps the longer of its two histories, each reading marked with the way it came in; the other one stays stored as it is.',
            )}
          </Consequence>
          <Consequence
            icon="unlink-2"
            tone="text-foreground-subtle"
            title={t('device.link.unlinkLater', 'You can unlink later')}
          >
            {t(
              'device.link.unlinkDeviceLater',
              'From the ⋮ menu: each way is its own device again, with its readings.',
            )}
          </Consequence>
        </>
      ) : (
        <>
          <Consequence
            icon="plug"
            tone="text-cyan"
            title={t('device.link.deviceStays', '{{device}} stays with {{first}}', {
              device: found.device?.name ?? '',
              first: firstName,
            })}
          >
            {t(
              'device.link.deviceStaysLine',
              'It keeps its name, room, tags and the history of every reading it leads.',
            )}
          </Consequence>
          <Consequence
            icon="plus"
            tone="text-violet"
            title={t('device.link.ownDeviceAgain', '{{second}} is its own device again', {
              second: secondName,
            })}
          >
            {since === ''
              ? t(
                  'device.link.comesBack',
                  '{{other}} comes back, with its readings and their history.',
                  {
                    other: found.other?.name ?? '',
                  },
                )
              : t(
                  'device.link.comesBackSince',
                  '{{other}} comes back, with its readings and their history up to {{since}}.',
                  { other: found.other?.name ?? '', since },
                )}
          </Consequence>
          <Consequence
            icon="triangle-alert"
            tone="text-warning"
            title={t('device.link.noFallback', 'No more fallback')}
          >
            {t(
              'device.link.noFallbackDevice',
              'If {{first}} goes silent, its readings are unavailable until it is back.',
              { first: firstName },
            )}
          </Consequence>
        </>
      )
    ) : holder === undefined || other === undefined ? null : isLink ? (
      <>
        <Consequence
          icon="link-2"
          tone="text-primary"
          title={t('device.link.oneEntity', 'One entity from now on')}
        >
          {t(
            'device.link.oneEntityLine',
            '{{entity}}, read through {{first}} first and through {{second}} when {{first}} is silent.',
            { entity: holder.name, first: firstName, second: secondName },
          )}
        </Consequence>
        <Consequence
          icon="arrow-right-left"
          tone="text-warning"
          title={t('device.link.stays', '{{address}} stays', { address: holder.entityId })}
        >
          {t('device.link.longerHistory', 'It has the longer history.')}{' '}
          {otherUses === null ? (
            t('device.link.nothingUsed', 'Nothing used {{other}}.', { other: other.name })
          ) : (
            <>
              {t('device.link.followsIt', 'What used {{other}} follows it:', {
                other: other.name,
              })}{' '}
              {otherUses}.
            </>
          )}
        </Consequence>
        <Consequence
          icon="rotate-ccw-clock"
          tone="text-cyan"
          title={t('device.link.bothKept', 'Both histories are kept')}
        >
          {t(
            'device.link.bothKeptLine',
            "{{entity}}'s carries on, each reading marked with the way it came in. {{other}}'s stays stored as it is.",
            { entity: holder.name, other: other.name },
          )}
        </Consequence>
        <Consequence
          icon="unlink-2"
          tone="text-foreground-subtle"
          title={t('device.link.unlinkLater', 'You can unlink later')}
        >
          {t(
            'device.link.unlinkEntityLater',
            '{{other}} is then its own entity again, with its history up to the link.',
            { other: other.name },
          )}
        </Consequence>
      </>
    ) : (
      <>
        <Consequence
          icon={kindIconOf(holder.entityId)}
          tone="text-cyan"
          title={t('device.link.staysWith', '{{address}} stays with {{first}}', {
            address: holder.entityId,
            first: firstName,
          })}
        >
          {holderUses === null ? (
            t('device.link.keepsIdHistory', 'It keeps its id and its history.')
          ) : (
            <>
              {t(
                'device.link.keepsIdHistoryUses',
                'It keeps its id, its history and what uses it:',
              )}{' '}
              {holderUses}.
            </>
          )}
        </Consequence>
        <Consequence
          icon="plus"
          tone="text-violet"
          title={t('device.link.ownEntityAgain', "{{second}}'s reading is its own entity again", {
            second: secondName,
          })}
        >
          {since === ''
            ? t('device.link.backWithHistory', '{{address}}, with its history.', {
                address: other.entityId,
              })
            : t(
                'device.link.backWithHistorySince',
                '{{address}}, with its history up to {{since}}.',
                {
                  address: other.entityId,
                  since,
                },
              )}
          {otherUses === null ? null : (
            <>
              {' '}
              {t('device.link.followsAgain', 'What used it before follows it again:')} {otherUses}.
            </>
          )}
        </Consequence>
        <Consequence
          icon="triangle-alert"
          tone="text-warning"
          title={t('device.link.noFallbackFor', 'No more fallback for {{entity}}', {
            entity: holder.name,
          })}
        >
          {t(
            'device.link.noFallbackLine',
            'If {{first}} goes silent, {{entity}} is unavailable until it is back.',
            { first: firstName, entity: holder.name },
          )}
        </Consequence>
      </>
    );

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="large"
      layout="card"
      lead={
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-tile',
            isLink ? 'bg-primary/14 text-primary' : 'bg-danger/12 text-danger',
          )}
        >
          <AppIcon id={isLink ? 'link-2' : 'unlink-2'} size={20} />
        </span>
      }
      title={title}
      description={description}
      footer={
        <>
          <span className="text-caption text-foreground-subtle">
            {isLink && !isDevice
              ? t('device.link.sameKind', 'Only entities of the same kind can be linked.')
              : null}
          </span>
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant={isLink ? 'primary' : 'danger'}
              disabled={found === undefined}
              isBusy={apply.isPending}
              onClick={() => {
                apply.mutate();
              }}
            >
              <AppIcon id={isLink ? 'link-2' : 'unlink-2'} size={15} />
              {isLink ? t('device.link.linkThem', 'Link them') : t('device.link.unlink', 'Unlink')}
            </Button>
          </span>
        </>
      }
    >
      {preview.error === null || found !== undefined ? null : (
        <Note tone="danger">{toMessage(preview.error)}</Note>
      )}
      {found === undefined && preview.error === null ? (
        <p className="text-ui text-foreground-subtle">
          {t('device.link.reading', 'Reading what it does…')}
        </p>
      ) : null}
      {cards === null ? null : (
        <div className="flex items-center">
          <div className={cn('min-w-0', isLink ? 'grow-5 basis-0' : 'grow-4 basis-0')}>
            {cards[0]}
          </div>
          <span className="flex w-10 shrink-0 justify-center text-foreground-subtle">
            <AppIcon id="arrow-right" size={16} />
          </span>
          <div className={cn('min-w-0', isLink ? 'grow-4 basis-0' : 'grow-5 basis-0')}>
            {cards[1]}
          </div>
        </div>
      )}
      {consequences === null ? null : <ul className="flex flex-col gap-3.5">{consequences}</ul>}
      {apply.error === null ? null : <Note tone="danger">{toMessage(apply.error)}</Note>}
    </Modal>
  );
}

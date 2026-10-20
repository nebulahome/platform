/**
 * The brokers: what the platform runs for whole protocols, each with a page of its own.
 *
 * The house's Matter fabric today: the controller every Matter device is reached through, whoever
 * makes it. A card per broker, as the integrations page draws a vendor's - how it stands, and how
 * many of its devices answer - and the card is the way to its page.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { BrokerSummary, MatterControllerState } from '@nebulahome/contracts';
import { AppIcon, cn, Pill, Tile, TILE_FRAME, TILE_GRID, type PillTone } from '@nebulahome/ui';

import { MatterIcon } from '@/components/icons';
import { translate } from '@/i18n/messages';
import { BROKER_QUERY_KEYS, fetchBrokers } from '@/library/brokers-api';
import { LibraryPage } from '@/routes/library/library-page';

/** How often the cards are read again: a broker coming up is worth seeing without a reload. */
const REFRESH_MS = 10_000;

/**
 * How a broker stands, as a Pill says it.
 *
 * @param state - Its state.
 * @returns The tone and the word.
 */
export function brokerStateOf(state: MatterControllerState): {
  readonly tone: PillTone;
  readonly label: string;
} {
  switch (state) {
    case 'running':
      return { tone: 'success', label: translate('brokers.state.running', 'Running') };
    case 'starting':
      return { tone: 'neutral', label: translate('brokers.state.starting', 'Starting') };
    case 'failed':
      return { tone: 'danger', label: translate('brokers.state.failed', 'Failed') };
    case 'disabled':
      return { tone: 'neutral', label: translate('brokers.state.disabled', 'Off') };
  }
}

/**
 * The square a broker is known by.
 *
 * @param props - Its size, and whether it is lit.
 * @param props.size - The side of the square, in pixels.
 * @param props.isLit - Lit violet from its corner, the mark drawn plain: the broker's page and
 *   its dialogs. Otherwise the mark is violet on a plain square: the card.
 * @returns The square.
 */
export function MatterMark(props: { readonly size: number; readonly isLit?: boolean }) {
  const { size, isLit = false } = props;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center border border-border-strong bg-surface-raised',
        isLit ? 'rounded-inner matter-glow text-foreground' : 'rounded-tile text-violet',
      )}
      /* eslint-disable-next-line react/forbid-dom-props -- the side is a value, per place. */
      style={{ width: size, height: size }}
    >
      <MatterIcon width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} />
    </span>
  );
}

/**
 * One broker's card.
 *
 * @param props - The broker.
 * @param props.broker - It.
 * @returns The card, the way to its page.
 */
function BrokerCard(props: { readonly broker: BrokerSummary }) {
  const { t } = useTranslation();
  const { broker } = props;
  const status = brokerStateOf(broker.state);

  return (
    <li className="list-none">
      <Link
        to={`/brokers/${broker.id}`}
        aria-label={t('library.matterTag', 'Matter')}
        className={TILE_FRAME}
      >
        <Tile
          logo={<MatterMark size={44} />}
          marks={
            <span
              title={t('brokers.card.platform', 'Comes with the platform')}
              aria-label={t('brokers.card.platform', 'Comes with the platform')}
              role="img"
              className="inline-flex size-6.5 items-center justify-center rounded-chip bg-surface-raised text-foreground-subtle"
            >
              <AppIcon id="lock" size={14} />
            </span>
          }
          name={t('library.matterTag', 'Matter')}
          footer={
            <>
              <Pill tone={status.tone}>{status.label}</Pill>
              <span className="text-foreground-muted">
                {t('brokers.card.devices', {
                  count: broker.devices.total,
                  defaultValue_one: '{{count}} device',
                  defaultValue_other: '{{count}} devices',
                })}
                {' · '}
                {t('brokers.card.linked', '{{linked}} linked', { linked: broker.devices.linked })}
              </span>
            </>
          }
        />
      </Link>
    </li>
  );
}

/**
 * Renders the brokers page.
 *
 * @returns The page.
 */
export function BrokersPage() {
  const { t } = useTranslation();
  const brokers = useQuery({
    queryKey: BROKER_QUERY_KEYS.brokers,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the brokers.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The brokers.
     */
    queryFn: async ({ signal }) => fetchBrokers(signal),
  });
  const all = brokers.data ?? [];

  return (
    <LibraryPage
      title={t('brokers.title', 'Brokers')}
      counted={(count) =>
        t('brokers.count', {
          count,
          defaultValue_one: '{{count}} broker',
          defaultValue_other: '{{count}} brokers',
        })
      }
      count={brokers.isPending ? undefined : all.length}
      isPending={brokers.isPending}
      error={brokers.error}
      isEmpty={all.length === 0}
      emptyMessage={t('brokers.empty', 'This installation runs no broker.')}
    >
      <ul className={TILE_GRID}>
        {all.map((broker) => (
          <BrokerCard key={broker.id} broker={broker} />
        ))}
      </ul>
    </LibraryPage>
  );
}

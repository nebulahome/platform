/**
 * An automation (`K-New`, Automation): on or off, Run now, when it last ran and when it next will.
 *
 * The tile says the last run in a line - "Ran yesterday 22:31", "Paused since 2 Nov" - and a run
 * that failed stays red, with its chip, until the next good one. The strip lays the last run and
 * the next side by side, with Run now and the switch at the right. Switching and running need
 * their permissions; without them the card only reads.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { AutomationView, DashboardAutomationCard } from '@nebulahome/contracts';
import { AppIcon, cn, Switch, toast } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { kindName } from '@/dashboard/card-options';
import { NO_AUTOMATION } from '@/dashboard/new-cards';
import { text, translate } from '@/i18n/messages';
import { SUN_EVENTS } from '@/lib/block-summary';
import { toMessage } from '@/lib/error-message';
import { runMoment } from '@/lib/format-time';
import { clockText, startOfDay } from '@/lib/format-time';
import { LIBRARY_QUERY_KEYS, triggerAutomation, updateAutomation } from '@/library/api';
import { Caption } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { useCardSample } from '@/routes/dashboard/cards/card-sample';
import {
  nextRunOf,
  useAutomationList,
  useHouseClock,
} from '@/routes/dashboard/cards/timeline-data';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What the card needs. */
export type AutomationCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardAutomationCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * When a run was or will be, as the card writes it: the day in a word and the time.
 *
 * @param when - The moment.
 * @param now - What today is measured against.
 * @returns "Today 06:30", "yesterday 22:31", "Monday 07:00", "3 Nov".
 */
function momentWords(when: Date, now: Date = new Date()): string {
  const days = Math.round((startOfDay(when) - startOfDay(now)) / 86_400_000);
  const time = clockText(when);

  if (days === 0) {
    return translate('dashboard.cards.automationCard.todayAt', 'Today {{time}}', { time });
  }

  if (days === 1) {
    return translate('dashboard.cards.automationCard.tomorrowAt', 'Tomorrow {{time}}', { time });
  }

  return Math.abs(days) <= 6 ? `${runMoment(when, now)} ${time}` : runMoment(when, now);
}

/**
 * A moment of the sun in a word.
 *
 * @param event - The moment, as the trigger names it.
 * @returns "Sunset".
 */
function sunWord(event: string): string {
  const message = SUN_EVENTS[event];

  return message === undefined ? event : text(message);
}

/**
 * Renders the chip of the card: the accent while it runs on its own, grey while paused, red
 * after a failed run.
 *
 * @param props - Its look.
 * @param props.tone - Which.
 * @returns The chip.
 */
function Chip(props: { readonly tone: 'on' | 'paused' | 'failed' }) {
  const { tone } = props;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-field transition-colors duration-200',
        tone === 'on'
          ? 'bg-primary/14 text-primary'
          : tone === 'failed'
            ? 'bg-danger/14 text-danger'
            : 'bg-surface-raised text-foreground-subtle',
      )}
    >
      <AppIcon id="workflow" size={16} />
    </span>
  );
}

/**
 * Renders an automation's card.
 *
 * @param props - See {@link AutomationCardProps}.
 * @returns The card.
 */
export function AutomationCard(props: AutomationCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sample = useCardSample();
  const can = useSession((state) => state.can);

  const { card } = props;
  const automations = useAutomationList();
  const house = useHouseClock();
  const automation = automations.find((each) => each.id === card.automationId);
  const title = card.title ?? automation?.name ?? kindName('automation');
  const canSwitch = sample !== null || can('automation:write');
  const canRun = sample !== null || can('automation:trigger');

  const toggle = useMutation({
    /**
     * Switches the automation on or off.
     *
     * @param isEnabled - Whether it should run on its own.
     * @returns The automation as it now stands.
     */
    mutationFn: async (isEnabled: boolean): Promise<AutomationView> =>
      updateAutomation(card.automationId, { isEnabled }),

    /** Reads the automations again. */
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.automations });
    },

    /**
     * Says why it could not be switched.
     *
     * @param error - What went wrong.
     */
    onError: (error) => {
      toast.error({
        title: t('dashboard.cards.automationCard.couldNotSwitch', 'Could not switch {{name}}', {
          name: title,
        }),
        message: toMessage(error),
      });
    },
  });
  const run = useMutation({
    /**
     * Runs it now.
     *
     * @returns What the hub said.
     */
    mutationFn: async () => triggerAutomation(card.automationId),

    /** Says it ran, and reads the automations again for its last run. */
    onSuccess: async () => {
      toast.success({
        title: t('dashboard.cards.automationCard.ran', '{{name}} ran', { name: title }),
      });
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.automations });
    },

    /**
     * Says why it could not run.
     *
     * @param error - What went wrong.
     */
    onError: (error) => {
      toast.error({
        title: t('dashboard.cards.automationCard.couldNotRun', 'Could not run {{name}}', {
          name: title,
        }),
        message: toMessage(error),
      });
    },
  });

  if (card.automationId === NO_AUTOMATION || automation === undefined) {
    return (
      <CardFrame label={title} tone="faint">
        <div className="flex h-8 shrink-0 items-center gap-2.5">
          <Chip tone="paused" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ui leading-[18px] font-medium">{title}</span>
            <span className="truncate text-caption leading-4 text-foreground-subtle">
              {card.automationId === NO_AUTOMATION
                ? t('dashboard.cards.automationCard.noneYet', 'No automation yet')
                : t('dashboard.cards.automationCard.gone', 'Not there any more')}
            </span>
          </span>
        </div>
      </CardFrame>
    );
  }

  const isOn = toggle.isPending ? toggle.variables : automation.isEnabled;
  const lastRun = automation.lastRun;
  const hasFailed =
    lastRun !== null && (lastRun.result === 'failed' || lastRun.result === 'timeout');
  const tone = hasFailed ? 'failed' : isOn ? 'on' : 'paused';
  const next = nextRunOf({ ...automation, isEnabled: isOn }, house);
  const lastWords =
    lastRun === null
      ? t('dashboard.cards.automationCard.neverRan', 'Never ran')
      : momentWords(lastRun.time);
  const nextWords =
    next === null
      ? '—'
      : next.sun === null
        ? momentWords(next.at)
        : t('dashboard.cards.automationCard.sunAt', '{{event}} · {{time}}', {
            event: sunWord(next.sun),
            time: clockText(next.at),
          });
  const line = hasFailed ? (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-caption text-danger">
      <AppIcon id="triangle-alert" size={13} />
      <span className="truncate">
        {t('dashboard.cards.automationCard.failedAt', 'Failed {{when}}', { when: lastWords })}
      </span>
    </span>
  ) : (
    <Caption>
      {isOn
        ? lastRun === null
          ? lastWords
          : t('dashboard.cards.automationCard.ranAt', 'Ran {{when}}', { when: lastWords })
        : t('dashboard.cards.automationCard.paused', 'Paused')}
    </Caption>
  );
  const runButton = canRun ? (
    <button
      type="button"
      aria-label={t('dashboard.cards.automationCard.runNow', 'Run now')}
      title={t('dashboard.cards.automationCard.runNow', 'Run now')}
      disabled={run.isPending}
      className={cn(
        'press-scale relative z-10 flex shrink-0 items-center justify-center rounded-pill border border-border-strong bg-surface-raised text-foreground',
        'transition-colors duration-150 hover:enabled:bg-surface-high disabled:opacity-60',
        card.w === 1 ? 'size-7.5' : 'size-8',
      )}
      onClick={() => {
        run.mutate();
      }}
    >
      {run.isPending ? (
        <span className="inline-flex animate-spin">
          <AppIcon id="loader-circle" size={15} />
        </span>
      ) : (
        <AppIcon id="play" size={15} />
      )}
    </button>
  ) : null;
  const toggleSwitch = canSwitch ? (
    <span className="relative z-10 inline-flex">
      <Switch
        label={title}
        size="medium"
        isOn={isOn}
        isBusy={toggle.isPending}
        onChange={(next) => {
          toggle.mutate(next);
        }}
      />
    </span>
  ) : null;
  const head = (
    <div className="flex h-8 min-w-0 shrink-0 items-center gap-2.5">
      <Chip tone={tone} />
      <span className="flex min-w-0 grow flex-col">
        <span className="truncate text-ui leading-[18px] font-medium">{title}</span>
        <span className="truncate text-caption leading-4 text-foreground-subtle">
          {kindName('automation')}
        </span>
      </span>
    </div>
  );

  if (card.w === 1) {
    return (
      <CardFrame label={title}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 grow">{head}</div>
          {toggleSwitch}
        </div>
        <div className="grow" />
        <div className="flex min-w-0 items-center justify-between gap-2.5">
          {line}
          {runButton}
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title}>
      <div className="flex h-full items-center gap-5">
        <div className="w-40 shrink-0">{head}</div>
        <div className="grid min-w-0 grow grid-cols-2 gap-3">
          <span className="flex min-w-0 flex-col gap-[3px]">
            <span className="text-label text-foreground-subtle">
              {t('dashboard.cards.automationCard.lastRun', 'Last run')}
            </span>
            <span
              className={cn(
                'truncate text-title font-medium tabular-nums',
                hasFailed ? 'text-danger' : 'text-foreground',
              )}
            >
              {lastWords}
            </span>
          </span>
          <span className="flex min-w-0 flex-col gap-[3px]">
            <span className="text-label text-foreground-subtle">
              {t('dashboard.cards.automationCard.next', 'Next')}
            </span>
            <span className="truncate text-title font-medium text-foreground tabular-nums">
              {isOn ? nextWords : t('dashboard.cards.automationCard.paused', 'Paused')}
            </span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {runButton}
          {toggleSwitch}
        </div>
      </div>
    </CardFrame>
  );
}

/**
 * What every block's ⋯ menu does: rename it, test it, turn it off and on - and what testing it
 * said, in its header and, when there is more to say, in a card at its top.
 *
 * **Rename** puts a field where the summary is; the name then reads in its place, and the summary
 * is the card's tooltip. **Test** tries the block as it is now, saved or not: an action runs -
 * its commands really reach the devices, which the menu says before anybody presses it - a
 * condition is checked against the house, a trigger says whether what it waits for holds or when
 * it next fires. **Turn off** keeps the block and has the engine skip it.
 *
 * A test's answer is kept by block id (`block-ui.tsx`), so it stays with a block that is moved,
 * and is marked as out of date once the block is changed. A long error never goes in the header
 * (the house rule for errors): the header says Failed, the card says why.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import {
  automationActionSchema,
  automationTriggerSchema,
  conditionNodeSchema,
  type AutomationTestReply,
  type AutomationTestTarget,
} from '@nebulahome/contracts';
import { BlockNotice, BlockStatus, Button, type BlockRename, type MenuItem } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { translate } from '@/i18n/messages';
import { useBlockUi, useBlockUiStoreHandle } from '@/lib/block-ui';
import { shortMoment } from '@/lib/cron-words';
import { formatDuration } from '@/lib/duration';
import { toMessage } from '@/lib/error-message';
import { cancelAutomationTest, testAutomationBlock } from '@/library/api';
import { describePath, withoutKey } from '@/library/automation-draft';
import type { BlockFamily } from '@/library/block-path';
import { useEditorHouse } from '@/routes/library/automation/editor-house';

/** A block's own name and switch, which every block has. */
type MetaBlock = { readonly name?: string | undefined; readonly isEnabled?: boolean | undefined };

/** What the tools need. */
export type BlockToolsOptions<TBlock extends MetaBlock> = {
  /** The block's id. */
  readonly id: string;

  readonly family: BlockFamily;

  /** The block as it is now. */
  readonly block: TBlock;

  /** Writes the block back, renamed or turned off. */
  readonly onChange: (block: TBlock) => void;

  /** Why it cannot be tested, when it cannot: a manual trigger, an event. */
  readonly untestable?: string | undefined;
};

/** What the block draws with them. */
export type BlockTools = {
  readonly menu: readonly MenuItem[];
  readonly status: ReactNode;
  readonly notice: ReactNode;
  readonly rename: BlockRename | undefined;
  readonly isDisabled: boolean;
};

/**
 * What is wrong with a block that does not parse, in the editor's words.
 *
 * @param error - What the schema found.
 * @returns The sentence.
 */
function problemOf(error: z.ZodError): string {
  const [issue] = error.issues;
  const where = issue === undefined ? '' : describePath(['', ...issue.path]);

  const problem =
    issue?.message ?? translate('automation.blockTools.itIsNotWhole', 'it is not whole');

  return where === ''
    ? translate('automation.blockTools.finishItFirst', 'Finish it first: {{problem}}', { problem })
    : translate(
        'automation.blockTools.finishItFirstWhere',
        'Finish it first - {{where}}: {{problem}}',
        {
          where,
          problem,
        },
      );
}

/**
 * The target a test is about, after checking the block is whole.
 *
 * @param family - The block's family.
 * @param block - The block.
 * @returns The target, or what is wrong with the block.
 */
function targetOf(
  family: BlockFamily,
  block: unknown,
): { readonly target: AutomationTestTarget } | { readonly problem: string } {
  if (family === 'trigger') {
    const parsed = automationTriggerSchema.safeParse(block);

    return parsed.success
      ? { target: { kind: 'trigger', trigger: parsed.data } }
      : { problem: problemOf(parsed.error) };
  }

  if (family === 'condition') {
    const parsed = conditionNodeSchema.safeParse(block);

    return parsed.success
      ? { target: { kind: 'condition', condition: parsed.data } }
      : { problem: problemOf(parsed.error) };
  }

  const parsed = automationActionSchema.safeParse(block);

  return parsed.success
    ? { target: { kind: 'action', action: parsed.data } }
    : { problem: problemOf(parsed.error) };
}

/**
 * The short status a test's answer reads as in the header.
 *
 * @param reply - What the test found.
 * @param timeZone - The house's zone, for a next run.
 * @returns The pill.
 */
function statusOf(reply: AutomationTestReply, timeZone: string): ReactNode {
  switch (reply.kind) {
    case 'trigger': {
      if (reply.problem !== undefined) {
        return (
          <BlockStatus tone="warning">
            {translate('automation.blockTools.cannotFire', 'Cannot fire')}
          </BlockStatus>
        );
      }

      if (reply.nextAt !== null) {
        return (
          <BlockStatus tone="neutral" title={reply.detail}>
            {translate('automation.blockTools.next', 'Next · {{when}}', {
              when: shortMoment(reply.nextAt, timeZone),
            })}
          </BlockStatus>
        );
      }

      if (reply.matches === null) {
        return (
          <BlockStatus tone="neutral" title={reply.detail}>
            {translate('automation.blockTools.tested', 'Tested')}
          </BlockStatus>
        );
      }

      return (
        <BlockStatus tone={reply.matches ? 'success' : 'neutral'} title={reply.detail}>
          {reply.matches
            ? translate('automation.blockTools.holdsNow', 'Holds now')
            : translate('automation.blockTools.notNow', 'Not now')}
        </BlockStatus>
      );
    }
    case 'condition': {
      return (
        <BlockStatus tone={reply.value ? 'success' : 'neutral'}>
          {reply.value
            ? translate('automation.blockTools.trueNow', 'True now')
            : translate('automation.blockTools.falseNow', 'False now')}
        </BlockStatus>
      );
    }
    case 'action': {
      switch (reply.result) {
        case 'ok': {
          return (
            <BlockStatus tone="success">
              {translate('automation.blockTools.done', 'Done · {{duration}}', {
                duration: formatDuration(reply.durationMs),
              })}
            </BlockStatus>
          );
        }
        case 'partial': {
          return (
            <BlockStatus tone="warning">
              {translate('automation.blockTools.partlyDone', 'Partly done')}
            </BlockStatus>
          );
        }
        case 'failed': {
          return (
            <BlockStatus tone="danger">
              {translate('automation.blockTools.failed', 'Failed')}
            </BlockStatus>
          );
        }
        case 'timeout': {
          return (
            <BlockStatus tone="warning">
              {translate('automation.blockTools.stoppedAfterAMinute', 'Stopped after a minute')}
            </BlockStatus>
          );
        }
        case 'cancelled': {
          return (
            <BlockStatus tone="neutral">
              {translate('automation.blockTools.stopped', 'Stopped')}
            </BlockStatus>
          );
        }
      }
    }
  }
}

/**
 * What a test's answer has to say beyond the header, if anything: a failure's message, a trigger
 * that cannot fire.
 *
 * @param reply - What the test found.
 * @returns The message, or null.
 */
function messageOf(reply: AutomationTestReply): string | null {
  if (reply.kind === 'trigger') {
    return reply.problem ?? null;
  }

  if (reply.kind === 'action' && reply.result !== 'ok' && reply.result !== 'cancelled') {
    const failed = reply.steps.find((step) => step.error !== undefined);

    return reply.error ?? failed?.error ?? null;
  }

  return null;
}

/**
 * The menu, the status, the notice and the name field of one block.
 *
 * @param options - See {@link BlockToolsOptions}.
 * @returns See {@link BlockTools}.
 */
export function useBlockTools<TBlock extends MetaBlock>(
  options: BlockToolsOptions<TBlock>,
): BlockTools {
  const { t } = useTranslation();

  const { id, family, block, onChange, untestable } = options;
  const ui = useBlockUi(id, false);
  const store = useBlockUiStoreHandle();
  const house = useEditorHouse();
  const can = useSession((state) => state.can);
  const fingerprint = JSON.stringify(block);
  const test = ui.test;
  const isRunning = test?.status === 'running';
  const isStale =
    test !== undefined && test.status !== 'running' && test.fingerprint !== fingerprint;
  const isDisabled = block.isEnabled === false;
  const canTest = can('automation:write') && (family !== 'action' || can('automation:trigger'));

  /** Tries the block now. */
  const run = (): void => {
    const checked = targetOf(family, withoutKey(block, 'isEnabled'));

    if ('problem' in checked) {
      store.setTest(id, { status: 'error', message: checked.problem, fingerprint });

      return;
    }

    const testId = crypto.randomUUID();

    store.setTest(id, { status: 'running', testId });
    ui.setOpen(true);
    testAutomationBlock({ testId, target: checked.target }).then(
      (reply) => {
        store.setTest(id, { status: 'done', reply, fingerprint });
      },
      (error: unknown) => {
        store.setTest(id, { status: 'error', message: toMessage(error), fingerprint });
      },
    );
  };

  const menu: MenuItem[] = [
    {
      label: t('automation.blockTools.rename', 'Rename'),
      icon: 'pencil',
      description: t(
        'automation.blockTools.nameOfItsOwn',
        'A name of its own, in place of what the card says.',
      ),
      onSelect: ui.startRename,
    },
    ...(block.name === undefined
      ? []
      : [
          {
            label: t('automation.blockTools.clearTheName', 'Clear the name'),
            icon: 'x' as const,
            /** Takes the name away: the card says what the block does again. */
            onSelect: () => {
              onChange(withoutKey(block, 'name') as TBlock);
            },
          },
        ]),
    isRunning
      ? {
          label: t('automation.blockTools.stopTheTest', 'Stop the test'),
          icon: 'square' as const,
          /** Asks core to stop the test going on. */
          onSelect: () => {
            void cancelAutomationTest(test.testId);
          },
        }
      : {
          label: t('automation.blockTools.test', 'Test'),
          icon: 'play' as const,
          description:
            family === 'action'
              ? t(
                  'automation.blockTools.runsItNowOn',
                  'Runs it now, on its own: the devices will move.',
                )
              : family === 'condition'
                ? t('automation.blockTools.checksItAgainstThe', 'Checks it against the house now.')
                : t(
                    'automation.blockTools.saysWhetherItHolds',
                    'Says whether it holds now, or when it next fires.',
                  ),
          disabled: untestable !== undefined || !canTest,
          disabledReason:
            untestable ??
            (family === 'action'
              ? t(
                  'automation.blockTools.testingAnActionTakes',
                  'Testing an action takes the right to write and to run automations',
                )
              : t(
                  'automation.blockTools.testingTakesTheRight',
                  'Testing takes the right to write automations',
                )),
          onSelect: run,
        },
    {
      label: isDisabled
        ? t('automation.blockTools.turnOn', 'Turn on')
        : t('automation.blockTools.turnOff', 'Turn off'),
      icon: 'power',
      description: isDisabled
        ? t('automation.blockTools.itCountsAgainWhen', 'It counts again when the automation runs.')
        : t(
            'automation.blockTools.keptHereAndSkipped',
            'Kept here, and skipped when the automation runs.',
          ),
      /** Turns the block off, or back on. */
      onSelect: () => {
        onChange(
          (isDisabled ? withoutKey(block, 'isEnabled') : { ...block, isEnabled: false }) as TBlock,
        );
      },
    },
  ];

  let status: ReactNode = null;
  let notice: ReactNode = null;

  if (test?.status === 'running') {
    status = (
      <BlockStatus tone="running">{t('automation.blockTools.testing', 'Testing…')}</BlockStatus>
    );
  } else if (test?.status === 'error') {
    status = (
      <BlockStatus tone="danger">{t('automation.blockTools.notTested', 'Not tested')}</BlockStatus>
    );
    notice = test.message;
  } else if (test?.status === 'done') {
    status = statusOf(test.reply, house.timeZone);
    notice = messageOf(test.reply);
  }

  if (isStale && status !== null) {
    status = (
      <span
        className="opacity-55"
        title={t('automation.blockTools.changedSinceItWas', 'Changed since it was tested')}
      >
        {status}
      </span>
    );
  }

  return {
    menu,
    status,
    notice:
      notice === null ? null : (
        <BlockNotice
          tone={test?.status === 'done' && test.reply.kind === 'trigger' ? 'warning' : 'danger'}
          action={
            <Button
              variant="bare"
              size="compact"
              onClick={() => {
                store.setTest(id, undefined);
              }}
            >
              {t('automation.blockTools.dismiss', 'Dismiss')}
            </Button>
          }
        >
          {notice}
        </BlockNotice>
      ),
    rename: ui.isRenaming
      ? {
          value: block.name ?? '',
          /**
           * Keeps the name typed, or takes it away when nothing was.
           *
           * @param name - What was typed, trimmed.
           */
          onCommit: (name) => {
            ui.stopRename();
            onChange((name === '' ? withoutKey(block, 'name') : { ...block, name }) as TBlock);
          },
          onCancel: ui.stopRename,
        }
      : undefined,
    isDisabled,
  };
}

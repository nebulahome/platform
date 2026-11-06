/**
 * A lock, as the canvas draws it (`N-Entity-Lock-Basic`, `N-Entity-Lock-More`): the bolt in a
 * ring - green locked, amber unlocked, red jammed, a spinner while it moves - the word and since
 * when, and its actions, each held for a second. A lock that pulls its latch can also open the
 * door; one that needs a code asks for it on a keypad first, with as many dots as the code has
 * digits.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { paramsOf } from '@/library/entity-control';
import { clockText } from '@/routes/library/entity/sheet/history';
import { HoldAction } from '@/routes/library/entity/sheet/parts/hold-action';
import { useSinceLine } from '@/routes/library/entity/sheet/parts/sheet-controls';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';

/** How the ring is drawn for each standing of the bolt. */
const LOOKS = {
  locked: {
    icon: 'lock',
    ring: 'border-success/34 text-success bg-[radial-gradient(circle_at_50%_38%,color-mix(in_oklab,var(--color-success)_14%,transparent),color-mix(in_oklab,var(--color-success)_5%,transparent)_72%)] shadow-[0_0_60px_color-mix(in_oklab,var(--color-success)_18%,transparent)]',
  },
  unlocked: {
    icon: 'lock-open',
    ring: 'border-lamp/50 text-lamp bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-lamp)_16%,transparent),color-mix(in_oklab,var(--color-lamp)_2%,transparent)_70%)]',
  },
  jammed: {
    icon: 'lock-keyhole',
    ring: 'border-danger/50 text-danger bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-danger)_16%,transparent),color-mix(in_oklab,var(--color-danger)_2%,transparent)_70%)]',
  },
  moving: {
    icon: 'loader-circle',
    ring: 'border-dashed border-lamp/50 text-lamp bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-lamp)_16%,transparent),color-mix(in_oklab,var(--color-lamp)_2%,transparent)_70%)]',
  },
} as const satisfies Record<string, { icon: UiIconId; ring: string }>;

/**
 * The body of a lock.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function LockBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, disabled, history } = props;
  const since = useSinceLine(entity, history);
  const params = paramsOf(entity, 'lock');
  const lock = state.lock;
  const [code, setCode] = useState('');

  if (lock === undefined) {
    return null;
  }

  const motion = lock.motion;
  const standing = motion !== undefined ? 'moving' : lock.lockState;
  const look = LOOKS[standing];
  const digits = params?.codeLength ?? 4;
  const needsCode =
    params?.hasCode === true && lock.lockState !== 'unlocked' && motion === undefined;
  const isOpen = lock.isOpen === true;
  const word =
    motion === 'locking'
      ? t('entity.sheet.lock.locking', 'Locking…')
      : motion === 'unlocking'
        ? t('entity.sheet.lock.unlocking', 'Unlocking…')
        : motion === 'opening'
          ? t('entity.sheet.lock.opening', 'Opening…')
          : lock.lockState === 'jammed'
            ? t('entity.sheet.lock.jammed', 'Jammed')
            : isOpen
              ? t('entity.sheet.lock.open', 'Open')
              : lock.lockState === 'locked'
                ? t('entity.sheet.lock.locked', 'Locked')
                : t('entity.sheet.lock.unlocked', 'Unlocked');
  const line =
    motion === undefined
      ? since
      : t('entity.sheet.lock.askedAt', 'Asked at {{time}}', {
          time: clockText(entity.lastChanged?.getTime() ?? props.now),
        });

  /**
   * Sends one of the lock's commands, with the code when it takes one.
   *
   * @param command - Lock, unlock or open.
   */
  const act = (command: 'lock' | 'unlock' | 'open'): void => {
    commander.send('lock', {
      command,
      ...(params?.hasCode === true && code !== '' ? { code } : {}),
    });
    setCode('');
  };

  if (needsCode && lock.lockState === 'locked') {
    return (
      <div className="flex grow flex-col justify-center gap-4">
        <div className="flex items-center gap-3.5">
          <span className="flex size-13 items-center justify-center rounded-full border border-success/45 bg-success/10 text-success">
            <AppIcon id="lock" size={22} />
          </span>
          <div className="flex flex-col gap-0.75">
            <span className="text-[22px] font-medium">{word}</span>
            <span className="text-ui-sm text-foreground-subtle">
              {t('entity.sheet.lock.enterCode', 'Enter the {{count}}-digit code to unlock', {
                count: digits,
              })}
            </span>
          </div>
        </div>
        <div className="flex justify-center gap-3 py-1.5" aria-hidden="true">
          {[...Array.from({ length: digits }).keys()].map((index) => (
            <span
              key={index}
              className={cn(
                'size-3 rounded-full border-[1.5px]',
                index < code.length ? 'border-success bg-success' : 'border-foreground-disabled',
              )}
            />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0'].map((key, index) =>
            key === '' ? (
              // eslint-disable-next-line react/no-array-index-key -- the gap under 7 has no key of its own
              <span key={index} />
            ) : (
              <button
                key={key}
                type="button"
                disabled={disabled || code.length >= digits}
                onClick={() => {
                  setCode(code + key);
                }}
                className="h-12 cursor-pointer rounded-inner border border-border-strong bg-surface-raised text-[18px] text-foreground"
              >
                {key}
              </button>
            ),
          )}
          <button
            type="button"
            aria-label={t('entity.sheet.lock.delete', 'Delete')}
            disabled={code === ''}
            onClick={() => {
              setCode(code.slice(0, -1));
            }}
            className="flex h-12 cursor-pointer items-center justify-center rounded-inner text-foreground-muted"
          >
            <AppIcon id="delete" size={20} />
          </button>
        </div>
        <div className="flex">
          <HoldAction
            icon="lock-open"
            fill="bg-success text-canvas"
            disabled={disabled || code.length < digits}
            onConfirm={() => {
              act('unlock');
            }}
          >
            {t('entity.sheet.lock.holdToUnlock', 'Hold to unlock')}
          </HoldAction>
        </div>
      </div>
    );
  }

  const actions: { command: 'lock' | 'unlock' | 'open'; icon: UiIconId; label: string }[] =
    lock.lockState === 'jammed'
      ? [
          {
            command: 'lock',
            icon: 'lock',
            label: t('entity.sheet.lock.holdToLock', 'Hold to lock'),
          },
          {
            command: 'unlock',
            icon: 'lock-open',
            label: t('entity.sheet.lock.holdToUnlock', 'Hold to unlock'),
          },
        ]
      : lock.lockState === 'locked' || motion === 'locking'
        ? [
            {
              command: 'unlock',
              icon: 'lock',
              label: t('entity.sheet.lock.holdToUnlock', 'Hold to unlock'),
            },
          ]
        : [
            {
              command: 'lock',
              icon: 'lock',
              label: t('entity.sheet.lock.holdToLock', 'Hold to lock'),
            },
            ...(params?.canOpen === true && !isOpen
              ? [
                  {
                    command: 'open' as const,
                    icon: 'door-open' as const,
                    label: t('entity.sheet.lock.holdToOpen', 'Hold to open'),
                  },
                ]
              : []),
          ];

  return (
    <div className="flex grow flex-col justify-center gap-5">
      <div className="flex flex-col items-center gap-4">
        <span
          className={cn(
            'flex size-37.5 items-center justify-center rounded-full border transition-colors duration-300',
            look.ring,
          )}
        >
          <span className={cn('flex', standing === 'moving' && 'entity-spin')}>
            <AppIcon id={look.icon} size={44} />
          </span>
        </span>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-[26px] font-medium tracking-[-0.02em]">{word}</span>
          <span className="text-ui-sm text-foreground-subtle">{line}</span>
        </div>
      </div>
      <div className="flex gap-2">
        {actions.map((action) => (
          <HoldAction
            key={action.command}
            icon={action.icon}
            size={actions.length === 1 ? 'large' : 'medium'}
            disabled={disabled || motion !== undefined}
            onConfirm={() => {
              act(action.command);
            }}
          >
            {action.label}
          </HoldAction>
        ))}
      </div>
    </div>
  );
}

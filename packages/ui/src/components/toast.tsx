/**
 * A toast: a short message that comes and goes by itself - the outcome of something somebody just
 * did. "Saved", "Couldn't adopt Shelly Plug S Gen3", "Firmware 1.4.4 is installing".
 *
 * Four kinds, each a filled circle in its colour with its mark, a title, a line or two, at most
 * one action, × to send it away at once, and a bar along the bottom edge that empties until it
 * leaves: 4 s for a success, 8 s for a warning, 10 s for an error, 6 s for information, 4 s more
 * with an action. The pointer over the stack, or focus inside it, stops every bar; they start
 * again from where they were.
 *
 * Bottom right, newest at the bottom, three at a time. More wait their turn rather than push the
 * oldest out: a message nobody had the time to read is a message lost. One that is already shown
 * or waiting is not added twice - a button pressed three times is one failure, not three.
 *
 * `toast.success(...)` is called from anywhere - a mutation's `onError` included - so the toasts
 * are a module's state rather than a context's, read by the one `<Toaster/>` the app mounts.
 *
 * Built on Radix's toast for what is easy to get wrong: the live region (errors interrupt, the
 * rest wait their turn), F6 to reach the stack, Escape, swiping one away, and the timers that
 * stop under the pointer and while the window is in the background. Coming and going is ours:
 * each toast is kept mounted while it leaves, so it can fade, then fold its height away and let
 * the others slide into its place - see `.toast` in styles.css.
 */
import { Toast } from 'radix-ui';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import type { IconNode } from '@nebulahome/contracts';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';
import { CatalogueIcon } from './catalogue-icon.js';

/** What kind of thing a toast says. */
export type ToastKind = 'success' | 'warning' | 'error' | 'info';

/** What a toast says. */
export type ToastMessage = {
  /** A few words, no full stop. */
  readonly title: string;

  /** One or two lines. */
  readonly message?: string;

  /** The one thing to do about it; doing it closes the toast. */
  readonly action?: { readonly label: string; readonly onSelect: () => void };
};

/** A toast in the stack or waiting for its turn. */
export type ToastEntry = ToastMessage & {
  readonly id: number;
  readonly kind: ToastKind;

  /** How long it stays, in milliseconds. */
  readonly duration: number;

  /** False while it leaves. */
  readonly isOpen: boolean;
};

/** How long each kind stays, in milliseconds. */
export const TOAST_DURATIONS: Readonly<Record<ToastKind, number>> = {
  success: 4000,
  warning: 8000,
  error: 10_000,
  info: 6000,
};

/** What an action adds, in milliseconds. */
const ACTION_EXTRA_MS = 4000;

/** How many are shown at once. */
export const TOAST_LIMIT = 3;

/** How long one takes to leave: fading out, then folding its height. Matches styles.css. */
const LEAVE_MS = 380;

/** The stack and the queue. */
type ToastState = {
  readonly shown: readonly ToastEntry[];
  readonly waiting: readonly ToastEntry[];
};

let state: ToastState = { shown: [], waiting: [] };
let nextId = 1;
const listeners = new Set<() => void>();

/**
 * Replaces the state and tells the Toaster.
 *
 * @param next - The new state.
 */
function setState(next: ToastState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Takes a toast out once it has left, and lets the first one waiting in.
 *
 * @param id - Which.
 */
function remove(id: number): void {
  const shown = state.shown.filter((entry) => entry.id !== id);
  const [first, ...waiting] = state.waiting;

  setState(
    first !== undefined && shown.length < TOAST_LIMIT
      ? { shown: [...shown, first], waiting }
      : { shown, waiting: state.waiting },
  );
}

/**
 * Sends a toast away: it leaves, and is taken out when it has.
 *
 * @param id - Which.
 */
export function dismissToast(id: number): void {
  if (!state.shown.some((entry) => entry.id === id && entry.isOpen)) {
    return;
  }
  setState({
    ...state,
    shown: state.shown.map((entry) => (entry.id === id ? { ...entry, isOpen: false } : entry)),
  });
  setTimeout(() => {
    remove(id);
  }, LEAVE_MS);
}

/**
 * Adds a toast: to the stack when there is room, otherwise to the end of the queue.
 *
 * @param kind - What kind.
 * @param message - What it says.
 * @returns Its id, or the id of the same toast already shown or waiting.
 */
function push(kind: ToastKind, message: ToastMessage): number {
  const same = [...state.shown.filter((entry) => entry.isOpen), ...state.waiting].find(
    (entry) =>
      entry.kind === kind && entry.title === message.title && entry.message === message.message,
  );
  if (same !== undefined) {
    return same.id;
  }

  const entry: ToastEntry = {
    ...message,
    id: nextId++,
    kind,
    duration: TOAST_DURATIONS[kind] + (message.action === undefined ? 0 : ACTION_EXTRA_MS),
    isOpen: true,
  };
  setState(
    state.shown.length < TOAST_LIMIT
      ? { ...state, shown: [...state.shown, entry] }
      : { ...state, waiting: [...state.waiting, entry] },
  );

  return entry.id;
}

/** Shows a toast; one function per kind. */
export const toast = {
  /**
   * Confirms what was just done.
   *
   * @param message - What it says.
   * @returns Its id.
   */
  success: (message: ToastMessage) => push('success', message),

  /**
   * Something that needs a look, not right now.
   *
   * @param message - What it says.
   * @returns Its id.
   */
  warning: (message: ToastMessage) => push('warning', message),

  /**
   * Something that failed.
   *
   * @param message - What it says.
   * @returns Its id.
   */
  error: (message: ToastMessage) => push('error', message),

  /**
   * Something that started or changed.
   *
   * @param message - What it says.
   * @returns Its id.
   */
  info: (message: ToastMessage) => push('info', message),
};

/**
 * Reads the stack and the queue - for the Toaster, and for tests.
 *
 * @returns Them.
 */
export function readToasts(): ToastState {
  return state;
}

/** Empties the stack and the queue; for tests. */
export function clearToasts(): void {
  setState({ shown: [], waiting: [] });
}

/**
 * Reads whether any toast is on the screen.
 *
 * @returns True while one is, one leaving included.
 */
function isAnyShown(): boolean {
  return state.shown.length > 0;
}

/**
 * Whether any toast is on the screen, one leaving included: for what sits in the stack's corner
 * and makes room for it, as a floating window does.
 *
 * @returns True while one is.
 */
export function useToastsShown(): boolean {
  return useSyncExternalStore(subscribe, isAnyShown, () => false);
}

/**
 * Subscribes to the state.
 *
 * @param listener - Called on every change.
 * @returns The unsubscribe.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** The marks Lucide has no plain version of: ! and i without their circle. */
const MARKS: Readonly<Record<'warning' | 'info', IconNode>> = {
  warning: [
    ['path', { d: 'M12 7v6' }],
    ['path', { d: 'M12 16.8h.01' }],
  ],
  info: [
    ['path', { d: 'M12 11v6' }],
    ['path', { d: 'M12 7.2h.01' }],
  ],
};

/**
 * The look of each kind: the circle, the bar and the action's underline. The shadow's tint is
 * styles.css's, by `data-kind`.
 */
const KINDS: Readonly<Record<ToastKind, { readonly fill: string; readonly underline: string }>> = {
  success: {
    fill: 'bg-success',
    underline: 'decoration-success/70',
  },
  warning: {
    fill: 'bg-warning',
    underline: 'decoration-warning/70',
  },
  error: {
    fill: 'bg-danger',
    underline: 'decoration-danger/70',
  },
  info: {
    fill: 'bg-cyan',
    underline: 'decoration-cyan/70',
  },
};

/**
 * The kind's mark, dark on its circle.
 *
 * @param props - The kind.
 * @param props.kind - It.
 * @returns The mark.
 */
function KindMark(props: { readonly kind: ToastKind }) {
  const { kind } = props;
  const mark = { size: 13, strokeWidth: 2.8, className: 'text-canvas' };

  return kind === 'success' ? (
    <AppIcon id="check" {...mark} />
  ) : kind === 'error' ? (
    <AppIcon id="x" {...mark} />
  ) : (
    <CatalogueIcon node={MARKS[kind]} frame={{ x: 0, y: 0, size: 24 }} {...mark} />
  );
}

/**
 * One toast.
 *
 * @param props - It.
 * @param props.entry - What it says, and whether it is leaving.
 * @returns The toast.
 */
function ToastItem(props: { readonly entry: ToastEntry }) {
  const { t } = useTranslation();
  const { entry } = props;
  const look = KINDS[entry.kind];
  const [isPaused, setPaused] = useState(false);

  return (
    <Toast.Root
      forceMount
      open={entry.isOpen}
      duration={entry.duration}
      type={entry.kind === 'error' ? 'foreground' : 'background'}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          dismissToast(entry.id);
        }
      }}
      onPause={() => {
        setPaused(true);
      }}
      onResume={() => {
        setPaused(false);
      }}
      className="toast pointer-events-auto"
    >
      <div className="min-h-0 pt-3">
        <div
          data-kind={entry.kind}
          className="toast-card relative flex w-full gap-3.5 overflow-hidden rounded-inner border border-border-strong bg-surface-raised py-4 pr-11 pb-5 pl-4 sm:w-100"
        >
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 flex size-5.5 shrink-0 items-center justify-center rounded-full',
              look.fill,
            )}
          >
            <KindMark kind={entry.kind} />
          </span>
          <div className="flex min-w-0 flex-col gap-1 pt-0.75">
            <Toast.Title className="text-title font-medium text-foreground">
              {entry.title}
            </Toast.Title>
            {entry.message === undefined ? null : (
              <Toast.Description className="text-ui-sm text-foreground-muted">
                {entry.message}
              </Toast.Description>
            )}
            {entry.action === undefined ? null : (
              <Toast.Action
                altText={entry.action.label}
                className={cn(
                  'mt-1 self-start text-ui-sm font-medium text-foreground underline underline-offset-3',
                  look.underline,
                )}
                onClick={entry.action.onSelect}
              >
                {entry.action.label}
              </Toast.Action>
            )}
          </div>
          <Toast.Close
            aria-label={t('ui.toast.close', 'Close')}
            title={t('ui.toast.close', 'Close')}
            className="absolute top-2.5 right-2.5 inline-flex size-7 items-center justify-center rounded-pill text-foreground-subtle hover:bg-surface-high hover:text-foreground"
          >
            <AppIcon id="x" size={15} />
          </Toast.Close>
          <span
            aria-hidden="true"
            className={cn('absolute inset-x-0 bottom-0 h-0.75 opacity-15', look.fill)}
          />
          <span
            aria-hidden="true"
            className={cn('toast-bar absolute inset-x-0 bottom-0 h-0.75', look.fill)}
            /* eslint-disable-next-line react/forbid-dom-props -- the bar runs for the toast's own time. */
            style={{
              animationDuration: `${String(entry.duration)}ms`,
              animationPlayState: isPaused || !entry.isOpen ? 'paused' : 'running',
            }}
          />
        </div>
      </div>
    </Toast.Root>
  );
}

/**
 * The stack, bottom right; mounted once, at the root of the app.
 *
 * @returns The stack.
 */
export function Toaster() {
  const { t } = useTranslation();
  const { shown } = useSyncExternalStore(subscribe, readToasts, readToasts);

  return (
    <Toast.Provider swipeDirection="right" label={t('ui.toast.region', 'Notifications')}>
      {shown.map((entry) => (
        <ToastItem key={entry.id} entry={entry} />
      ))}
      <Toast.Viewport className="pointer-events-none fixed inset-x-4 bottom-4 z-50 m-0 flex list-none flex-col p-0 outline-none sm:inset-x-auto sm:right-6 sm:bottom-6" />
    </Toast.Provider>
  );
}

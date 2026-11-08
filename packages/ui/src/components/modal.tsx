/**
 * A dialog.
 *
 * Built on the browser's own `<dialog>` rather than on a div with a high `z-index`, because
 * everything that makes a dialog a dialog is already in there: focus moves into it and cannot
 * leave, Escape closes it, the rest of the page becomes inert, and a screen reader announces it
 * as a dialog. A hand-rolled overlay has to reimplement all of that, and the reimplementation is
 * where the keyboard trap goes missing.
 *
 * `showModal()` is imperative, so opening it is an effect - one of the few places an effect is
 * the right tool rather than a smell. It synchronises a React prop with a DOM method; it does
 * not derive state.
 *
 * Clicking the backdrop closes it, and `closesOnBackdrop` turns that off for the dialogs where it
 * would cost something. Losing a half-typed form or a secret shown once to a misplaced click is a
 * worse failure than the press it costs to reach Cancel, so a dialog holding either of those
 * should opt out; for the rest, dismissing by clicking away is what people expect and not doing
 * it reads as the dialog being stuck.
 *
 * A drag that starts inside and ends on the backdrop is not a click on the backdrop. Selecting
 * the text of a token and releasing past the edge of the card is exactly how somebody would lose
 * the token they were copying, so the press and the release both have to land outside.
 *
 * Escape is handled here rather than left to the element, and on the document rather than on the
 * dialog. A modal dialog is meant to dismiss itself on what the specification calls a close
 * request, but what counts as one is the browser's business - and in the browser this was checked
 * in, the keydown reached the dialog while neither `cancel` nor `close` ever followed. Listening
 * on the dialog fixed that until focus was not inside it, which happens the moment the button
 * somebody had focused is the one that just disappeared: focus falls back to the body and the
 * key never bubbles through the dialog at all. The document hears it wherever it lands.
 *
 * Anything dismissible *inside* a dialog therefore has to stop Escape propagating once it has
 * handled it, or one press closes both. The dropdown does.
 *
 * A dialog can carry a second card beside its own - `aside` - for what the form is filled in
 * from: the models a device can be added as, which is a list of its own to scroll and search and
 * not a field of the form. The two are separate cards on the one backdrop, the side one as tall as
 * the dialog's own and scrolling inside itself however long its list is; on a narrow window it
 * stands above the dialog instead. They are one dialog to the browser: one focus trap, one
 * Escape, one title.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';
import { IconButton } from './icon-button.js';

/*
 * The dialog arrives and leaves; it does not stay moved.
 *
 * Opening, the backdrop darkens and the card fades in from a shade smaller (`animate-dialog-in`).
 * The scale is an animation with no fill, so it is gone once played: a `transform` left on the
 * dialog makes it the containing block of every `position: fixed` descendant, and the dropdown
 * inside is fixed exactly to escape the dialog's scrolling box - a dialog that kept rising four
 * pixels put the role list back inside it, with a scrollbar, ten pixels too wide.
 *
 * Closing, the dialog is gone at once - closed, or unmounted with whatever held it - so what fades
 * out with its backdrop is a copy of it as it last looked (`fadeOut`).
 */
/** What a card of a dialog is drawn as: the dialog's own, and the one beside it. */
const CARD = 'rounded-dialog border border-border-strong bg-surface text-foreground shadow-dialog';

/** What every dialog is: centred over a backdrop, both arriving. */
const DIALOG = 'm-auto p-0 backdrop:bg-scrim backdrop:animate-backdrop-in';

/**
 * The frame of a dialog that draws no card of its own - a pair, or a bare dialog: the whole
 * window, see-through, what it holds centred and scrolling when taller than the window. A frame
 * the size of its cards clipped them - their shadows reach well past their edges and were cut off
 * square under the card - and gave itself a scrollbar while a card arrived from a little lower.
 */
const FRAME =
  'size-full max-h-none max-w-none overflow-y-auto border-0 bg-transparent p-4 text-foreground shadow-none open:flex';

/** How wide a pair is, by the size of the dialog's own card. */
const PAIR_WIDTH = {
  small: 'w-[min(94vw,45rem)]',
  medium: 'w-[min(94vw,48rem)]',
  brief: 'w-[min(94vw,59rem)]',
  form: 'w-[min(94vw,59rem)]',
  large: 'w-[min(94vw,59rem)]',
  wide: 'w-[min(94vw,59rem)]',
  picker: 'w-[min(94vw,59rem)]',
  xlarge: 'w-[min(94vw,59rem)]',
} as const;

/** A copy of a dialog as it last looked, and how far its scrolled boxes were scrolled. */
type Snapshot = {
  readonly ghost: HTMLDialogElement;

  /** Each scrolled box, by its place among the dialog's elements, and how far down it was. */
  readonly scrolls: readonly (readonly [number, number])[];
};

/**
 * Copies a dialog while it is still in the page, to fade out once it is gone.
 *
 * @param dialog - The dialog.
 * @returns The copy, or null where nothing animates - a test's DOM.
 */
function snapshotOf(dialog: HTMLDialogElement): Snapshot | null {
  if (typeof dialog.getAnimations !== 'function') {
    return null;
  }

  const ghost = dialog.cloneNode(true) as HTMLDialogElement;
  const scrolls = [dialog, ...dialog.querySelectorAll('*')].flatMap((element, index) =>
    element.scrollTop > 0 ? [[index, element.scrollTop] as const] : [],
  );

  return { ghost, scrolls };
}

/**
 * Fades a dialog's copy out over the page, backdrop and all.
 *
 * Shown as a popover rather than as a modal: in the top layer with a backdrop of its own, but
 * nothing behind it turns inert and focus stays where it is - so a dialog opened as this one
 * closes, a wizard's next step, has the keyboard at once. Removed once its animation ends, or at
 * once where there is none: for somebody who asked for less motion.
 *
 * @param snapshot - See {@link Snapshot}.
 */
function fadeOut(snapshot: Snapshot): void {
  const { ghost, scrolls } = snapshot;

  ghost.popover = 'manual';
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.add('modal-ghost');
  globalThis.document.body.append(ghost);

  try {
    ghost.showPopover();
  } catch {
    ghost.remove();

    return;
  }

  const boxes = [ghost, ...ghost.querySelectorAll('*')];

  for (const [index, top] of scrolls) {
    const box = boxes[index];

    if (box !== undefined) {
      box.scrollTop = top;
    }
  }

  const animations = ghost.getAnimations();

  if (animations.length === 0) {
    ghost.remove();

    return;
  }

  void Promise.allSettled(animations.map(async (animation) => animation.finished)).then(() => {
    ghost.remove();
  });
}

const dialogBox = cva(cn(DIALOG, CARD, 'open:animate-dialog-in'), {
  variants: {
    size: {
      /** A confirmation, or one field. */
      small: 'w-[min(92vw,26rem)]',

      /** The default: a short form. */
      medium: 'w-[min(92vw,29rem)]',

      /** A few fields and a choice: an entity's settings. */
      brief: 'w-[min(92vw,35rem)]',

      /** A form of a few sections: a device's settings, the code a Matter device is added by. */
      form: 'w-[min(92vw,37.5rem)]',

      /** A form with several fields, or something with a list in it. */
      large: 'w-[min(92vw,40rem)]',

      /** Two things side by side, and what joins them: a twin found, offered to link. */
      wide: 'w-[min(92vw,42.5rem)]',

      /** A picker of choices laid out two to a row: the automation editor's Add a block. */
      picker: 'w-[min(92vw,45rem)]',

      /** A dialog with pages of its own: the install dialogs' search and an item's page. */
      xlarge: 'w-[min(94vw,58rem)]',
    },
  },
  defaultVariants: { size: 'medium' },
});

/** What a dialog needs. */
export type ModalProps = Pick<VariantProps<typeof dialogBox>, 'size'> & {
  /** Whether it is open. */
  readonly isOpen: boolean;

  /** Called when the person dismisses it, by Escape, by the backdrop or by a control. */
  readonly onClose: () => void;

  /** The heading. */
  readonly title: string;

  /** A line under it saying what this is for. */
  readonly description?: ReactNode;

  /**
   * Whether clicking away dismisses it.
   *
   * Turn it off for a dialog holding something typed or something shown once - a password, a
   * token's secret, a set of recovery codes.
   */
  readonly closesOnBackdrop?: boolean;

  /** The body. */
  readonly children: ReactNode;

  /** The controls at the foot. */
  readonly footer?: ReactNode;

  /** A second card, beside the dialog's own on a wide window and above it on a narrow one. */
  readonly aside?: ReactNode;

  /** What the second card is called, to a screen reader. */
  readonly asideLabel?: string;

  /**
   * How the card is laid out. `plain`: the title over the body, the controls at its foot.
   * `sections`: a header bar - whatever leads it, the title, a close button - a body that scrolls
   * on its own, and a foot bar; the card keeps one height, so a dialog with pages does not jump
   * as they change. `card`: the same bars round a padded body, the card as tall as what it holds
   * - a confirmation with its consequences, a short form, a job's steps. `bare`: no card at all,
   * the children are the card - a dialog that draws its own, as an entity's does; the title is
   * then only what a screen reader calls it.
   */
  readonly layout?: 'plain' | 'sections' | 'card' | 'bare';

  /** What stands before the title - a way back, an icon. */
  readonly lead?: ReactNode;

  /** In the `sections` layout: what the close button is called. */
  readonly closeLabel?: string;

  /** In the sectioned header, before the close button: a wizard's steps. */
  readonly trail?: ReactNode;

  /**
   * In the `plain` layout: a close button beside the title, for a dialog with no foot to close
   * it from - a picker, where choosing is the only other way out.
   */
  readonly hasCloseButton?: boolean;

  /** Extra classes for the dialog: a tone for its card, such as `warning-glow`, or its backdrop. */
  readonly className?: string;
};

/**
 * Renders a dialog.
 *
 * @param props - See {@link ModalProps}.
 * @returns The dialog.
 */
export function Modal(props: ModalProps) {
  const { t } = useTranslation();
  const {
    isOpen,
    onClose,
    title,
    description,
    size,
    closesOnBackdrop = true,
    children,
    footer,
    aside,
    asideLabel,
    layout = 'plain',
    lead,
    closeLabel: givenCloseLabel,
    trail,
    hasCloseButton = false,
    className,
  } = props;
  const closeLabel = givenCloseLabel ?? t('ui.modal.close', 'Close');

  const dialog = useRef<HTMLDialogElement>(null);

  // The frame two cards sit in: a press on it, between or around them, is a press on the backdrop.
  const pair = useRef<HTMLDivElement>(null);
  const isPaired = aside !== undefined && aside !== null;
  const isBare = layout === 'bare';

  // Whether the press that is about to become a click started on the backdrop. A release outside
  // the card only counts when the press was outside it too.
  const pressedBackdrop = useRef(false);

  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  useEffect(() => {
    const element = dialog.current;

    if (element === null) {
      return;
    }

    if (isOpen && !element.open) {
      element.showModal();
    }

    if (!isOpen && element.open) {
      const snapshot = snapshotOf(element);

      element.close();

      if (snapshot !== null) {
        fadeOut(snapshot);
      }
    }
  }, [isOpen]);

  // Unmounted while open - the way most dialogs close, with whatever held them - it fades out too.
  // Copied while it is still in the page, faded once React has taken it out: strict mode runs this
  // cleanup once on a dialog it keeps, which then is still there.
  useLayoutEffect(() => {
    const element = dialog.current;

    return () => {
      if (element?.open !== true) {
        return;
      }

      const snapshot = snapshotOf(element);

      queueMicrotask(() => {
        if (snapshot !== null && !element.isConnected) {
          fadeOut(snapshot);
        }
      });
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    /**
     * Closes on Escape.
     *
     * @param event - The key press.
     */
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    globalThis.document.addEventListener('keydown', onEscape);

    return () => {
      globalThis.document.removeEventListener('keydown', onEscape);
    };
  }, [isOpen, onClose]);

  /**
   * Whether a press landed outside every card: on the dialog element, or on the frame of a pair.
   *
   * @param target - Where it landed.
   * @returns True for the backdrop.
   */
  const isBackdrop = (target: EventTarget): boolean =>
    target === dialog.current || (pair.current !== null && target === pair.current);

  /**
   * Records whether a press landed on the backdrop rather than on the card.
   *
   * The backdrop is part of the dialog element, so a press on it has the dialog itself as its
   * target - everything inside the card hits the padded div or one of its descendants.
   *
   * @param event - The press.
   */
  const onMouseDown = (event: MouseEvent<HTMLDialogElement>): void => {
    pressedBackdrop.current = isBackdrop(event.target);
  };

  /**
   * Closes when both halves of a click landed on the backdrop.
   *
   * @param event - The click.
   */
  const onClick = (event: MouseEvent<HTMLDialogElement>): void => {
    if (!closesOnBackdrop) {
      return;
    }

    if (pressedBackdrop.current && isBackdrop(event.target)) {
      onClose();
    }

    pressedBackdrop.current = false;
  };

  /**
   * Closes when the browser has closed this dialog - and only this one.
   *
   * A dialog opened from inside another dialog is a descendant of it, and although the native
   * `close` event does not bubble, React still hands it to every `onClose` above the target. Left
   * unchecked, picking an icon inside an edit dialog shut the edit dialog as well.
   *
   * @param event - The close.
   */
  const onNativeClose = (event: SyntheticEvent<HTMLDialogElement>): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  /**
   * Keeps the browser from closing the dialog on Escape by itself: the document's Escape handler
   * above closes it, through `onClose`, so that it fades out like every other way of closing.
   *
   * @param event - The browser's request to close.
   */
  const onCancel = (event: SyntheticEvent<HTMLDialogElement>): void => {
    if (event.target === event.currentTarget) {
      event.preventDefault();
    }
  };

  const sections = (
    <div className="flex h-[min(88vh,49rem)] flex-col">
      <header className="flex shrink-0 items-center gap-3.5 border-b border-border px-6 py-4.5">
        {lead}
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <h2 id={titleId} className="truncate text-headline-sm font-medium">
            {title}
          </h2>
          {description === undefined ? null : (
            <p id={descriptionId} className="truncate text-ui-sm text-foreground-subtle">
              {description}
            </p>
          )}
        </div>
        {trail}
        <IconButton variant="raised" label={closeLabel} onClick={onClose}>
          <AppIcon id="x" size={15} />
        </IconButton>
      </header>

      <div className="flex min-h-0 grow flex-col overflow-y-auto">{children}</div>

      {footer === undefined ? null : (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 border-t border-border px-6 py-4">
          {footer}
        </footer>
      )}
    </div>
  );

  const card = (
    <div className="flex max-h-[88vh] flex-col">
      <header className="flex shrink-0 items-center gap-3.5 border-b border-border px-6 py-5">
        {lead}
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <h2 id={titleId} className="truncate text-headline-sm font-medium">
            {title}
          </h2>
          {description === undefined ? null : (
            <p id={descriptionId} className="truncate text-ui-sm text-foreground-subtle">
              {description}
            </p>
          )}
        </div>
        {trail}
        <IconButton label={closeLabel} onClick={onClose}>
          <AppIcon id="x" size={16} />
        </IconButton>
      </header>

      <div className="flex min-h-0 grow flex-col gap-5 overflow-y-auto px-6 py-5.5">{children}</div>

      {footer === undefined ? null : (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-3.5">
          {footer}
        </footer>
      )}
    </div>
  );

  const body = isBare ? (
    children
  ) : layout === 'sections' ? (
    sections
  ) : layout === 'card' ? (
    card
  ) : (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-start gap-3.5">
        {lead}
        <div className="flex min-w-0 grow flex-col gap-1.5">
          <h2 id={titleId} className="text-headline-sm font-medium">
            {title}
          </h2>
          {description === undefined ? null : (
            <p id={descriptionId} className="text-ui text-foreground-subtle">
              {description}
            </p>
          )}
        </div>
        {hasCloseButton ? (
          <IconButton variant="bare" label={closeLabel} onClick={onClose}>
            <AppIcon id="x" size={15} />
          </IconButton>
        ) : null}
      </div>

      {children}

      {footer === undefined ? null : <div className="flex justify-end gap-2.5">{footer}</div>}
    </div>
  );

  return (
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions,
       jsx-a11y/click-events-have-key-events -- the handlers are here to dismiss the dialog by
       clicking its backdrop, which is a pointer affordance on top of a keyboard one that already
       exists: Escape closes it from anywhere, including when focus has fallen back to the body.
       The rule's concern is a click-only path to an action, and there is not one. Nothing inside
       the card is reached through these; they fire only when the target is the dialog element,
       which is the backdrop. */
    <dialog
      ref={dialog}
      aria-labelledby={isBare ? undefined : titleId}
      aria-label={isBare ? title : undefined}
      aria-describedby={description === undefined || isBare ? undefined : descriptionId}
      onClose={onNativeClose}
      onCancel={onCancel}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className={cn(
        isPaired || isBare
          ? cn(DIALOG, FRAME, !isBare && 'open:animate-dialog-in')
          : dialogBox({ size }),
        className,
      )}
    >
      {isPaired ? (
        <div
          ref={pair}
          className={cn(
            'm-auto grid max-w-full gap-3 md:grid-cols-[17.5rem_minmax(0,1fr)] md:items-stretch',
            PAIR_WIDTH[size ?? 'medium'],
          )}
        >
          <section
            aria-label={asideLabel}
            // Sized by the grid, not by its list: a list longer than the dialog scrolls inside the
            // card instead of stretching the pair. Clipped to its corners, or the scrollbar of that
            // list runs past the rounded one at the bottom.
            className={cn(
              CARD,
              'flex max-h-80 min-h-0 flex-col overflow-hidden md:max-h-none md:[contain:size]',
            )}
          >
            {aside}
          </section>
          <div className={cn(CARD, 'min-w-0')}>{body}</div>
        </div>
      ) : isBare ? (
        // The card arrives by itself, so the frame only centres it.
        <div className="m-auto max-w-full">{body}</div>
      ) : (
        body
      )}
    </dialog>
  );
}

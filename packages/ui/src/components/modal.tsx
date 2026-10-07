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
  useRef,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';
import { IconButton } from './icon-button.js';

/*
 * The dialog fades; it does not move.
 *
 * It used to rise four pixels, and those four pixels were a `transform` - which makes the element
 * a containing block for every `position: fixed` descendant. The dropdown inside it is fixed
 * exactly so that it can escape the dialog's scrolling box, and a transform on the dialog quietly
 * put it back: opening the role list gave the whole dialog a scrollbar again, and the list came
 * out ten pixels too wide because the button it had measured had just been narrowed by that
 * scrollbar.
 *
 * So the motion is opacity, which creates a stacking context and nothing else. What rises is the
 * dropdown, which has no fixed descendants of its own.
 */
/** What a card of a dialog is drawn as: the dialog's own, and the one beside it. */
const CARD = 'rounded-dialog border border-border-strong bg-surface text-foreground shadow-dialog';

const dialogBox = cva('m-auto p-0 backdrop:bg-scrim open:animate-fade-in', {
  variants: {
    size: {
      /** A confirmation, or one field. */
      small: 'w-[min(92vw,26rem)]',

      /** The default: a short form. */
      medium: 'w-[min(92vw,29rem)]',

      /** A form with several fields, or something with a list in it. */
      large: 'w-[min(92vw,40rem)]',

      /** A dialog with pages of its own: the install dialogs' search and an item's page. */
      xlarge: 'w-[min(94vw,58rem)]',
    },

    /**
     * Whether a second card stands beside the dialog's own. The dialog element is then only
     * the frame the two sit in: it draws no card itself, and is as wide as both.
     */
    isPaired: {
      false: CARD,
      true: 'overflow-y-auto border-0 bg-transparent text-foreground shadow-none',
    },
  },
  compoundVariants: [
    { isPaired: true, size: 'small', className: 'w-[min(94vw,45rem)]' },
    { isPaired: true, size: 'medium', className: 'w-[min(94vw,48rem)]' },
    { isPaired: true, size: 'large', className: 'w-[min(94vw,59rem)]' },
    { isPaired: true, size: 'xlarge', className: 'w-[min(94vw,59rem)]' },
  ],
  defaultVariants: { size: 'medium', isPaired: false },
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
   * as they change.
   */
  readonly layout?: 'plain' | 'sections';

  /** In the `sections` layout: what stands before the title - a way back, an icon. */
  readonly lead?: ReactNode;

  /** In the `sections` layout: what the close button is called. */
  readonly closeLabel?: string;
};

/**
 * Renders a dialog.
 *
 * @param props - See {@link ModalProps}.
 * @returns The dialog.
 */
export function Modal(props: ModalProps) {
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
    closeLabel = 'Close',
  } = props;

  const dialog = useRef<HTMLDialogElement>(null);

  // The frame two cards sit in: a press on it, between or around them, is a press on the backdrop.
  const pair = useRef<HTMLDivElement>(null);
  const isPaired = aside !== undefined && aside !== null;

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
      element.close();
    }
  }, [isOpen]);

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

  const body =
    layout === 'sections' ? (
      sections
    ) : (
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1.5">
          <h2 id={titleId} className="text-headline-sm font-medium">
            {title}
          </h2>
          {description === undefined ? null : (
            <p id={descriptionId} className="text-ui text-foreground-subtle">
              {description}
            </p>
          )}
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
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onClose={onNativeClose}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className={cn(dialogBox({ size, isPaired }))}
    >
      {isPaired ? (
        <div
          ref={pair}
          className="grid gap-3 md:grid-cols-[17.5rem_minmax(0,1fr)] md:items-stretch"
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
      ) : (
        body
      )}
    </dialog>
  );
}

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
const dialogBox = cva(
  'm-auto rounded-dialog border border-border-strong bg-surface p-0 text-foreground ' +
    'shadow-dialog backdrop:bg-canvas/70 backdrop:backdrop-blur-sm open:animate-fade-in',
  {
    variants: {
      size: {
        /** A confirmation, or one field. */
        small: 'w-[min(92vw,26rem)]',

        /** The default: a short form. */
        medium: 'w-[min(92vw,29rem)]',

        /** A form with several fields, or something with a list in it. */
        large: 'w-[min(92vw,40rem)]',
      },
    },
    defaultVariants: { size: 'medium' },
  },
);

/** What a dialog needs. */
export type ModalProps = VariantProps<typeof dialogBox> & {
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
  } = props;

  const dialog = useRef<HTMLDialogElement>(null);

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
   * Records whether a press landed on the backdrop rather than on the card.
   *
   * The backdrop is part of the dialog element, so a press on it has the dialog itself as its
   * target - everything inside the card hits the padded div or one of its descendants.
   *
   * @param event - The press.
   */
  const onMouseDown = (event: MouseEvent<HTMLDialogElement>): void => {
    pressedBackdrop.current = event.target === dialog.current;
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

    if (pressedBackdrop.current && event.target === dialog.current) {
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
      className={cn(dialogBox({ size }))}
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1.5">
          <h2 id={titleId} className="text-subhead font-semibold">
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
    </dialog>
  );
}

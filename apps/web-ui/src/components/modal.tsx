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
 * Clicking the backdrop does not close it, which is a deliberate departure from the usual
 * overlay. Every dialog in the settings section holds something typed or something shown once -
 * a password, a token's secret, a set of recovery codes - and losing that to a misplaced click
 * is a worse failure than the extra press it costs to reach Cancel. Escape still closes it,
 * because Escape is a decision and a stray click is not.
 */
import { useEffect, useRef, type ReactNode } from 'react';

/** What a dialog needs. */
export type ModalProps = {
  /** Whether it is open. */
  readonly isOpen: boolean;

  /** Called when the person dismisses it, by Escape, by the backdrop or by a control. */
  readonly onClose: () => void;

  /** The heading. */
  readonly title: string;

  /** A line under it saying what this is for. */
  readonly description?: string;

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
  const { isOpen, onClose, title, description, children, footer } = props;
  const dialog = useRef<HTMLDialogElement>(null);

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

  return (
    <dialog
      ref={dialog}
      aria-labelledby="modal-title"
      onClose={onClose}
      onKeyDown={(event) => {
        // Escape is handled here rather than left to the element. A modal dialog is supposed to
        // dismiss itself on what the specification calls a close request, but *what counts as
        // one* is left to the browser - and in at least one embedding the keydown arrives on the
        // dialog while neither `cancel` nor `close` ever follows, which leaves the only way out
        // of a form the Cancel button. Doing it here makes the behaviour the same everywhere;
        // where the browser does fire its own event as well, both paths ask for the same close
        // and the second one changes nothing.
        if (event.key === 'Escape') {
          onClose();
        }
      }}
      className="m-auto w-[min(92vw,460px)] rounded-dialog border border-border bg-surface p-0 text-foreground backdrop:bg-canvas/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1.5">
          <h2 id="modal-title" className="text-base font-medium tracking-tight">
            {title}
          </h2>
          {description === undefined ? null : (
            <p className="text-[13px] leading-relaxed text-foreground-subtle">{description}</p>
          )}
        </div>

        {children}

        {footer === undefined ? null : <div className="flex justify-end gap-2.5">{footer}</div>}
      </div>
    </dialog>
  );
}

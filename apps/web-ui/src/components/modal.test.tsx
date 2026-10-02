/**
 * The dialog.
 *
 * The Escape cases are here because that key was broken twice, in two different ways, and
 * neither showed up as anything. First the component listened for the `close` event and trusted
 * the browser to fire it: in the one this was checked in, the keydown reached the dialog and
 * neither `cancel` nor `close` followed, so the dialog stayed open - and because the component
 * believed it had closed, it could not be reopened either. Then it listened on the dialog
 * element, which works right up until focus is not inside it, and focus leaves the moment the
 * button somebody had focused is the one that just disappeared.
 *
 * So the last case fires the key at the body. That is the state a person is actually in after
 * removing a picture, and it is the one both earlier versions got wrong.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Modal } from '@nebulahome/ui';

/**
 * An edit dialog with a picker dialog inside it, the way a device's icon is chosen.
 *
 * @param props - What closing the outer dialog calls.
 * @param props.onOuterClose - Called when the outer dialog asks to be closed.
 * @returns The two dialogs.
 */
function Nested(props: { readonly onOuterClose: () => void }) {
  const [isPicking, setPicking] = useState(true);

  return (
    <Modal isOpen onClose={props.onOuterClose} title="Edit a device">
      <Modal
        isOpen={isPicking}
        onClose={() => {
          setPicking(false);
        }}
        title="Pick an icon"
      >
        <button
          type="button"
          onClick={() => {
            setPicking(false);
          }}
        >
          Pick
        </button>
      </Modal>
    </Modal>
  );
}

describe('Modal', () => {
  it('shows its title and body when open', () => {
    render(
      <Modal isOpen onClose={vi.fn()} title="Create a token">
        <p>the form</p>
      </Modal>,
    );

    expect(screen.getByText('Create a token')).toBeTruthy();
    expect(screen.getByText('the form')).toBeTruthy();
  });

  it('asks to be closed when Escape is pressed', () => {
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Create a token">
        <p>the form</p>
      </Modal>,
    );

    fireEvent.keyDown(screen.getByRole('dialog', { hidden: true }), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes even when focus has fallen back to the body', () => {
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Create a token">
        <p>the form</p>
      </Modal>,
    );

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops listening once it is closed', () => {
    const onClose = vi.fn();

    render(
      <Modal isOpen={false} onClose={onClose} title="Create a token">
        <p>the form</p>
      </Modal>,
    );

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores every other key', () => {
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Create a token">
        <p>the form</p>
      </Modal>,
    );

    // Typing into a form inside the dialog must not dismiss it.
    fireEvent.keyDown(screen.getByRole('dialog', { hidden: true }), { key: 'a' });
    fireEvent.keyDown(screen.getByRole('dialog', { hidden: true }), { key: 'Enter' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('names itself by its own heading', () => {
    render(
      <Modal isOpen onClose={vi.fn()} title="Create a token">
        <p>the form</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { hidden: true });

    // The relationship rather than the string. The id used to be the literal `modal-title`, which
    // is a duplicate id the moment two dialogs are mounted at once - and mounting two is normal,
    // because a closed one stays in the tree. What has to hold is that the dialog is named by its
    // own heading, whatever that heading's id turns out to be.
    expect(screen.getByText('Create a token').id).toBe(dialog.getAttribute('aria-labelledby'));
  });

  it('gives two dialogs different heading ids', () => {
    render(
      <>
        <Modal isOpen onClose={vi.fn()} title="First">
          <p>one</p>
        </Modal>
        <Modal isOpen onClose={vi.fn()} title="Second">
          <p>two</p>
        </Modal>
      </>,
    );

    expect(screen.getByText('First').id).not.toBe(screen.getByText('Second').id);
  });

  it('closes when a click starts and ends on the backdrop', () => {
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Invite somebody">
        <p>the form</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { hidden: true });

    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when a drag starts inside and ends on the backdrop', () => {
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Show the token">
        <p>a secret worth selecting</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { hidden: true });

    // Selecting text and releasing past the edge of the card is how somebody would otherwise lose
    // the secret they were in the middle of copying.
    fireEvent.mouseDown(screen.getByText('a secret worth selecting'));
    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks to be closed when the browser closes it', () => {
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Create a token">
        <p>the form</p>
      </Modal>,
    );

    fireEvent(screen.getByRole('dialog', { hidden: true }), new Event('close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps an outer dialog open when a dialog inside it closes', () => {
    const onOuterClose = vi.fn();

    render(<Nested onOuterClose={onOuterClose} />);

    // The picker's `close` event does not bubble in the DOM, but React delivers it to every
    // `onClose` above the target all the same - which used to shut the edit dialog under it.
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }));

    expect(onOuterClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Edit a device', hidden: true })).toBeTruthy();
  });

  it('ignores the backdrop when the dialog opts out', () => {
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Recovery codes" closesOnBackdrop={false}>
        <p>shown once</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { hidden: true });

    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });
});

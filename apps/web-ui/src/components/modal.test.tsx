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
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Modal } from '@/components/modal';

beforeAll(() => {
  // jsdom implements `<dialog>` but not the modal behaviour behind it, so `showModal` has to be
  // stood in for. What is under test is the component's own handling, not the browser's.
  if (typeof globalThis.HTMLDialogElement.prototype.showModal !== 'function') {
    globalThis.HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }

  if (typeof globalThis.HTMLDialogElement.prototype.close !== 'function') {
    globalThis.HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
});

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

    expect(dialog.getAttribute('aria-labelledby')).toBe('modal-title');
    expect(screen.getByText('Create a token').id).toBe('modal-title');
  });
});

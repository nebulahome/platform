/**
 * The dialog.
 *
 * The Escape case is here because it was broken in a way nothing would have caught. A modal
 * `<dialog>` is meant to dismiss itself on a close request, so the component simply listened for
 * the `close` event - and in the browser this was checked in, the keydown reached the dialog and
 * no `cancel` or `close` ever followed. The dialog stayed open, and because the component
 * believed it was already closed it could not be reopened either. Nothing in the console, and
 * every unit test still green: the bug lived in the space between a component and a browser.
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

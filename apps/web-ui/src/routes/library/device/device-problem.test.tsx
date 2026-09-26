/**
 * What is wrong with a device, in its own card: a sentence for the state, the message as it was
 * written, folded when it is long, and nothing at all for a device with nothing wrong.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DeviceProblem } from '@/routes/library/device/device-problem';
import { PRINTER } from '@/testing/printer-fixtures';

/** A database's refusal, as long as the ones that reach the interface are. */
const LONG_ERROR = `Failed query: insert into "registry"."entity_capabilities" ("entity_id", "capability", "params", "created_at") values ${[...Array(12).keys()].map((index) => `($${String(index * 3 + 1)}, $${String(index * 3 + 2)}, $${String(index * 3 + 3)}, default)`).join(', ')}`;

afterEach(() => {
  cleanup();
});

describe('DeviceProblem', () => {
  it('shows nothing for a device with nothing wrong', () => {
    const { container } = render(<DeviceProblem device={{ ...PRINTER, lastError: null }} />);

    expect(container.childElementCount).toBe(0);
  });

  it('says a device still listening is waiting, not failing', () => {
    render(
      <DeviceProblem
        device={{ ...PRINTER, state: 'identifying', lastError: 'did not answer: EHOSTUNREACH' }}
      />,
    );

    expect(screen.getByText('Waiting for the device')).toBeTruthy();
    expect(screen.getByText('did not answer: EHOSTUNREACH')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
  });

  it('folds a long message to its first lines until asked for all of it', () => {
    render(<DeviceProblem device={{ ...PRINTER, state: 'failed', lastError: LONG_ERROR }} />);

    const message = screen.getByText(LONG_ERROR);

    expect(screen.getByText('Problem')).toBeTruthy();
    expect(message.className).toContain('line-clamp-3');

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));

    expect(message.className).not.toContain('line-clamp-3');
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });
});

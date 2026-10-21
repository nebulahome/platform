/**
 * A device's firmware block: the versions, the install asked about first, and nothing to press
 * while an install is under way.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CapabilityState } from '@nebulahome/contracts';

import { UpdateControl } from '@/routes/library/entity/controls/update-control';
import type { EntityCommander } from '@/routes/library/entity/use-entity-command';
import { anEntity } from '@/testing/fixtures';

/**
 * A commander that records what it was asked.
 *
 * @returns The commander, and its `send`.
 */
function commander(): {
  readonly commander: EntityCommander;
  readonly send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();

  return {
    send,
    commander: { send, busy: new Set(), problem: null },
  };
}

/**
 * Renders the block for a firmware state.
 *
 * @param update - The state.
 * @param given - The commander the block sends through.
 * @returns The same commander, to read what was sent.
 */
function show(update: NonNullable<CapabilityState['update']>, given = commander()): typeof given {
  render(
    <UpdateControl
      entity={anEntity({
        entityId: 'update.garage_relay_firmware',
        capabilities: [{ capability: 'update', params: { canInstall: true, hasProgress: true } }],
        state: { update },
      })}
      state={{ update }}
      reportedAt={null}
      commander={given.commander}
      disabled={false}
    />,
  );

  return given;
}

describe('UpdateControl', () => {
  it('offers a newer version, and installs it only once asked and confirmed', () => {
    const { send } = show({
      installedVersion: '1.4.2',
      latestVersion: '1.5.0',
      isInstalling: false,
      progress: null,
    });

    expect(screen.getByText('1.4.2')).toBeDefined();
    expect(screen.getByText(/1\.5\.0 is available/u)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Install update' }));

    expect(send).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    expect(send).toHaveBeenCalledWith('update', { command: 'install' });
  });

  it('shows how far an install got, and offers nothing to press while it runs', () => {
    show({ installedVersion: '1.4.2', latestVersion: '1.5.0', isInstalling: true, progress: 42 });

    expect(screen.getByRole('status').textContent).toContain('42%');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
    expect(screen.queryByRole('button', { name: 'Install update' })).toBeNull();
  });

  it('says a device on the newest version is up to date', () => {
    show({ installedVersion: '1.5.0', latestVersion: null, isInstalling: false, progress: null });

    expect(screen.getByText('Up to date.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Install update' })).toBeNull();
  });
});

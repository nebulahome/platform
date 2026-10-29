/**
 * Restoring the installation from one archive.
 *
 * Says what is replaced before anything is: the users, devices, automations and settings; the
 * history, or its absence when the archive has none; the integrations. A backup of what is here
 * now is taken first unless the owner turns it off - the way back. An archive made with another
 * installation's key asks for that key's file. The password is typed again, and then the screen
 * waits for the restore (maintenance-overlay.tsx).
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BackupArchive } from '@nebulahome/contracts';
import { Button, Modal, Switch } from '@nebulahome/ui';

import { useMaintenance } from '@/auth/maintenance-store';
import { startRestore } from '@/backup/api';
import { PasswordField } from '@/components/password-field';
import { toMessage } from '@/lib/error-message';
import { formatBytes } from '@/lib/format-bytes';
import { absoluteTime } from '@/lib/format-time';
import { sectionName } from '@/routes/settings/backup-text';

/** What the dialog needs. */
export type RestoreDialogProps = {
  /** The archive, or null when closed. */
  readonly archive: BackupArchive | null;
  readonly onClose: () => void;
};

/**
 * Renders the dialog.
 *
 * @param props - See {@link RestoreDialogProps}.
 * @returns The dialog.
 */
export function RestoreDialog(props: RestoreDialogProps) {
  const { t } = useTranslation();
  const { archive, onClose } = props;
  const enter = useMaintenance((state) => state.enter);
  const [password, setPassword] = useState('');
  const [keyFile, setKeyFile] = useState<{ name: string; text: string } | null>(null);
  const [takeSafetyBackup, setSafetyBackup] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const needsKey = archive?.restorable === 'needs-key';

  const restore = useMutation({
    /**
     * Starts the restore.
     *
     * @returns The run's id.
     */
    mutationFn: async () => {
      if (archive === null) {
        throw new Error(t('backup.restoreDialog.noArchive', 'No archive is chosen'));
      }

      return startRestore({
        locationId: archive.locationId,
        archiveName: archive.name,
        password,
        takeSafetyBackup,
        ...(keyFile === null ? {} : { keyFile: keyFile.text }),
      });
    },
    /**
     * Closes, and waits for the restore on the maintenance screen.
     *
     * @param runId - The restore.
     */
    onSuccess: (runId) => {
      onClose();
      enter(runId);
    },
    /**
     * Says what went wrong.
     *
     * @param error - The failure.
     */
    onError: (error) => {
      setProblem(toMessage(error));
    },
  });

  if (archive === null) {
    return null;
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="small"
      closesOnBackdrop={false}
      title={t('backup.restoreDialog.title', 'Restore this backup')}
      description={`${absoluteTime(archive.createdAt)} · ${archive.locationName} · ${formatBytes(archive.bytes)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="danger"
            isBusy={restore.isPending}
            disabled={password === '' || (needsKey && keyFile === null)}
            onClick={() => {
              setProblem(null);
              restore.mutate();
            }}
          >
            {t('backup.restore', 'Restore')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 text-ui text-foreground-muted">
          <p>
            {t(
              'backup.restoreDialog.replaced',
              'What is here now is replaced by what the backup holds:',
            )}
          </p>
          <ul className="list-disc pl-5">
            <li>
              {t(
                'backup.restoreDialog.configuration',
                'the users and their roles, the devices, the automations and the settings;',
              )}
            </li>
            <li>
              {archive.sections.includes('history')
                ? t('backup.restoreDialog.history', 'the history;')
                : t(
                    'backup.restoreDialog.noHistory',
                    'the history is emptied: this backup was taken without it;',
                  )}
            </li>
            <li>
              {archive.sections.includes('packages')
                ? t(
                    'backup.restoreDialog.integrationsAndPackages',
                    'the installed integrations and the packages;',
                  )
                : t('backup.restoreDialog.integrations', 'the installed integrations;')}
            </li>
            <li>
              {archive.sections.includes('containers')
                ? t('backup.restoreDialog.containers', 'the folders and volumes of the containers.')
                : t(
                    'backup.restoreDialog.noContainers',
                    'the containers keep what they have now: this backup was taken without them.',
                  )}
            </li>
          </ul>
          <p>
            {t(
              'backup.restoreDialog.locationsStay',
              'The backup locations and their settings stay as they are here. Everybody signs in again afterwards.',
            )}
          </p>
          <p className="text-caption text-foreground-subtle">
            {t('backup.restoreDialog.holds', 'Holds: {{sections}}', {
              sections: archive.sections.map((section) => sectionName(section)).join(', '),
            })}
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-ui text-foreground">
              {t('backup.restoreDialog.safety', 'Back up what is here first')}
            </span>
            <span className="text-caption text-foreground-subtle">
              {t(
                'backup.restoreDialog.safetyNote',
                'The way back, if this is not what you wanted.',
              )}
            </span>
          </div>
          <Switch
            label={t('backup.restoreDialog.safety', 'Back up what is here first')}
            isOn={takeSafetyBackup}
            onChange={setSafetyBackup}
          />
        </div>

        {needsKey ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-ui font-medium text-foreground">
              {t('backup.key.title', 'Backup key')}
            </span>
            <span className="text-caption text-foreground-subtle">
              {t(
                'backup.restoreDialog.otherKey',
                'This backup was made with another installation’s key: choose the key file downloaded from it.',
              )}
            </span>
            <input
              type="file"
              accept="application/json,.json"
              className="text-ui text-foreground-muted file:mr-3 file:rounded-chip file:border file:border-border file:bg-surface file:px-3 file:py-1 file:text-foreground"
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (file === undefined) {
                  setKeyFile(null);

                  return;
                }

                void file.text().then((text) => {
                  setKeyFile({ name: file.name, text });
                });
              }}
            />
          </label>
        ) : null}

        <PasswordField
          label={t('backup.key.password', 'Your password')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          hasRules={false}
          size="medium"
        />

        {problem === null ? null : (
          <p role="alert" className="text-ui break-words text-danger">
            {problem}
          </p>
        )}
      </div>
    </Modal>
  );
}

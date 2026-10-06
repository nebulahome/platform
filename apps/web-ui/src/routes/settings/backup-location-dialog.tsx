/**
 * Adding a backup location, or changing one.
 *
 * Adding, the kinds are a card of their own beside the form - a folder on this machine, an SMB
 * share, an FTP server, an NFS export - and the form is the chosen kind's. A kind the container
 * cannot use (a share that cannot be mounted) is listed, disabled, with the reason. The system
 * location takes only whether it is on and what it keeps.
 *
 * "Try it" asks the backup service to connect, write a file and remove it, and says what it found
 * - before anything is saved, or after, without typing the password again.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import {
  type FTP_SECURITY_MODES,
  NFS_VERSIONS,
  SMB_VERSIONS,
  type BackupFrequency,
  type BackupLocationView,
  type BackupLocationTestResult,
  type BackupTargetInput,
} from '@nebulahome/contracts';
import { Button, cn, Modal, Segmented, SelectField, Switch, TextField } from '@nebulahome/ui';

import {
  BACKUP_QUERY_KEYS,
  createBackupLocation,
  deleteBackupLocation,
  testBackupLocation,
  updateBackupLocation,
} from '@/backup/api';
import { retentionSummary } from '@/backup/estimates';
import { toMessage } from '@/lib/error-message';
import { formatBytes } from '@/lib/format-bytes';
import { KIND_NAMES } from '@/routes/settings/backup-text';
import { FolderBrowserDialog } from '@/routes/settings/folder-browser-dialog';

/** The kinds the owner adds. */
type UserKind = 'local' | 'smb' | 'ftp' | 'nfs';

/** Each kind, with a line saying what it is. */
const KINDS: readonly { readonly kind: UserKind; readonly note: string }[] = [
  { kind: 'local', note: 'A disk or folder of this machine' },
  { kind: 'smb', note: 'A Windows or NAS share (SMB/CIFS)' },
  { kind: 'ftp', note: 'An FTP server, plain or over TLS' },
  { kind: 'nfs', note: 'An NFS export of a NAS or a server' },
];

/** Everything the form holds, for every kind: only the chosen kind's fields are sent. */
type Form = {
  name: string;
  kind: UserKind;
  path: string;
  host: string;
  share: string;
  exportPath: string;
  username: string;
  password: string;
  domain: string;
  smbVersion: (typeof SMB_VERSIONS)[number];
  nfsVersion: (typeof NFS_VERSIONS)[number];
  port: string;
  security: (typeof FTP_SECURITY_MODES)[number];
  allowSelfSigned: boolean;
  retentionMode: 'count' | 'days';
  retentionValue: string;
  isEnabled: boolean;
};

/**
 * The form for a location, or for a new one.
 *
 * @param location - The location, when there is one.
 * @returns The form.
 */
function formOf(location: BackupLocationView | null): Form {
  const target = location?.target;
  const blank: Form = {
    name: '',
    kind: 'local',
    path: '',
    host: '',
    share: '',
    exportPath: '',
    username: '',
    password: '',
    domain: '',
    smbVersion: 'auto',
    nfsVersion: 'auto',
    port: '',
    security: 'explicit',
    allowSelfSigned: false,
    retentionMode: location?.retention.mode ?? 'count',
    retentionValue: String(location?.retention.value ?? 7),
    isEnabled: location?.isEnabled ?? true,
  };

  if (location === null || target === undefined || target.kind === 'system') {
    return { ...blank, name: location?.name ?? '' };
  }

  switch (target.kind) {
    case 'local':
      return { ...blank, name: location.name, kind: 'local', path: target.path };
    case 'smb':
      return {
        ...blank,
        name: location.name,
        kind: 'smb',
        host: target.host,
        share: target.share,
        path: target.path,
        username: target.username,
        domain: target.domain,
        smbVersion: target.version,
      };
    case 'ftp':
      return {
        ...blank,
        name: location.name,
        kind: 'ftp',
        host: target.host,
        port: target.port === null ? '' : String(target.port),
        security: target.security,
        allowSelfSigned: target.allowSelfSigned,
        path: target.path,
        username: target.username,
      };
    case 'nfs':
      return {
        ...blank,
        name: location.name,
        kind: 'nfs',
        host: target.host,
        exportPath: target.export,
        path: target.path,
        nfsVersion: target.version,
      };
  }
}

/**
 * The target the form describes. A password left empty is left out: a saved one is kept.
 *
 * @param form - The form.
 * @returns The target.
 */
function targetOf(form: Form): BackupTargetInput {
  const password = form.password === '' ? {} : { password: form.password };

  switch (form.kind) {
    case 'local':
      return { kind: 'local', path: form.path.trim() };
    case 'smb':
      return {
        kind: 'smb',
        host: form.host.trim(),
        share: form.share.trim(),
        path: form.path.trim(),
        username: form.username,
        domain: form.domain.trim(),
        version: form.smbVersion,
        ...password,
      };
    case 'ftp':
      return {
        kind: 'ftp',
        host: form.host.trim(),
        port: form.port.trim() === '' ? null : Number(form.port),
        security: form.security,
        allowSelfSigned: form.allowSelfSigned,
        path: form.path.trim(),
        username: form.username,
        ...password,
      };
    case 'nfs':
      return {
        kind: 'nfs',
        host: form.host.trim(),
        export: form.exportPath.trim(),
        path: form.path.trim(),
        version: form.nfsVersion,
      };
  }
}

/** What the dialog needs. */
export type BackupLocationDialogProps = {
  readonly isOpen: boolean;

  /** The location being changed, or null for a new one. */
  readonly location: BackupLocationView | null;

  /** How often backups run, for the retention's estimate. */
  readonly frequency: BackupFrequency;

  /** How large an archive is expected to be. */
  readonly archiveBytes: number | null;

  /** Why shares cannot be mounted here, when they cannot. */
  readonly mountProblem: string | null;
  readonly onClose: () => void;
};

/**
 * Renders the dialog.
 *
 * @param props - See {@link BackupLocationDialogProps}.
 * @returns The dialog.
 */
export function BackupLocationDialog(props: BackupLocationDialogProps) {
  const { isOpen, location, frequency, archiveBytes, mountProblem, onClose } = props;
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => formOf(location));
  const [isBrowsing, setBrowsing] = useState(false);
  const [trial, setTrial] = useState<BackupLocationTestResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [isRemoving, setRemoving] = useState(false);
  const isSystem = location?.target.kind === 'system';
  const isNew = location === null;
  const retentionValue = Number(form.retentionValue);
  const isRetentionValid =
    Number.isInteger(retentionValue) && retentionValue >= 1 && retentionValue <= 3650;

  /**
   * Changes some fields, and forgets a trial that no longer describes them.
   *
   * @param change - The fields.
   */
  const update = (change: Partial<Form>): void => {
    setForm((current) => ({ ...current, ...change }));
    setTrial(null);
    setProblem(null);
  };

  /** Invalidates what the page shows of the locations. */
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: BACKUP_QUERY_KEYS.locations });
    await queryClient.invalidateQueries({ queryKey: BACKUP_QUERY_KEYS.status });
  };

  const tryIt = useMutation({
    /**
     * Asks the backup service to try the location.
     *
     * @returns What it found.
     */
    mutationFn: async () =>
      testBackupLocation({
        target: targetOf(form),
        ...(isNew || isSystem ? {} : { locationId: location.id }),
      }),
    onSuccess: setTrial,
    /**
     * Says what went wrong.
     *
     * @param error - The failure.
     */
    onError: (error) => {
      setProblem(toMessage(error));
    },
  });

  const save = useMutation({
    /**
     * Adds the location, or saves the change.
     *
     * @returns The location.
     */
    mutationFn: async () => {
      const retention = { mode: form.retentionMode, value: retentionValue };

      if (isNew) {
        return createBackupLocation({
          name: form.name.trim(),
          target: targetOf(form),
          isEnabled: form.isEnabled,
          retention,
        });
      }

      return updateBackupLocation(
        location.id,
        isSystem
          ? { isEnabled: form.isEnabled, retention }
          : {
              name: form.name.trim(),
              target: targetOf(form),
              isEnabled: form.isEnabled,
              retention,
            },
      );
    },
    /**
     * Shows what changed.
     *
     * @returns Once the page has read it again.
     */
    onSuccess: async () => {
      await refresh();
      onClose();
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

  const remove = useMutation({
    /**
     * Removes the location.
     *
     * @returns Once it is gone.
     */
    mutationFn: async () => {
      if (location !== null) {
        await deleteBackupLocation(location.id);
      }
    },
    /**
     * Shows what changed.
     *
     * @returns Once the page has read it again.
     */
    onSuccess: async () => {
      await refresh();
      onClose();
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

  /**
   * A text field bound to one of the form's fields.
   *
   * @param key - The field.
   * @param label - Its label.
   * @param options - Its type, placeholder and hint.
   * @param options.type - The input's type.
   * @param options.placeholder - What the empty field shows.
   * @param options.hint - A line under it.
   * @returns The field.
   */
  const field = (
    key:
      | 'name'
      | 'path'
      | 'host'
      | 'share'
      | 'exportPath'
      | 'username'
      | 'password'
      | 'domain'
      | 'port',
    label: string,
    options: { type?: string; placeholder?: string; hint?: ReactNode } = {},
  ): ReactNode => (
    <TextField
      label={label}
      size="medium"
      value={form[key]}
      type={options.type ?? 'text'}
      placeholder={options.placeholder}
      hint={options.hint}
      autoComplete={key === 'password' ? 'new-password' : 'off'}
      onChange={(event) => {
        update({ [key]: event.target.value });
      }}
    />
  );

  const hasSavedPassword =
    location !== null && 'hasPassword' in location.target && location.target.hasPassword;
  const passwordHint = hasSavedPassword ? 'Leave empty to keep the saved one.' : undefined;

  const kindFields: Record<UserKind, ReactNode> = {
    local: (
      <div className="flex items-end gap-2">
        <div className="grow">{field('path', 'Folder', { placeholder: '/mnt/usb/backups' })}</div>
        <Button
          variant="ghost"
          onClick={() => {
            setBrowsing(true);
          }}
        >
          Browse…
        </Button>
      </div>
    ),
    smb: (
      <>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('host', 'Server', { placeholder: 'nas.local' })}
          {field('share', 'Share', { placeholder: 'backups' })}
        </div>
        {field('path', 'Folder in the share', { placeholder: 'nebulahome' })}
        <div className="grid gap-3 sm:grid-cols-2">
          {field('username', 'User')}
          {field('password', 'Password', { type: 'password', hint: passwordHint })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('domain', 'Domain', { placeholder: 'Optional' })}
          <SelectField
            label="SMB version"
            size="medium"
            value={form.smbVersion}
            options={SMB_VERSIONS.map((version) => ({
              value: version,
              label: version === 'auto' ? 'Agree with the server' : `SMB ${version}`,
            }))}
            onChange={(value) => {
              update({ smbVersion: value as Form['smbVersion'] });
            }}
          />
        </div>
      </>
    ),
    ftp: (
      <>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
          {field('host', 'Server', { placeholder: 'ftp.example.org' })}
          {field('port', 'Port', {
            type: 'number',
            placeholder: form.security === 'implicit' ? '990' : '21',
          })}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-ui font-medium text-foreground">Security</span>
          <Segmented
            label="Security"
            value={form.security}
            options={[
              { value: 'explicit', label: 'TLS (FTPS)' },
              { value: 'implicit', label: 'Implicit TLS' },
              { value: 'none', label: 'None' },
            ]}
            onChange={(value) => {
              update({ security: value });
            }}
          />
        </div>
        {form.security === 'none' ? null : (
          <div className="flex items-center justify-between gap-4">
            <span className="text-ui text-foreground">Accept a self-signed certificate</span>
            <Switch
              label="Accept a self-signed certificate"
              isOn={form.allowSelfSigned}
              onChange={(isOn) => {
                update({ allowSelfSigned: isOn });
              }}
            />
          </div>
        )}
        {field('path', 'Folder on the server', { placeholder: 'backups/nebulahome' })}
        <div className="grid gap-3 sm:grid-cols-2">
          {field('username', 'User')}
          {field('password', 'Password', { type: 'password', hint: passwordHint })}
        </div>
      </>
    ),
    nfs: (
      <>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('host', 'Server', { placeholder: '192.168.1.10' })}
          {field('exportPath', 'Export', { placeholder: '/volume1/backups' })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('path', 'Folder in the export', { placeholder: 'nebulahome' })}
          <SelectField
            label="NFS version"
            size="medium"
            value={form.nfsVersion}
            options={NFS_VERSIONS.map((version) => ({
              value: version,
              label: version === 'auto' ? 'Agree with the server' : `NFS ${version}`,
            }))}
            onChange={(value) => {
              update({ nfsVersion: value as Form['nfsVersion'] });
            }}
          />
        </div>
      </>
    ),
  };

  const isMountKind = form.kind === 'smb' || form.kind === 'nfs';

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="medium"
        closesOnBackdrop={false}
        title={
          isNew ? 'Add a backup location' : isSystem ? 'This machine' : `Change ${location.name}`
        }
        description={
          isSystem
            ? 'The backups folder of the data directory. It is always here; it can be turned off.'
            : 'Every backup is written here too, and older ones removed as the retention says.'
        }
        {...(isNew
          ? {
              asideLabel: 'Kinds of location',
              aside: (
                <ul className="flex flex-col gap-1 p-2">
                  {KINDS.map(({ kind, note }) => {
                    const isUnavailable =
                      (kind === 'smb' || kind === 'nfs') && mountProblem !== null;

                    return (
                      <li key={kind}>
                        <button
                          type="button"
                          aria-pressed={form.kind === kind}
                          className={cn(
                            'flex w-full flex-col items-start gap-0.5 rounded-field px-3 py-2 text-left transition-colors',
                            form.kind === kind
                              ? 'bg-surface-high text-foreground'
                              : 'text-foreground-muted hover:bg-surface-raised',
                          )}
                          onClick={() => {
                            update({ kind });
                          }}
                        >
                          <span className="text-ui font-medium">{KIND_NAMES[kind]}</span>
                          <span className="text-caption text-foreground-subtle">
                            {isUnavailable ? mountProblem : note}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ),
            }
          : {})}
        footer={
          <>
            {isNew || isSystem ? null : (
              <Button
                variant="danger"
                className="mr-auto"
                isBusy={remove.isPending}
                onClick={() => {
                  if (isRemoving) {
                    remove.mutate();
                  } else {
                    setRemoving(true);
                  }
                }}
              >
                {isRemoving ? 'Remove it: the archives there stay' : 'Remove'}
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              isBusy={save.isPending}
              disabled={!isRetentionValid || (!isSystem && form.name.trim() === '')}
              onClick={() => {
                save.mutate();
              }}
            >
              {isNew ? 'Add' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {isSystem ? null : (
            <>
              {field('name', 'Name', {
                placeholder: KIND_NAMES[form.kind] === 'Folder' ? 'USB disk' : 'NAS',
              })}
              {kindFields[form.kind]}
              {isMountKind && mountProblem !== null ? (
                <p className="text-caption text-warning">{mountProblem}</p>
              ) : null}
            </>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-ui font-medium text-foreground">Keep</span>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                label="Keep backups by"
                value={form.retentionMode}
                options={[
                  { value: 'count', label: 'The last' },
                  { value: 'days', label: 'The last days' },
                ]}
                onChange={(value) => {
                  update({ retentionMode: value });
                }}
              />
              <TextField
                label={form.retentionMode === 'count' ? 'Backups' : 'Days'}
                isLabelHidden
                size="medium"
                type="number"
                min={1}
                max={3650}
                className="w-24"
                value={form.retentionValue}
                onChange={(event) => {
                  update({ retentionValue: event.target.value });
                }}
              />
              <span className="text-ui text-foreground-muted">
                {form.retentionMode === 'count' ? 'backups' : 'days'}
              </span>
            </div>
            <span className="text-caption text-foreground-subtle">
              {isRetentionValid
                ? `${retentionSummary(
                    { mode: form.retentionMode, value: retentionValue },
                    frequency,
                    archiveBytes,
                  )} (estimate)`
                : 'From 1 to 3650.'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-ui text-foreground">Write backups here</span>
            <Switch
              label="Write backups here"
              isOn={form.isEnabled}
              onChange={(isOn) => {
                update({ isEnabled: isOn });
              }}
            />
          </div>

          {isSystem ? null : (
            <div className="flex flex-col gap-2 rounded-field border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-ui text-foreground-muted">
                  Connects, writes a small file and removes it.
                </span>
                <Button
                  variant="ghost"
                  size="compact"
                  isBusy={tryIt.isPending}
                  onClick={() => {
                    setProblem(null);
                    tryIt.mutate();
                  }}
                >
                  Try it
                </Button>
              </div>
              {trial === null ? null : trial.isReachable ? (
                <p className="text-ui text-success">
                  It works
                  {trial.freeBytes === null ? '' : ` · ${formatBytes(trial.freeBytes)} free`}
                  {trial.archiveCount === null || trial.archiveCount === 0
                    ? ''
                    : ` · ${String(trial.archiveCount)} backups there already`}
                </p>
              ) : (
                <p role="alert" className="text-ui break-words text-danger">
                  {trial.message ?? 'It does not work.'}
                </p>
              )}
            </div>
          )}

          {location?.lastError == null ? null : (
            <div className="flex flex-col gap-1 rounded-field border border-border bg-surface-raised p-3">
              <span className="text-caption font-medium text-foreground-muted">
                The last backup here failed
              </span>
              <p className="text-ui break-words whitespace-pre-wrap text-danger">
                {location.lastError}
              </p>
            </div>
          )}

          {problem === null ? null : (
            <p role="alert" className="text-ui break-words text-danger">
              {problem}
            </p>
          )}
        </div>
      </Modal>

      <FolderBrowserDialog
        isOpen={isBrowsing}
        start={form.path === '' ? '/mnt' : form.path}
        onClose={() => {
          setBrowsing(false);
        }}
        onChoose={(path) => {
          update({ path });
          setBrowsing(false);
        }}
      />
    </>
  );
}

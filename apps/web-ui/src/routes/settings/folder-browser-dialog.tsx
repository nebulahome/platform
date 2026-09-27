/**
 * Choosing a folder of the machine the platform runs on, for a local backup location.
 *
 * The folders are the backup service's to list - it is what writes there, and in the container
 * its file system is not the browser's - so each step asks it. A folder that cannot hold backups
 * - inside the data directory, a system folder, one it may not write - can be opened but not
 * chosen, and says why.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Button, Modal } from '@nebula-home/ui';

import { browseFolders } from '@/backup/api';
import { toMessage } from '@/lib/error-message';

/** What the dialog needs. */
export type FolderBrowserDialogProps = {
  readonly isOpen: boolean;

  /** Where it opens: the folder already chosen, or the usual place disks are mounted. */
  readonly start: string;
  readonly onClose: () => void;

  /** Called with the folder chosen. */
  readonly onChoose: (path: string) => void;
};

/**
 * Renders the dialog.
 *
 * @param props - See {@link FolderBrowserDialogProps}.
 * @returns The dialog.
 */
export function FolderBrowserDialog(props: FolderBrowserDialogProps) {
  const { isOpen, start, onClose, onChoose } = props;
  const [path, setPath] = useState(start);
  const folder = useQuery({
    queryKey: ['backup', 'browse', path],
    enabled: isOpen,
    retry: false,

    /**
     * Lists the folder.
     *
     * @returns Its folders.
     */
    queryFn: async () => browseFolders(path),
  });
  const segments = path.split('/').filter(Boolean);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="small"
      title="Choose a folder"
      description="On the machine NebulaHome runs on. In the container, a disk of the host appears once it is mounted into it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={folder.data?.isWritable !== true}
            onClick={() => {
              onChoose(path);
            }}
          >
            Use this folder
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <nav aria-label="Where" className="flex flex-wrap items-center gap-1 text-ui">
          <button
            type="button"
            className="rounded-chip px-1.5 text-foreground-muted hover:text-foreground"
            onClick={() => {
              setPath('/');
            }}
          >
            /
          </button>
          {segments.map((segment, index) => (
            <span key={segments.slice(0, index + 1).join('/')} className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-chip px-1.5 text-foreground-muted hover:text-foreground"
                onClick={() => {
                  setPath(`/${segments.slice(0, index + 1).join('/')}`);
                }}
              >
                {segment}
              </button>
              {index < segments.length - 1 ? (
                <span className="text-foreground-subtle">/</span>
              ) : null}
            </span>
          ))}
        </nav>

        <div className="max-h-72 overflow-auto rounded-field border border-border-soft">
          {folder.isPending ? (
            <p className="px-3 py-3 text-ui text-foreground-subtle">Reading the folder…</p>
          ) : folder.isError ? (
            <p role="alert" className="px-3 py-3 text-ui text-danger">
              {toMessage(folder.error)}
            </p>
          ) : folder.data.directories.length === 0 ? (
            <p className="px-3 py-3 text-ui text-foreground-subtle">No folders in here.</p>
          ) : (
            <ul className="divide-y divide-border-soft">
              {folder.data.directories.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-ui text-foreground hover:bg-surface-lit"
                    onClick={() => {
                      setPath(`${path === '/' ? '' : path}/${name}`);
                    }}
                  >
                    <span aria-hidden="true" className="text-foreground-subtle">
                      ▸
                    </span>
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {folder.data === undefined || folder.data.isWritable ? null : (
          <p className="text-caption text-foreground-subtle">
            Backups cannot be written here: choose a folder on a disk of your own, outside the data
            directory and the system’s folders.
          </p>
        )}
        {folder.data?.isTruncated === true ? (
          <p className="text-caption text-foreground-subtle">
            Only the first 500 folders are listed.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

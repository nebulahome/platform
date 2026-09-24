/**
 * Making a dashboard, or changing one: its name and icon, its file, and removing it.
 *
 * A new dashboard is either named here or read from a file another dashboard was exported to. A
 * file is read in the browser first, so one that is not a dashboard is refused in words before
 * anything is sent, and one that is shows what it brings - its name, its cards, and how many of
 * them name entities or scenes this house does not have, which will say so on their cards.
 *
 * An existing dashboard can be renamed, given an icon, exported as a file, or removed.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  dashboardFileName,
  type DashboardDocument,
  type DashboardView,
} from '@nebula-home/contracts';
import { AppIcon, Button, Modal } from '@nebula-home/ui';

import {
  createDashboard,
  DASHBOARD_QUERY_KEYS,
  deleteDashboard,
  exportDashboard,
  importDashboard,
  updateDashboard,
} from '@/dashboard/api';
import {
  readDashboardFile,
  saveDashboardFile,
  summariseDashboardFile,
} from '@/dashboard/dashboard-file';
import { allCards } from '@/dashboard/dashboard-layout';
import { toMessage } from '@/lib/error-message';
import { ConfirmRemoval } from '@/routes/library/confirm-removal';
import { NameIconField } from '@/routes/library/name-icon-field';

/** What the dialog is for: a new dashboard, or one that exists. */
export type DashboardDialogTarget =
  { readonly mode: 'create' } | { readonly mode: 'edit'; readonly dashboard: DashboardView };

/** What the dialog needs. */
export type DashboardDialogProps = {
  /** What it is for; null while it is shut. */
  readonly target: DashboardDialogTarget | null;
  readonly onClose: () => void;

  /** Whether this house has an entity at an address, for a file's preview. */
  readonly hasEntity: (entityId: string) => boolean;

  /** Whether this house has a scene with an id, for a file's preview. */
  readonly hasScene: (sceneId: string) => boolean;

  /** Told of a dashboard made or changed, once the list has it. */
  readonly onSaved: (dashboard: DashboardView) => void;

  /** Told of a dashboard removed, once the list has let go of it. */
  readonly onDeleted: (dashboardId: string) => void;
};

/**
 * Renders the dialog.
 *
 * Mounted afresh for every opening - the page keys it - so it starts from the dashboard as it is.
 *
 * @param props - See {@link DashboardDialogProps}.
 * @returns The dialog.
 */
export function DashboardDialog(props: DashboardDialogProps) {
  const { target, onClose, hasEntity, hasScene, onSaved, onDeleted } = props;
  const queryClient = useQueryClient();
  const existing = target?.mode === 'edit' ? target.dashboard : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState<string | null>(existing?.icon ?? null);
  const [file, setFile] = useState<DashboardDocument | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [isConfirming, setConfirming] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Reads the list again. */
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.dashboards });
  };

  const save = useMutation({
    /**
     * Makes the dashboard, imports the file, or sends what changed.
     *
     * @returns The dashboard as it now stands.
     */
    mutationFn: async (): Promise<DashboardView> => {
      if (file !== null) {
        return importDashboard({
          ...file,
          name: name.trim() === '' ? file.name : name.trim(),
          icon,
        });
      }

      if (existing === undefined) {
        return createDashboard({ name: name.trim(), icon });
      }

      return updateDashboard(existing.id, { name: name.trim(), icon });
    },

    /**
     * Hands the dashboard back once the list has it.
     *
     * @param saved - The dashboard.
     */
    onSuccess: async (saved) => {
      await refresh();
      onSaved(saved);
    },

    /**
     * Says why it could not be saved.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setProblem(toMessage(error));
    },
  });

  const removing = useMutation({
    /** Removes the dashboard. */
    mutationFn: async (): Promise<void> => {
      if (existing !== undefined) {
        await deleteDashboard(existing.id);
      }
    },

    /** Tells the page once the list has let go of it. */
    onSuccess: async () => {
      await refresh();

      if (existing !== undefined) {
        onDeleted(existing.id);
      }
    },

    /**
     * Says why it could not be removed.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setConfirming(false);
      setProblem(toMessage(error));
    },
  });

  const exporting = useMutation({
    /**
     * Reads the dashboard out in the file standard and hands it over to be saved.
     *
     * @returns Nothing; the browser saves the file.
     */
    mutationFn: async (): Promise<void> => {
      if (existing !== undefined) {
        saveDashboardFile(await exportDashboard(existing.id), dashboardFileName(existing.name));
      }
    },

    /**
     * Says why it could not be exported.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setProblem(toMessage(error));
    },
  });

  /**
   * Reads a chosen file.
   *
   * @param chosen - The file.
   */
  const readFile = async (chosen: File): Promise<void> => {
    const reading = readDashboardFile(await chosen.text());

    if (!reading.ok) {
      setFile(null);
      setProblem(reading.problem);

      return;
    }

    setProblem(null);
    setFile(reading.document);
    setName(reading.document.name);
    setIcon(reading.document.icon);
  };

  /** Saves, unless the name is blank. */
  const submit = (): void => {
    if (name.trim() === '' && file === null) {
      setProblem('The name cannot be blank.');

      return;
    }

    setProblem(null);
    save.mutate();
  };

  const isBusy = save.isPending || removing.isPending;
  const summary = file === null ? null : summariseDashboardFile(file, hasEntity, hasScene);
  const missing = summary === null ? 0 : summary.missingEntities + summary.missingScenes;

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      closesOnBackdrop={false}
      title={existing === undefined ? 'New dashboard' : 'Dashboard'}
      description={
        existing === undefined
          ? 'Your own page of cards. Nobody else sees it.'
          : 'Its name and icon, its file, and removing it.'
      }
      footer={
        isConfirming && existing !== undefined ? (
          <ConfirmRemoval
            question={`Remove ${existing.name} and its ${String(allCards(existing.layout).length)} cards?`}
            isBusy={removing.isPending}
            onCancel={() => {
              setConfirming(false);
            }}
            onConfirm={() => {
              removing.mutate();
            }}
          />
        ) : (
          <>
            {existing === undefined ? null : (
              <Button
                variant="danger"
                disabled={isBusy}
                className="mr-auto"
                onClick={() => {
                  setProblem(null);
                  setConfirming(true);
                }}
              >
                Remove
              </Button>
            )}
            <Button variant="ghost" disabled={isBusy} onClick={onClose}>
              Cancel
            </Button>
            <Button isBusy={save.isPending} disabled={removing.isPending} onClick={submit}>
              {existing !== undefined ? 'Save' : file === null ? 'Create' : 'Import'}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <NameIconField
          value={name}
          required
          onChange={setName}
          icon={icon}
          onIconChange={(view) => {
            setIcon(view.id);
          }}
        />

        {existing === undefined ? (
          <div className="flex flex-col gap-2.5 rounded-panel border border-dashed border-border-strong p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui font-medium">Start from a file</span>
                <span className="text-caption text-foreground-subtle">
                  A dashboard exported from here or from another house.
                </span>
              </span>
              <Button
                variant="ghost"
                size="compact"
                className="shrink-0 whitespace-nowrap"
                disabled={isBusy}
                onClick={() => fileInput.current?.click()}
              >
                <AppIcon id="upload" size={14} />
                Choose a file
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  const chosen = event.target.files?.[0];

                  event.target.value = '';

                  if (chosen !== undefined) {
                    void readFile(chosen);
                  }
                }}
              />
            </div>
            {summary === null ? null : (
              <p role="status" className="text-caption text-foreground-muted">
                {summary.cards} {summary.cards === 1 ? 'card' : 'cards'}
                {missing === 0
                  ? ', all of them for things this house has.'
                  : `; ${String(missing)} of them name things this house does not have, and will say so.`}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-panel border border-border p-3.5">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-ui font-medium">Export as a file</span>
              <span className="truncate text-caption text-foreground-subtle">
                {dashboardFileName(existing.name)}, to keep or to import elsewhere.
              </span>
            </span>
            <Button
              variant="ghost"
              size="compact"
              isBusy={exporting.isPending}
              disabled={isBusy}
              onClick={() => {
                setProblem(null);
                exporting.mutate();
              }}
            >
              <AppIcon id="download" size={14} />
              Export
            </Button>
          </div>
        )}

        {problem === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {problem}
          </p>
        )}
      </div>
    </Modal>
  );
}

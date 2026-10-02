/**
 * Making the house, or changing it: what to call it, and where it stands.
 *
 * There is one house, and it is drawn as a house: the catalogue's `house`, always, so the
 * dialog asks for a name and a place and nothing about its look. Where it stands
 * is set two ways that agree with each other: a click on the map fills the two coordinate
 * boxes, and what is typed in the boxes moves the mark on the map. The boxes are there because
 * a person may know their coordinates better than the map knows their street, and because a
 * map is nothing to a screen reader.
 *
 * Only what changed is sent, and the page is told whether the house moved: that is what decides
 * whether the map around it is fetched onto disk again.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { AreaUpdate, AreaView } from '@nebulahome/contracts';
import { Button, Modal, TextField } from '@nebulahome/ui';

import { describeRemoval, type RemovalImpact } from '@/lib/area-tree';
import { toMessage } from '@/lib/error-message';
import { parsePosition, positionText, type HousePosition } from '@/lib/house-position';
import { createArea, deleteArea, LIBRARY_QUERY_KEYS, updateArea } from '@/library/api';
import { ConfirmRemoval } from '@/routes/library/confirm-removal';
import { HouseMap } from '@/routes/library/house-map';
import { HOUSE_ICON } from '@/routes/library/house-panel';

/** What the dialog is for: the house to be made, or the one that exists. */
export type HouseDialogTarget =
  { readonly mode: 'create' } | { readonly mode: 'edit'; readonly house: AreaView };

/** What the dialog needs. */
export type HouseDialogProps = {
  /** What it is for, or null while it is shut. */
  readonly target: HouseDialogTarget | null;

  /** What removing the house would take with it; only read for one that exists. */
  readonly removal: RemovalImpact;

  /** Called when the dialog should shut, saved or not. */
  readonly onClose: () => void;

  /** Called with the house as the server now has it, and whether it now stands somewhere new. */
  readonly onSaved: (house: AreaView, isMoved: boolean) => void;

  /** Called with the id of the house once it is gone. */
  readonly onDeleted: (id: string) => void;
};

/**
 * Whether a position differs from where the house stood.
 *
 * @param position - Where it stands now, or nowhere.
 * @param house - The house as it was.
 * @returns True when the position changed.
 */
function isMovedFrom(position: HousePosition | null, house: AreaView | undefined): boolean {
  const before =
    house?.latitude === undefined || house.latitude === null || house.longitude === null
      ? null
      : { latitude: house.latitude, longitude: house.longitude };

  if (position === null || before === null) {
    return position !== before;
  }

  return position.latitude !== before.latitude || position.longitude !== before.longitude;
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link HouseDialogProps}.
 * @returns The dialog.
 */
export function HouseDialog(props: HouseDialogProps) {
  const { target, removal, onClose, onSaved, onDeleted } = props;
  const queryClient = useQueryClient();
  const existing = target?.mode === 'edit' ? target.house : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [latitudeText, setLatitudeText] = useState(positionText(existing?.latitude ?? null));
  const [longitudeText, setLongitudeText] = useState(positionText(existing?.longitude ?? null));
  const [isConfirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // What the map shows: the boxes as far as they make a position. A half-typed box shows the
  // last whole position rather than nothing, so the mark does not jump while somebody types.
  const parsed = parsePosition(latitudeText, longitudeText);
  const shown = 'position' in parsed ? parsed.position : null;

  /** Reads everything that shows areas again. */
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.areas }),
      queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices }),
      queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities }),
    ]);
  };

  const save = useMutation({
    /**
     * Makes the house, or sends what changed on it.
     *
     * @param position - Where it stands, or nowhere.
     * @returns The house as it now stands, and whether it moved.
     */
    mutationFn: async (
      position: HousePosition | null,
    ): Promise<{ house: AreaView; isMoved: boolean }> => {
      const trimmed = name.trim();
      const isMoved = isMovedFrom(position, existing);

      if (existing === undefined) {
        const house = await createArea({
          kind: 'house',
          name: trimmed,
          icon: HOUSE_ICON,
          ...(position ?? {}),
        });

        return { house, isMoved: position !== null };
      }

      const change: AreaUpdate = {
        ...(trimmed === existing.name ? {} : { name: trimmed }),
        ...(isMoved ? (position ?? { latitude: null, longitude: null }) : {}),
      };
      const house =
        Object.keys(change).length === 0 ? existing : await updateArea(existing.id, change);

      return { house, isMoved };
    },

    /**
     * Hands the house back once every list has it.
     *
     * @param saved - The house as the server has it, and whether it moved.
     */
    onSuccess: async (saved) => {
      await refresh();
      onSaved(saved.house, saved.isMoved);
    },

    /**
     * Shows why the save failed.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setProblem(toMessage(error));
    },
  });

  const removing = useMutation({
    /** Removes the house, and everything in it. */
    mutationFn: async (): Promise<void> => {
      if (existing !== undefined) {
        await deleteArea(existing.id);
      }
    },

    /** Tells the page once every list has let go of it. */
    onSuccess: async () => {
      await refresh();

      if (existing !== undefined) {
        onDeleted(existing.id);
      }
    },

    /**
     * Shows why the removal failed.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setConfirming(false);
      setProblem(toMessage(error));
    },
  });

  const isBusy = save.isPending || removing.isPending;

  /** Saves, unless the name is blank or the position is half there. */
  const submit = (): void => {
    if (name.trim() === '') {
      setProblem('The name cannot be blank.');

      return;
    }

    if ('problem' in parsed) {
      setProblem(parsed.problem);

      return;
    }

    setProblem(null);
    save.mutate(parsed.position);
  };

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      title={existing === undefined ? 'Your house' : `Configure ${existing.name}`}
      description="Click the map where the house stands, or type its coordinates. Once it is placed, the map around it is kept on the server for the days the internet is away."
      size="large"
      footer={
        isConfirming && existing !== undefined ? (
          <ConfirmRemoval
            question={`Remove ${existing.name}? ${describeRemoval(removal)}`}
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
              {existing === undefined ? 'Create' : 'Save'}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Name"
          size="medium"
          value={name}
          required
          autoComplete="off"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <HouseMap
          value={shown}
          onChange={(position) => {
            setLatitudeText(positionText(position.latitude));
            setLongitudeText(positionText(position.longitude));
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Latitude"
            size="medium"
            inputMode="decimal"
            autoComplete="off"
            placeholder="45.4642"
            value={latitudeText}
            onChange={(event) => {
              setLatitudeText(event.target.value);
            }}
          />
          <TextField
            label="Longitude"
            size="medium"
            inputMode="decimal"
            autoComplete="off"
            placeholder="9.19"
            value={longitudeText}
            onChange={(event) => {
              setLongitudeText(event.target.value);
            }}
          />
        </div>
        {problem === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {problem}
          </p>
        )}
      </div>
    </Modal>
  );
}

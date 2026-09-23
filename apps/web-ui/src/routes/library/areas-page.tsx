/**
 * The areas: the house, the floors in it, the rooms on each floor.
 *
 * There is one house, so the page is the house's page. Until it exists the page asks for it;
 * once it does, the house sits at the top with where it stands and the state of the map kept
 * around it, and each floor is a panel of its rooms below. A device is put in a room from its
 * own dialog, and the room's row here says that it was.
 *
 * Placing the house is what fetches the map around it: the house dialog says whether the house
 * moved, and a house that moved gets its map fetched onto the server's disk at once, so that
 * the map is there the first time the internet is not.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { AreaView } from '@nebula-home/contracts';
import { Button } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { removalImpact } from '@/lib/area-tree';
import { fetchTileStatus, LIBRARY_QUERY_KEYS, prefetchTiles } from '@/library/api';
import { AreaDialog, type AreaDialogTarget } from '@/routes/library/area-dialog';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { FloorSection } from '@/routes/library/floor-section';
import { HouseDialog, type HouseDialogTarget } from '@/routes/library/house-dialog';
import { HOUSE_ICON, HousePanel } from '@/routes/library/house-panel';
import { LibraryPage } from '@/routes/library/library-page';
import { useAreas } from '@/routes/library/use-areas';

/** What is in it when nothing is. */
const EMPTY_IMPACT = { floors: 0, rooms: 0, devices: 0 };

/**
 * Renders the page.
 *
 * @returns The page.
 */
export function AreasPage() {
  const can = useSession((state) => state.can);
  const canWrite = can('area:write');
  const queryClient = useQueryClient();
  const { areas, tree, isPending, isError } = useAreas();
  const icons = useCatalogueIcons([HOUSE_ICON, ...areas.map((area) => area.icon)]);
  const house = tree?.house;
  const isPlaced = house?.latitude !== null && house?.longitude !== null && house !== undefined;

  const [houseTarget, setHouseTarget] = useState<HouseDialogTarget | null>(null);
  const [areaTarget, setAreaTarget] = useState<AreaDialogTarget | null>(null);

  const tiles = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.tiles, house?.id ?? ''],
    /**
     * Reads how much of the map around the house is on disk.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The state of the buffer.
     */
    queryFn: async ({ signal }) => fetchTileStatus(house?.id ?? '', signal),
    enabled: house !== undefined && isPlaced,
  });

  const preparing = useMutation({
    /**
     * Fetches the map around the house onto the server's disk.
     *
     * @param houseId - The house.
     * @returns What the fetch did.
     */
    mutationFn: async (houseId: string) => prefetchTiles(houseId),

    /** Reads the state of the buffer again, whatever the fetch managed. */
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.tiles });
    },
  });

  return (
    <>
      <LibraryPage
        title="Areas"
        noun="area"
        count={isPending ? undefined : areas.length}
        action={
          canWrite && !isPending && tree === null ? (
            <Button
              size="compact"
              onClick={() => {
                setHouseTarget({ mode: 'create' });
              }}
            >
              Create your house
            </Button>
          ) : undefined
        }
        isPending={isPending}
        error={isError ? new Error('The areas could not be read') : undefined}
        isEmpty={tree === null}
        emptyMessage="No house yet. Create it and place it on the map, then add its floors and the rooms on each; a device is put in a room from its own dialog."
      >
        {tree === null ? null : (
          <div className="flex flex-col gap-5">
            <HousePanel
              house={tree.house}
              icons={icons}
              tiles={tiles.data}
              isPreparing={preparing.isPending}
              canEdit={canWrite}
              onEdit={() => {
                setHouseTarget({ mode: 'edit', house: tree.house });
              }}
              onAddFloor={() => {
                setAreaTarget({ mode: 'create', kind: 'floor', parent: tree.house });
              }}
              onPrepareMap={() => {
                preparing.mutate(tree.house.id);
              }}
            />
            {tree.floors.map(({ floor, rooms }) => (
              <FloorSection
                key={floor.id}
                floor={floor}
                rooms={rooms}
                icons={icons}
                canEdit={canWrite}
                onEdit={() => {
                  setAreaTarget({ mode: 'edit', area: floor });
                }}
                onAddRoom={() => {
                  setAreaTarget({ mode: 'create', kind: 'room', parent: floor });
                }}
                onEditRoom={(room: AreaView) => {
                  setAreaTarget({ mode: 'edit', area: room });
                }}
              />
            ))}
          </div>
        )}
      </LibraryPage>

      {/*
       * Beside the frame rather than inside it: the frame shows a notice in place of its
       * children while there is no house, and the dialog that makes the house has to open then.
       */}
      <HouseDialog
        // Keyed on the target, so the dialog is a fresh one each time it opens.
        key={houseTarget === null ? 'house-shut' : `house-${houseTarget.mode}`}
        target={houseTarget}
        removal={house === undefined ? EMPTY_IMPACT : removalImpact(tree, house)}
        onClose={() => {
          setHouseTarget(null);
        }}
        onSaved={(saved, isMoved) => {
          setHouseTarget(null);

          if (isMoved && saved.latitude !== null) {
            preparing.mutate(saved.id);
          }
        }}
        onDeleted={() => {
          setHouseTarget(null);
        }}
      />

      <AreaDialog
        key={
          areaTarget === null
            ? 'area-shut'
            : areaTarget.mode === 'create'
              ? `area-create-${areaTarget.kind}-${areaTarget.parent.id}`
              : `area-${areaTarget.area.id}`
        }
        target={areaTarget}
        removal={areaTarget?.mode === 'edit' ? removalImpact(tree, areaTarget.area) : EMPTY_IMPACT}
        onClose={() => {
          setAreaTarget(null);
        }}
        onSaved={() => {
          setAreaTarget(null);
        }}
        onDeleted={() => {
          setAreaTarget(null);
        }}
      />
    </>
  );
}

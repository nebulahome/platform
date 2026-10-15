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
 * the map is there the first time the internet is not. It is a background task with no button:
 * the house carries a tag saying how far it has got, and a map found half-fetched is finished
 * without being asked.
 *
 * The search narrows the floors to the rooms whose names it finds - a floor whose own name matches
 * keeps all its rooms - and the house panel stays, since it is the page's subject.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AreaView } from '@nebulahome/contracts';
import { AppIcon, Button } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { removalImpact } from '@/lib/area-tree';
import { matchesQuery } from '@/lib/search-text';
import { nonDefault, useListState, type ListCodec } from '@/lib/use-list-state';
import { fetchTileStatus, LIBRARY_QUERY_KEYS, prefetchTiles } from '@/library/api';
import { AreaDialog, type AreaDialogTarget } from '@/routes/library/area-dialog';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { FloorSection } from '@/routes/library/floor-section';
import { HouseDialog, type HouseDialogTarget } from '@/routes/library/house-dialog';
import { HOUSE_ICON, HousePanel } from '@/routes/library/house-panel';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { useAreas } from '@/routes/library/use-areas';

/** What is in it when nothing is. */
const EMPTY_IMPACT = { floors: 0, rooms: 0, devices: 0 };

/** How often the map's state is read again while it is being fetched. */
const TILE_POLL_MS = 3000;

/** How the page's search lives in the address. */
const AREA_SEARCH_CODEC: ListCodec<string> = {
  keys: ['q'],

  /**
   * Reads the search.
   *
   * @param params - The query.
   * @returns What was typed.
   */
  read: (params) => params.get('q') ?? '',

  /**
   * Writes the search, when there is one.
   *
   * @param search - What was typed.
   * @returns The query entries.
   */
  write: (search) => nonDefault({ q: [search, ''] }),
};

/**
 * Renders the page.
 *
 * @returns The page.
 */
export function AreasPage() {
  const { t } = useTranslation();

  const can = useSession((state) => state.can);
  const canWrite = can('area:write');
  const queryClient = useQueryClient();
  const { areas, tree, isPending, isError } = useAreas();
  const icons = useCatalogueIcons([HOUSE_ICON, ...areas.map((area) => area.icon)]);
  const house = tree?.house;
  const isPlaced = house?.latitude !== null && house?.longitude !== null && house !== undefined;

  const [houseTarget, setHouseTarget] = useState<HouseDialogTarget | null>(null);
  const [areaTarget, setAreaTarget] = useState<AreaDialogTarget | null>(null);
  const [search, setSearch] = useListState(AREA_SEARCH_CODEC);
  const floors = (tree?.floors ?? []).flatMap((node) => {
    if (matchesQuery([node.floor.name, node.floor.key], search)) {
      return [node];
    }

    const rooms = node.rooms.filter((room) => matchesQuery([room.name, room.key], search));

    return rooms.length === 0 ? [] : [{ floor: node.floor, rooms }];
  });
  const floorCount = tree?.floors.length ?? 0;
  const roomCount = (tree?.floors ?? []).reduce((sum, node) => sum + node.rooms.length, 0);
  const shownCount = floors.reduce(
    (sum, node) => sum + 1 + node.rooms.length,
    tree === null ? 0 : 1,
  );

  const caching = useMutation({
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
    // Read again while a fetch runs, so the tag counts up as the tiles arrive.
    refetchInterval: caching.isPending ? TILE_POLL_MS : false,
  });

  const resumedFor = useRef<string | null>(null);
  const houseId = house?.id;
  const isIncomplete = tiles.data !== undefined && tiles.data.cached < tiles.data.total;
  const { mutate: cache, isPending: isCaching } = caching;

  useEffect(() => {
    // A map left half-fetched - the server restarted mid-way, the internet dropped - is finished
    // in the background the first time the page sees it, once per visit rather than on a loop.
    if (houseId !== undefined && isIncomplete && !isCaching && resumedFor.current !== houseId) {
      resumedFor.current = houseId;
      cache(houseId);
    }
  }, [houseId, isIncomplete, isCaching, cache]);

  return (
    <>
      <LibraryPage
        title={t('library.areas.areas', 'Areas')}
        counted={(count) =>
          t('library.areas.count', {
            count,
            defaultValue_one: '{{count}} area',
            defaultValue_other: '{{count}} areas',
          })
        }
        count={isPending ? undefined : areas.length}
        shownCount={search.trim() === '' ? undefined : shownCount}
        summary={
          tree === null
            ? []
            : [
                `${String(floorCount)} ${floorCount === 1 ? 'floor' : 'floors'}`,
                `${String(roomCount)} ${roomCount === 1 ? 'room' : 'rooms'}`,
              ]
        }
        tools={
          tree === null ? undefined : (
            <SearchField
              placeholder={t('library.areas.searchFloorsRooms', 'Search floors, rooms…')}
              value={search}
              onChange={setSearch}
            />
          )
        }
        action={
          canWrite && !isPending && tree === null ? (
            <Button
              onClick={() => {
                setHouseTarget({ mode: 'create' });
              }}
            >
              <AppIcon id="plus" size={15} />
              {t('library.areas.createYourHouse', 'Create your house')}
            </Button>
          ) : undefined
        }
        isPending={isPending}
        error={
          isError
            ? new Error(t('library.areas.areasCouldNotBe', 'The areas could not be read'))
            : undefined
        }
        isEmpty={tree === null}
        emptyMessage={t(
          'library.areas.noHouseYetCreate',
          'No house yet. Create it and place it on the map, then add its floors and the rooms on each; a device is put in a room from its own dialog.',
        )}
      >
        {tree === null ? null : (
          <div className="flex flex-col gap-5">
            <HousePanel
              house={tree.house}
              icons={icons}
              tiles={tiles.data}
              isCaching={isCaching}
              canEdit={canWrite}
              onEdit={() => {
                setHouseTarget({ mode: 'edit', house: tree.house });
              }}
              onAddFloor={() => {
                setAreaTarget({ mode: 'create', kind: 'floor', parent: tree.house });
              }}
            />
            {floors.length === 0 && search.trim() !== '' ? (
              <NoMatches
                query={search}
                onClear={() => {
                  setSearch('');
                }}
              />
            ) : null}
            {floors.map(({ floor, rooms }) => (
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
            resumedFor.current = saved.id;
            cache(saved.id);
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
        floors={(tree?.floors ?? []).map((node) => node.floor)}
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

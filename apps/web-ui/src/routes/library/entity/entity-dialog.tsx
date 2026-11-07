/**
 * An entity, in its dialog over whatever page is open: the sheet the entity lab draws
 * (`sheet/entity-sheet.tsx`), fed with what the platform knows - the entity and its live state,
 * its commander, its history over the window chosen, its device's battery - and saving what its
 * settings change.
 *
 * `EntityDialogHost` sits in the shell and opens it for `?entity=` in the address
 * (`entity-path.ts`), so a row, a card, a package or a bookmark opens it the same way, and
 * putting it away takes only that out of the address.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { EntityUpdate } from '@nebulahome/contracts';
import { Modal, toast } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { LIBRARY_QUERY_KEYS, updateEntity } from '@/library/api';
import { hasCapability } from '@/library/entity-control';
import type { HistoryRange } from '@/library/history-series';
import { useStateChanges, useTelemetry } from '@/routes/dashboard/cards/use-card-history';
import { devicePath } from '@/routes/library/device/device-path';
import { LinkDialog, type LinkRequest } from '@/routes/library/device/link-dialog';
import {
  ENTITY_PARAM,
  ENTITY_VIEW_PARAM,
  type EntitySheetView,
} from '@/routes/library/entity/entity-path';
import { EntitySheet } from '@/routes/library/entity/sheet/entity-sheet';
import { sheetKindOf } from '@/routes/library/entity/sheet/kinds';
import type { SheetRange } from '@/routes/library/entity/sheet/sheet-types';
import { useEntityCommand } from '@/routes/library/entity/use-entity-command';
import { useEntityDialog, type EntityDialogView } from '@/routes/library/entity/use-entity-dialog';

/**
 * The history window each of the dialog's ranges is read over: a running total's day, week and
 * month are the last 24 hours, 7 days and 30 days, as the lab draws them.
 */
const SPAN_OF: Readonly<Record<SheetRange, HistoryRange>> = {
  '6h': '6h',
  '24h': '24h',
  '7d': '7d',
  day: '24h',
  week: '7d',
  month: '30d',
};

/** How often the dialog's "since" and "for" words are worked out again. */
const TICK_MS = 30_000;

/**
 * The time now, moving on every half minute.
 *
 * @returns Milliseconds since the epoch.
 */
function useNow(): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, []);

  return now;
}

/** What the dialog needs. */
type EntityDialogProps = {
  readonly entityId: string;

  /** The sheet to open with, if any. */
  readonly initialView?: EntitySheetView | undefined;

  /** Called to put it away. */
  readonly onClose: () => void;
};

/**
 * The dialog, once the entity has been read.
 *
 * @param props - The dialog's props, and the view of the entity.
 * @param props.view - See {@link EntityDialogView}.
 * @returns The dialog.
 */
function LoadedEntityDialog(props: EntityDialogProps & { readonly view: EntityDialogView }) {
  const { t } = useTranslation();
  const { entityId, view, onClose } = props;
  const { entity, state } = view;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const commander = useEntityCommand(entityId);
  const [range, setRange] = useState<SheetRange>('24h');
  const [unlinking, setUnlinking] = useState<LinkRequest | null>(null);
  const span = SPAN_OF[range];
  const hasHistory = sheetKindOf(entity, state).history !== 'none';
  const states = useStateChanges(entityId, span, hasHistory);
  const telemetry = useTelemetry(
    entityId,
    span,
    hasHistory && hasCapability(entity, 'sensor_numeric'),
  );
  const now = useNow();
  const window = states?.window ?? telemetry?.window ?? { from: now, to: now };

  const save = useMutation({
    /**
     * Saves what changed.
     *
     * @param body - The change.
     * @returns The entity as it now stands.
     */
    mutationFn: async (body: EntityUpdate) => updateEntity(entityId, body),

    /** Reads the entities and the tags again. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities });
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.tags });
    },

    /**
     * Says why it was not saved: the sheet is already put away.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('entity.dialog.notSaved', 'Couldn’t save {{name}}', { name: entity.name }),
        message: toMessage(error),
      });
    },
  });

  return (
    <>
      <Modal
        isOpen
        layout="bare"
        title={entity.name}
        // While Unlink asks, Escape is its to answer.
        onClose={unlinking === null ? onClose : () => undefined}
      >
        <EntitySheet
          entity={entity}
          state={state}
          reportedAt={view.reportedAt}
          commander={commander}
          disabled={!view.canControl || !view.reading.isAvailable}
          history={{
            range,
            onRange: setRange,
            window,
            states: states?.points ?? [],
            telemetry: telemetry?.points ?? [],
          }}
          battery={view.battery}
          now={now}
          icon={view.icon}
          deviceName={view.device?.name ?? null}
          {...(props.initialView === undefined ? {} : { initialView: props.initialView })}
          canEdit={view.canEdit}
          canCreateTags={view.canCreateTags}
          onClose={onClose}
          onSave={(change) => {
            const body = {
              ...change.update,
              ...(change.isEnabled === undefined ? {} : { isEnabled: change.isEnabled }),
            };

            if (Object.keys(body).length > 0) {
              save.mutate(body);
            }
          }}
          onEnable={() => {
            save.mutate({ isEnabled: true });
          }}
          {...(view.device === undefined
            ? {}
            : {
                /** Goes to its device's page, which puts the dialog away. */
                onOpenDevice: () => {
                  void navigate(devicePath(view.device?.id ?? ''));
                },
              })}
          {...(entity.linked == null || !view.canLink
            ? {}
            : {
                /** Asks to unlink the reading, in the device page's Unlink dialog. */
                onUnlink: () => {
                  setUnlinking({ action: 'unlink', target: { scope: 'entity', id: entityId } });
                },
              })}
        />
      </Modal>

      <LinkDialog
        request={unlinking}
        lines={[]}
        onClose={() => {
          setUnlinking(null);
        }}
        onDone={() => {
          setUnlinking(null);
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
        }}
      />
    </>
  );
}

/**
 * An entity's dialog: nothing while it is read, and put away with a word if it cannot be.
 *
 * @param props - See {@link EntityDialogProps}.
 * @returns The dialog, or nothing yet.
 */
export function EntityDialog(props: EntityDialogProps) {
  const { t } = useTranslation();
  const { entityId, onClose } = props;
  const { view, error } = useEntityDialog(entityId);
  const isMissing = view === undefined && error !== null;

  useEffect(() => {
    if (isMissing) {
      toast.error({
        title: t('entity.dialog.notFound', 'Couldn’t open {{entityId}}', { entityId }),
        message: toMessage(error),
      });
      onClose();
    }
    // Once per failed read: the toast and the close are not to repeat with each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [isMissing]);

  return view === undefined ? null : <LoadedEntityDialog {...props} view={view} />;
}

/**
 * Opens the dialog of the entity the address names, over whatever page is open.
 *
 * @returns The dialog, or nothing.
 */
export function EntityDialogHost() {
  const [params, setParams] = useSearchParams();
  const entityId = params.get(ENTITY_PARAM);
  const asked = params.get(ENTITY_VIEW_PARAM);

  if (entityId === null || entityId === '') {
    return null;
  }

  /** Puts the dialog away: only its own part of the address goes. */
  const close = (): void => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);

        next.delete(ENTITY_PARAM);
        next.delete(ENTITY_VIEW_PARAM);

        return next;
      },
      { replace: true },
    );
  };

  return (
    <EntityDialog
      key={`${entityId}:${asked ?? ''}`}
      entityId={entityId}
      initialView={asked === 'settings' || asked === 'history' ? asked : undefined}
      onClose={close}
    />
  );
}

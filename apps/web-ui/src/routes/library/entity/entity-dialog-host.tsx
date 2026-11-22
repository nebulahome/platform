/**
 * The shell's opener of an entity's dialog: it reads `?entity=` in the address (`entity-path.ts`)
 * and draws the dialog over whatever page is open.
 *
 * Kept apart from the dialog so the shell does not carry the entity's sheet, a third of the app's
 * first script: the dialog is read the first time an entity is opened.
 */
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router';

import { ENTITY_PARAM, ENTITY_VIEW_PARAM } from '@/routes/library/entity/entity-path';

/**
 * The dialog, read when the first entity is opened.
 *
 * @returns The dialog's module, as `lazy` takes it.
 */
const EntityDialog = lazy(async () => {
  const module = await import('@/routes/library/entity/entity-dialog');

  return { default: module.EntityDialog };
});

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
    <Suspense fallback={null}>
      <EntityDialog
        key={`${entityId}:${asked ?? ''}`}
        entityId={entityId}
        initialView={asked === 'settings' || asked === 'history' ? asked : undefined}
        onClose={close}
      />
    </Suspense>
  );
}

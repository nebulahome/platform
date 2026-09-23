/**
 * The same readings, as entities an automation can use.
 *
 * The page shows the machine every ten seconds; the entities carry a minute's average, so an
 * automation on "processor above 90%" reads a busy minute rather than a busy moment. Listed here
 * with their ids, because an id is what an automation or an alias is written against, and the
 * place a person learns that these exist is the page that shows the numbers.
 */
import { useState } from 'react';

import { SYSTEM_ENTITIES } from '@nebula-home/contracts';
import { IconButton, Panel, PanelNote, PanelRow } from '@nebula-home/ui';

import { CheckIcon, CopyIcon } from '@/components/icons';
import { copyText } from '@/lib/clipboard';

/**
 * Renders the list.
 *
 * @returns The panel.
 */
export function SystemEntitiesPanel() {
  const [copied, setCopied] = useState<string | null>(null);

  /**
   * Copies an entity id, and says so on its button.
   *
   * @param entityId - The id.
   */
  const copy = (entityId: string): void => {
    void (async (): Promise<void> => {
      if (await copyText(entityId)) {
        setCopied(entityId);
      }
    })();
  };

  return (
    <Panel title="In automations and aliases">
      {SYSTEM_ENTITIES.map((entity) => (
        <PanelRow
          key={entity.entityId}
          title={entity.name}
          note={<span className="font-mono">{entity.entityId}</span>}
          control={
            <IconButton
              size="small"
              label={copied === entity.entityId ? 'Copied' : `Copy ${entity.entityId}`}
              onClick={() => {
                copy(entity.entityId);
              }}
            >
              {copied === entity.entityId ? (
                <CheckIcon width="14" height="14" />
              ) : (
                <CopyIcon width="14" height="14" />
              )}
            </IconButton>
          }
        />
      ))}

      <PanelNote>
        These belong to the NebulaHome server device. Each takes a new state once a minute, the
        average of the minute, so a busy few seconds does not set an automation off.
      </PanelNote>
    </Panel>
  );
}

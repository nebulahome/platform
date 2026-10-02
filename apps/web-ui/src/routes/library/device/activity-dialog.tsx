/**
 * One line of a device's activity, opened: everything that is known about that change.
 *
 * The exact moment, to the second; which entity, as the way to its page; each capability that
 * changed, before and after, in the words the interface reads it in; whether the entity was
 * reachable either side; which integration reported it; and, when the platform knows it, what
 * caused it. Under all that, the change as the device reported it, for the person who needs to see
 * exactly what arrived.
 */
import { Link } from 'react-router';

import type { EntityView } from '@nebulahome/contracts';
import { Button, Modal } from '@nebulahome/ui';

import type { ActivityLine } from '@/library/device-activity';
import { Fact } from '@/routes/library/entity/details-panel';
import { entityPath } from '@/routes/library/entity/entity-path';

/** The words for each cause of a change, as the entity's recent changes say them. */
const CAUSES: Readonly<Record<string, string>> = {
  user: 'From the interface',
  automation: 'An automation',
  scene: 'A scene',
  device: 'On the device',
  alias: 'Worked out by an alias',
  startup: 'At start-up',
};

/** The moment to the second, in the reader's locale and zone. */
const exactly = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'medium' });

/**
 * Says whether something could be reached.
 *
 * @param isAvailable - Whether it could, or null when nothing is known.
 * @returns The word.
 */
function reach(isAvailable: boolean | null): string {
  return isAvailable === null ? 'Unknown' : isAvailable ? 'Reachable' : 'Unreachable';
}

/** What the dialog needs. */
export type ActivityDialogProps = {
  /** The line opened; null when the dialog is shut. */
  readonly line: ActivityLine | null;

  /** The device's entities, by address, for their names. */
  readonly entities: ReadonlyMap<string, EntityView>;

  /** Called to shut it. */
  readonly onClose: () => void;
};

/**
 * Renders the dialog.
 *
 * @param props - See {@link ActivityDialogProps}.
 * @returns The dialog.
 */
export function ActivityDialog(props: ActivityDialogProps) {
  const { line, entities, onClose } = props;
  const first = line?.entries[0];

  return (
    <Modal
      isOpen={line !== null}
      onClose={onClose}
      title={line?.title ?? ''}
      description={line?.summary}
      size="large"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {line === null || first === undefined ? null : (
        <div className="flex flex-col gap-4">
          <dl className="overflow-hidden rounded-field border border-border-soft">
            <Fact term="When">
              <time dateTime={line.time.toISOString()}>{exactly.format(line.time)}</time>
            </Fact>
            <Fact term={line.entries.length === 1 ? 'Entity' : 'Entities'}>
              <span className="flex flex-col gap-0.5">
                {line.entries.map((entry) => (
                  <Link
                    key={entry.entityId}
                    to={entityPath(entry.entityId)}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {entities.get(entry.entityId)?.name ?? entry.entityId}
                  </Link>
                ))}
              </span>
            </Fact>
            {line.changes.map((change) => (
              <Fact key={change.capability} term={change.label}>
                <span className="font-mono text-caption">
                  {change.before ?? '—'} <span className="text-foreground-subtle">→</span>{' '}
                  {change.after}
                </span>
              </Fact>
            ))}
            <Fact term="Reachable">
              {reach(first.wasAvailable)}
              <span className="text-foreground-subtle"> → </span>
              {reach(first.isAvailable)}
            </Fact>
            <Fact term="Reported by">
              <span className="font-mono text-caption">{first.source}</span>
            </Fact>
            {first.context === undefined ? null : (
              <Fact term="Cause">{CAUSES[first.context.type] ?? first.context.type}</Fact>
            )}
          </dl>

          <details className="group rounded-field border border-border-soft">
            <summary className="cursor-pointer px-4 py-2.5 text-caption text-foreground-subtle select-none hover:text-foreground">
              As the device reported it
            </summary>
            <pre className="max-h-64 overflow-auto border-t border-border-soft px-4 py-3 font-mono text-caption text-foreground-muted">
              {JSON.stringify(
                line.entries.map((entry) => ({
                  entityId: entry.entityId,
                  from: entry.from,
                  to: entry.to,
                  isAvailable: entry.isAvailable,
                })),
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      )}
    </Modal>
  );
}

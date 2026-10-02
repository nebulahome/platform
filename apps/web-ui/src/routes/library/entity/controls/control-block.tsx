/**
 * One capability's controls, as a block of the entity's Control panel.
 *
 * Every control on the page sits in the same frame - a title in the panel's small capitals, what
 * it reads now beside it, the control underneath - so a lamp's power, brightness and white read
 * as three parts of one thing rather than as three widgets that happen to be stacked.
 */
import type { ReactNode } from 'react';

import type { CapabilityName, CapabilityState, EntityView } from '@nebulahome/contracts';
import { cn } from '@nebulahome/ui';

import type { EntityCommander } from '@/routes/library/entity/use-entity-command';
import type { PendingValue } from '@/routes/library/entity/use-pending-value';

/** A light's colour, as a hue and how much of it. */
export type LightColour = { readonly hue: number; readonly saturation: number };

/** What every capability's control is given. */
export type ControlProps = {
  /** The entity, with its capabilities and their params. */
  readonly entity: EntityView;

  /** Its state now. */
  readonly state: CapabilityState;

  /** When that state arrived, in milliseconds since the epoch. */
  readonly reportedAt: number | null;

  /** Sends its commands. */
  readonly commander: EntityCommander;

  /** Whether commands cannot be sent: unreachable, refused, or not a device at all. */
  readonly disabled: boolean;

  /**
   * A light's colour as the page shows it, shared by the blocks that change it: setting a white
   * turns the colour white at once, rather than when the lamp next reports.
   */
  readonly colour?: PendingValue<LightColour>;
};

/**
 * Whether a capability has a command on its way.
 *
 * @param props - The control's props.
 * @param capability - Which capability.
 * @returns True while one is in flight.
 */
export function isBusy(
  props: Pick<ControlProps, 'commander'>,
  capability: CapabilityName,
): boolean {
  return props.commander.busy.has(capability);
}

/** What a block needs. */
export type ControlBlockProps = {
  /** What it controls: "Power", "Brightness". */
  readonly title: string;

  /** What it reads now, beside the title. */
  readonly value?: ReactNode;

  /** A control that sits on the title line, such as a switch. */
  readonly action?: ReactNode;

  /** The controls. */
  readonly children?: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders one block.
 *
 * @param props - See {@link ControlBlockProps}.
 * @returns The block.
 */
export function ControlBlock(props: ControlBlockProps) {
  const { title, value, action, children, className } = props;

  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col gap-3.5 border-b border-border-soft px-4 py-4 last:border-b-0',
        className,
      )}
    >
      <div className="flex min-h-7 items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h3 className="text-label text-foreground-subtle uppercase">{title}</h3>
          {value === undefined ? null : (
            <span className="truncate text-ui font-medium text-foreground tabular">{value}</span>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

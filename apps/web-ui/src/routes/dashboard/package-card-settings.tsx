/**
 * A package's card's settings: a title of its own, and the options its manifest declares for it,
 * in the setup grammar every form of the interface speaks (PACKAGES.md 3).
 *
 * The options are the card's own - which camera a timeline shows, which room a player plays in -
 * and are kept in the layout with the card. Each change is checked as the API checks a setup, and
 * reaches the card only once it is valid: a card is never drawn with options its package would
 * refuse. A package that is not installed keeps what was chosen, and says so.
 */
import { useState } from 'react';

import type { DashboardCard, DashboardPackageCard, SetupGroup } from '@nebulahome/contracts';
import { PanelNote, TextField } from '@nebulahome/ui';

import { initialDraft, toValues, type SetupDraft } from '@/library/setup-values';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { SetupForm } from '@/routes/library/setup-form';

/** What the settings need. */
export type PackageCardSettingsProps = {
  readonly card: DashboardPackageCard;
  readonly data: DashboardData;
  readonly onChange: (update: (current: DashboardCard) => DashboardCard) => void;
};

/**
 * Renders the settings.
 *
 * @param props - See {@link PackageCardSettingsProps}.
 * @returns The fields.
 */
export function PackageCardSettings(props: PackageCardSettingsProps) {
  const { card, data, onChange } = props;
  const found = data.packageById.get(card.packageId);
  const declared = found?.ui?.cards.find((each) => each.id === card.cardId);
  const group: SetupGroup = { constants: {}, fields: declared?.options ?? [] };
  const [draft, setDraft] = useState<SetupDraft>(() => initialDraft(group, card.options));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  return (
    <div className="flex flex-col gap-3.5">
      <TextField
        label="Title"
        size="compact"
        value={card.title ?? ''}
        placeholder={declared?.name ?? card.cardId}
        hint={`Empty for ${declared?.name ?? 'its own name'}.`}
        onChange={(event) => {
          const title = event.target.value;

          onChange((current) =>
            current.type === 'package'
              ? { ...current, title: title.trim() === '' ? null : title }
              : current,
          );
        }}
      />

      {declared === undefined ? (
        <PanelNote>
          {found === undefined
            ? `The ${card.packageId} package is not installed: what this card was set to is kept for when it is.`
            : `${found.name} ${found.version} no longer has this card.`}
        </PanelNote>
      ) : (
        <SetupForm
          group={group}
          draft={draft}
          errors={errors}
          kept={[]}
          onChange={(key, value) => {
            const next = { ...draft, [key]: value };
            const read = toValues(group, next, 'complete');

            setDraft(next);
            setErrors(read.errors);

            if (Object.keys(read.errors).length === 0) {
              onChange((current) =>
                current.type === 'package' ? { ...current, options: read.values } : current,
              );
            }
          }}
        />
      )}
    </div>
  );
}

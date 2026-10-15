/**
 * The Environment tab of a container's page: every variable it was started with, as a mono table
 * to search.
 *
 * The value of anything whose name says it is a secret is withheld by the server, so it never
 * reaches the page; the table says so in its place. The variables are read, not changed: the
 * supervisor has no way to change them and start the container again yet.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ContainerDetail } from '@nebulahome/contracts';
import { Badge, Section } from '@nebulahome/ui';

import { matchesQuery } from '@/lib/search-text';
import { SearchField } from '@/routes/library/search-field';

/** What the tab needs. */
export type ContainerEnvironmentProps = {
  readonly container: ContainerDetail;
};

/**
 * Renders the Environment tab.
 *
 * @param props - See {@link ContainerEnvironmentProps}.
 * @returns The tab's content.
 */
export function ContainerEnvironment(props: ContainerEnvironmentProps) {
  const { t } = useTranslation();

  const { container } = props;
  const [search, setSearch] = useState('');
  const found = container.env.filter((variable) =>
    matchesQuery([variable.name, variable.isHidden ? null : variable.value], search),
  );

  return (
    <Section
      title={t('containers.containerEnvironment.variables', 'Variables')}
      note={t(
        'containers.containerEnvironment.valueOfOneWhose',
        'The value of one whose name says it is a secret is withheld.',
      )}
      actions={
        container.env.length === 0 ? undefined : (
          <SearchField
            label={t('containers.containerEnvironment.searchTheVariables', 'Search the variables')}
            placeholder={t('containers.containerEnvironment.searchVariables', 'Search variables…')}
            value={search}
            onChange={setSearch}
          />
        )
      }
    >
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <div
          aria-hidden="true"
          className="grid grid-cols-5 gap-4 border-b border-border px-5 py-2.5 font-mono text-label text-foreground-subtle uppercase"
        >
          <span className="col-span-2">{t('containers.containerEnvironment.name', 'Name')}</span>
          <span className="col-span-3">{t('containers.containerEnvironment.value', 'Value')}</span>
        </div>
        {container.env.length === 0 ? (
          <p className="px-5 py-4 text-ui text-foreground-muted">
            {t('containers.containerEnvironment.noVariables', 'No variables.')}
          </p>
        ) : found.length === 0 ? (
          <p className="px-5 py-4 text-ui text-foreground-subtle">
            {t(
              'containers.containerEnvironment.noVariableMatchesSearch',
              'No variable matches “{{search}}”.',
              { search: search.trim() },
            )}
          </p>
        ) : (
          <ul>
            {found.map((variable, index) => (
              // Two variables may share a name in a hand-written configuration.
              <li
                key={`${variable.name}-${String(index)}`}
                className="grid grid-cols-5 items-start gap-4 border-t border-border px-5 py-3 first:border-t-0"
              >
                <span className="col-span-2 font-mono text-mono-ui break-all text-foreground">
                  {variable.name}
                </span>
                {variable.isHidden ? (
                  <span className="col-span-3">
                    <Badge tone="neutral" size="small">
                      {t('containers.containerEnvironment.withheld', 'Withheld')}
                    </Badge>
                  </span>
                ) : (
                  <span className="col-span-3 font-mono text-mono-ui break-all text-foreground-muted">
                    {variable.value ?? ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

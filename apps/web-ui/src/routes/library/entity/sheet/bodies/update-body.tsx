/**
 * A device's firmware, as the canvas draws it (`N-Entity-Modal-Update`, `N-Entity-Update-More`):
 * one ring tells the story - violet while an update waits or is being written, filling as it goes
 * (turning when the device does not say how far), green once it is up to date. Under it the two
 * versions, the Install button when it can be installed from here, and the release notes. Skip,
 * backup and installing by itself are left out by choice.
 */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { isUpdateOffered } from '@nebulahome/contracts';
import { AppIcon, cn } from '@nebulahome/ui';

import { paramsOf } from '@/library/entity-control';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';

/** The ring's radius and how long it is round. */
const RADIUS = 72;
const ROUND = 2 * Math.PI * RADIUS;

/**
 * The body of a firmware update.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function UpdateBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, disabled } = props;
  const gradient = useId();
  const params = paramsOf(entity, 'update');
  const update = state.update;

  if (update === undefined || params === null) {
    return null;
  }

  const isInstalling = update.isInstalling || commander.busy.has('update');
  const isOffered = isUpdateOffered(update);
  const isUpToDate = !isOffered && !isInstalling;
  const canInstall = params.canInstall;
  const progress = update.progress;
  const filled = isUpToDate ? 1 : isInstalling ? (progress ?? 25) / 100 : isOffered ? 1 : 0;
  const glow = isUpToDate ? 'success' : canInstall || isInstalling ? 'violet' : 'muted';
  const versions = (
    <div className="flex items-center justify-center gap-4">
      <span className="font-mono text-[20px] text-foreground-subtle">
        {update.installedVersion ?? '—'}
      </span>
      <span
        aria-hidden="true"
        className="h-0.5 w-14 rounded-[2px] bg-linear-to-r from-violet/0 via-violet to-violet/0"
      />
      <span className="font-mono text-[20px] text-foreground">{update.latestVersion}</span>
    </div>
  );
  const notes =
    update.releaseUrl === undefined &&
    update.releaseSummary === undefined ? null : update.releaseSummary === undefined ? (
      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <a
          href={update.releaseUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2 text-ui-sm text-foreground"
        >
          <AppIcon id="file-text" size={15} />
          {isUpToDate
            ? t('entity.sheet.update.releaseNotesFor', 'Release notes {{version}}', {
                version: update.installedVersion ?? '',
              })
            : t('entity.sheet.update.releaseNotes', 'Release notes')}
        </a>
      </div>
    ) : (
      <>
        <div className="rounded-card border border-border bg-well px-4 py-3.5 text-ui-sm leading-[1.7] text-foreground-muted">
          <b className="font-medium text-foreground">
            {update.latestVersion ?? update.installedVersion}
          </b>
          {update.releaseSummary.split('\n').map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </div>
        {update.releaseUrl === undefined ? null : (
          <a
            href={update.releaseUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 text-ui-sm text-foreground"
          >
            <AppIcon id="external-link" size={15} />
            {t('entity.sheet.update.fullNotes', 'Full release notes on the maker’s site')}
          </a>
        )}
      </>
    );
  const install =
    isOffered && canInstall && !isInstalling ? (
      <div className="flex">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            commander.send('update', { command: 'install' });
          }}
          className="press inline-flex h-13 flex-1 cursor-pointer items-center justify-center gap-2.25 rounded-card bg-primary px-4.5 text-title font-medium text-white shadow-[0_10px_28px_-14px_color-mix(in_oklab,var(--color-primary)_90%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon id="download" size={18} />
          {t('entity.sheet.update.install', 'Install {{version}}', {
            version: update.latestVersion ?? '',
          })}
        </button>
      </div>
    ) : null;

  // With its notes to read, the versions lead and the ring is left out.
  if (update.releaseSummary !== undefined && isOffered && !isInstalling) {
    return (
      <div className="flex grow flex-col justify-center gap-4.5">
        {versions}
        {notes}
        {install}
      </div>
    );
  }

  return (
    <div className="flex grow flex-col justify-center gap-4.5">
      <div className="relative -mt-1.5 -mb-2.5 size-55 self-center">
        <span
          aria-hidden="true"
          className={cn(
            'entity-breathe absolute top-2.5 left-2.5 size-50 rounded-full',
            glow === 'success'
              ? 'bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-success)_18%,transparent)_0%,color-mix(in_oklab,var(--color-success)_7%,transparent)_45%,transparent_70%)]'
              : glow === 'violet'
                ? 'bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-violet)_22%,transparent)_0%,color-mix(in_oklab,var(--color-violet)_9%,transparent)_45%,transparent_70%)]'
                : 'bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-foreground-muted)_8%,transparent)_0%,transparent_70%)]',
          )}
        />
        <svg
          width={220}
          height={220}
          viewBox="0 0 220 220"
          aria-hidden="true"
          className="absolute inset-0"
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop
                offset="0"
                stopColor={isUpToDate ? 'var(--color-success)' : 'var(--color-violet)'}
              />
              <stop
                offset="1"
                stopColor={isUpToDate ? 'var(--color-cyan)' : 'var(--color-primary)'}
              />
            </linearGradient>
          </defs>
          <circle
            cx={110}
            cy={110}
            r={RADIUS}
            fill="none"
            strokeWidth={8}
            className="stroke-surface-high"
          />
          {canInstall || isInstalling || isUpToDate ? (
            <circle
              cx={110}
              cy={110}
              r={RADIUS}
              fill="none"
              stroke={`url(#${gradient})`}
              strokeWidth={8}
              strokeLinecap="round"
              strokeDasharray={`${(ROUND * filled).toFixed(1)} ${ROUND.toFixed(1)}`}
              transform="rotate(-90 110 110)"
              className={cn(
                'entity-track',
                isInstalling && progress === null && 'entity-spin origin-center',
              )}
            />
          ) : null}
          {isOffered && canInstall && !isInstalling ? (
            <circle
              cx={110}
              cy={110}
              r={88}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="2 9"
              className="entity-ring origin-center stroke-violet/35"
            />
          ) : null}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {isInstalling ? (
            progress === null ? (
              <div className="flex flex-col items-center gap-1">
                <span className="text-[18px] font-medium">
                  {t('entity.sheet.update.installing', 'Installing')}
                </span>
                <span className="font-mono text-[11px] text-foreground-subtle">
                  {t('entity.sheet.update.noPercent', 'no %')}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-0.5">
                <span className="flex items-baseline gap-0.75">
                  <span className="text-[48px] leading-none font-medium tracking-[-0.04em] tabular">
                    {Math.round(progress)}
                  </span>
                  <span className="text-[18px] text-foreground-muted">%</span>
                </span>
                <span className="text-caption text-foreground-subtle">
                  {t('entity.sheet.update.installing', 'Installing')}
                </span>
              </div>
            )
          ) : (
            <span
              className={cn(
                'flex size-17 items-center justify-center rounded-[20px] border',
                isUpToDate
                  ? 'border-success/35 bg-success/14 text-success'
                  : canInstall
                    ? 'border-violet/35 bg-violet/14 text-violet'
                    : 'border-foreground-muted/35 bg-foreground-muted/14 text-foreground-muted',
              )}
            >
              <AppIcon id={isUpToDate ? 'check' : 'download'} size={28} />
            </span>
          )}
        </div>
      </div>

      {isInstalling ? null : (
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-[24px] font-medium tracking-[-0.02em]">
            {isUpToDate
              ? t('entity.sheet.update.upToDate', 'Up to date')
              : canInstall
                ? t('entity.sheet.update.ready', 'Update ready')
                : t('entity.sheet.update.available', 'Update available')}
          </span>
          <span className="text-ui-sm text-foreground-subtle">
            {isUpToDate
              ? t('entity.sheet.update.version', 'Version {{version}}', {
                  version: update.installedVersion ?? '—',
                })
              : canInstall
                ? t('entity.sheet.update.newVersion', 'A new version for the device')
                : t('entity.sheet.update.fromMakersApp', 'Install it from the maker’s app')}
          </span>
        </div>
      )}

      {isUpToDate ? null : versions}
      {install}
      {isInstalling ? (
        <span className="text-ui-sm leading-[1.45] text-foreground-subtle">
          {t('entity.sheet.update.keepPowered', 'Keep the device powered until it restarts.')}
        </span>
      ) : (
        notes
      )}
    </div>
  );
}

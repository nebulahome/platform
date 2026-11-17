/**
 * The editor's header (`N-Dashboard-Edit`): a plain row where the page header is in the read-only
 * view - no box, no fill - that says what is being edited and who sees the change, and holds the
 * width switch, Cancel and Done. It stays at the top while the page scrolls, because it holds Done.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, cn, type UiIconId } from '@nebulahome/ui';

/** The widths the editor can show the dashboard at. */
export type PreviewScreen = 'desktop' | 'tablet' | 'phone';

/** What the header needs. */
export type EditingHeaderProps = {
  /** The dashboard's name. */
  readonly name: string;

  /** The quiet line beside it: who sees the change. */
  readonly hint: string;

  /** The width shown. */
  readonly screen: PreviewScreen;

  /** Shows another width. */
  readonly onScreen: (screen: PreviewScreen) => void;

  /** Throws the changes away. */
  readonly onCancel: () => void;

  /** Saves the changes. */
  readonly onDone: () => void;

  /** Whether the layout is being saved. */
  readonly isSaving: boolean;
};

/** The width switch's choices: what each is called and its icon. */
const SCREENS: readonly { readonly value: PreviewScreen; readonly icon: UiIconId }[] = [
  { value: 'desktop', icon: 'laptop' },
  { value: 'tablet', icon: 'tablet' },
  { value: 'phone', icon: 'smartphone' },
];

/**
 * Renders the editor's header.
 *
 * @param props - See {@link EditingHeaderProps}.
 * @returns The header.
 */
export function EditingHeader(props: EditingHeaderProps) {
  const { t } = useTranslation();

  const { name, hint, screen, onScreen, onCancel, onDone, isSaving } = props;
  const labels: Readonly<Record<PreviewScreen, string>> = {
    desktop: t('dashboard.editingHeader.desktop', 'Desktop'),
    tablet: t('dashboard.editingHeader.tablet', 'Tablet'),
    phone: t('dashboard.editingHeader.phone', 'Phone'),
  };

  return (
    <header className="flex h-9 animate-fade-in items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex h-5.5 shrink-0 items-center rounded-pill border border-primary/50 px-2 font-mono text-label tracking-[0.08em] text-primary-hover uppercase">
          {t('dashboard.editingHeader.editing', 'Editing')}
        </span>
        <h1 className="shrink-0 truncate text-title font-medium">{name}</h1>
        <span className="truncate text-ui-sm text-foreground-subtle max-md:hidden">{hint}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div
          role="radiogroup"
          aria-label={t('dashboard.editingHeader.previewWidth', 'Preview width')}
          className="flex gap-0.5 rounded-pill border border-border-strong bg-surface p-[3px]"
        >
          {SCREENS.map((each) => (
            <button
              key={each.value}
              type="button"
              role="radio"
              aria-checked={screen === each.value}
              aria-label={labels[each.value]}
              title={labels[each.value]}
              className={cn(
                'flex h-7 w-9 items-center justify-center rounded-pill transition-colors duration-150',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
                screen === each.value
                  ? 'bg-surface-high text-foreground'
                  : 'text-foreground-subtle hover:text-foreground',
              )}
              onClick={() => {
                onScreen(each.value);
              }}
            >
              <AppIcon id={each.icon} size={16} />
            </button>
          ))}
        </div>
        <span className="w-1" />
        <Button variant="ghost" disabled={isSaving} onClick={onCancel}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button isBusy={isSaving} onClick={onDone}>
          <AppIcon id="check" size={16} />
          {t('common.done', 'Done')}
        </Button>
      </div>
    </header>
  );
}

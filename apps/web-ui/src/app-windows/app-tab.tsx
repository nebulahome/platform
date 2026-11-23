/**
 * A hidden app window's tab on the right edge (docs: app windows, decision 7 and 4.5): 32 pixels of
 * it show, its integration's logo; pointed at or focused it slides out with the name. A click,
 * Enter, Space or the left arrow brings the window back.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { cn } from '@nebulahome/ui';

import { useAppWindows, type AppWindow } from '@/app-windows/app-windows-store';
import { fetchVendor, LIBRARY_QUERY_KEYS } from '@/library/api';
import { VendorLogo } from '@/routes/library/vendor-card';

/** What a tab needs. */
export type AppTabProps = {
  /** Its window. */
  readonly window: AppWindow;

  /** Where its top is in the layer. */
  readonly top: number;

  /** Its height: squeezed when the edge is crowded. */
  readonly height: number;
};

/**
 * Renders a hidden window's tab.
 *
 * @param props - See {@link AppTabProps}.
 * @returns The tab.
 */
export function AppTab(props: AppTabProps) {
  const { window: app, top, height } = props;
  const { t } = useTranslation();
  const vendor = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.vendors, app.vendorId],

    /**
     * Reads the integration, for its logo.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the tab goes.
     * @returns The integration.
     */
    queryFn: async ({ signal }) => fetchVendor(app.vendorId, signal),
  });

  /** Brings the window back. */
  const show = (): void => {
    useAppWindows.getState().show(app.name);
  };

  return (
    <button
      type="button"
      aria-label={t('appWindows.show', 'Show {{name}}', { name: app.title })}
      aria-keyshortcuts="ArrowLeft Enter Space"
      className={cn(
        'app-window-tab pointer-events-auto absolute right-0 flex w-45 translate-x-37 items-center gap-2.5 rounded-l-inner border border-r-0 border-border-strong bg-glass pl-1 text-left',
        'backdrop-blur-[20px] backdrop-saturate-140 transition-transform duration-220 ease-out hover:translate-x-0 focus-visible:translate-x-0',
        'focus-visible:outline-3 focus-visible:outline-primary-ring',
      )}
      /* eslint-disable-next-line react/forbid-dom-props -- worked out from the edge's free stretch. */
      style={{ top, height }}
      onClick={show}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          show();
        }
      }}
    >
      <VendorLogo
        vendor={
          vendor.data ?? { name: app.title, logo: undefined, color: undefined, logoPadding: 0 }
        }
        size={22}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-ui-sm font-medium text-foreground">{app.title}</span>
        <span className="text-caption text-foreground-subtle">
          {t('appWindows.hidden', 'Hidden')}
        </span>
      </span>
    </button>
  );
}

/**
 * The signed-in frame: the rail, and whatever page is open beside it - or, at an address no page
 * answers, a plain word that there is nothing there.
 */
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { Sidebar } from '@/components/sidebar';
import { useLiveChannel } from '@/live/use-live-channel';

/**
 * Renders the page for an address no page answers.
 *
 * @returns The page.
 */
export function PagePlaceholder() {
  const { t } = useTranslation();

  return (
    <div className="flex grow flex-col">
      <header className="shrink-0 px-8 pt-7">
        <h1 className="text-display font-medium">{t('shell.notFound.title', 'Nothing here')}</h1>
      </header>

      <div className="flex grow items-center justify-center p-6">
        <div className="flex max-w-md flex-col gap-3 rounded-panel border border-dashed border-border-strong p-8 text-center">
          <p className="text-title text-foreground-muted">
            {t('shell.notFound.summary', 'No page is registered for this address.')}
          </p>
          <p className="text-caption text-foreground-subtle">
            {t('shell.notFound.hint', 'Pick a page from the rail on the left.')}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the signed-in frame.
 *
 * `relative overflow-hidden` is the general form of a bug the settings section found: an
 * absolutely positioned descendant with no positioned ancestor is laid out against the document
 * and clipped by nothing, so one stray hidden label anywhere inside can give the window a
 * scrollbar the page does not want. The frame is exactly one viewport tall by design, and this
 * says so in a way that holds for whatever gets built inside it.
 *
 * The live channel is opened here, once, for every page inside: it is one socket per tab by
 * design, and the shell is the one component that is mounted for exactly as long as somebody is
 * signed in.
 *
 * @returns The shell.
 */
export function Shell() {
  useLiveChannel();

  return (
    <div className="relative flex h-screen overflow-hidden bg-canvas text-foreground">
      <Sidebar />
      <Outlet />
    </div>
  );
}

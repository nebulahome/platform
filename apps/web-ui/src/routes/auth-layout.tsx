/**
 * The frame the three unauthenticated screens share.
 *
 * One card, centred, with the mark above it. Nothing else on the page: this is the only screen
 * where a person has exactly one thing to do, and anything else competing for attention is in
 * the way.
 */
import { Logo } from '@nebula-home/ui';
import type { ReactNode } from 'react';

/** What the frame needs. */
export type AuthLayoutProps = {
  /** The heading inside the card. */
  readonly title: string;

  /** The line under it. */
  readonly subtitle: string;

  /** The form. */
  readonly children: ReactNode;

  /** Anything below the card, such as a way back. */
  readonly footer?: ReactNode;
};

/**
 * Renders the frame.
 *
 * @param props - See {@link AuthLayoutProps}.
 * @returns The page.
 */
export function AuthLayout(props: AuthLayoutProps) {
  const { title, subtitle, children, footer } = props;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="flex w-full max-w-[400px] flex-col gap-7">
        <div className="flex items-center justify-center gap-3">
          <Logo size={30} />
          <span className="text-lg font-medium tracking-tight">Nebula</span>
        </div>

        <div className="flex flex-col gap-6 rounded-[18px] border border-border bg-surface p-7">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-medium tracking-tight">{title}</h1>
            <p className="text-[13px] text-foreground-subtle">{subtitle}</p>
          </div>

          {children}
        </div>

        {footer === undefined ? null : (
          <div className="text-center text-xs text-foreground-subtle">{footer}</div>
        )}
      </div>
    </main>
  );
}

/**
 * The circle that stands in for a person: their picture, or their initials.
 *
 * Initials are the default rather than a placeholder silhouette, because they carry information.
 * A row of identical grey heads tells you nothing about which one is Giulia; `GR` does, and it
 * is the same two letters every time, so a list is scannable before anybody has uploaded
 * anything.
 *
 * The image is decorative here and marked as such. The name is always beside it in the places
 * this is used - a row, a card, the rail - so an `alt` repeating it would make a screen reader
 * say it twice.
 *
 * The sizes are a fixed set rather than a number, because RULES.md 15 does not allow an inline
 * style and a class cannot be built from an arbitrary one. Three is what the interface uses.
 */
import { cn } from '@nebulahome/ui';

import { toInitials } from '@/lib/initials';

/** How large an avatar is drawn. */
export type AvatarSize = 'small' | 'medium' | 'large';

/** The classes for each size: the circle, then the initials inside it. */
const SIZES: Readonly<Record<AvatarSize, string>> = {
  /** In a table row or the rail. */
  small: 'size-8 text-ui',

  /** On the profile card. */
  medium: 'size-13 text-head',

  /** In the dialog where a picture is chosen, where it is the subject rather than a label. */
  large: 'size-22 text-2xl',
};

/** What an avatar needs. */
export type AvatarProps = {
  /** The name, which the initials come from. */
  readonly displayName: string;

  /** Their picture as a `data:` URL, or null when they have not set one. */
  readonly avatarUrl?: string | null | undefined;

  /** How large. Defaults to the size used in rows. */
  readonly size?: AvatarSize;

  /** Whether it uses the accent colour rather than a neutral one. For the signed-in person. */
  readonly isAccented?: boolean;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders an avatar.
 *
 * @param props - See {@link AvatarProps}.
 * @returns The circle.
 */
export function Avatar(props: AvatarProps) {
  const { displayName, avatarUrl, size = 'small', isAccented = false, className } = props;

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium',
        SIZES[size],
        isAccented
          ? 'bg-primary text-primary-foreground'
          : 'bg-surface-raised text-foreground-muted',
        className,
      )}
    >
      {avatarUrl == null ? (
        toInitials(displayName)
      ) : (
        <img src={avatarUrl} alt="" className="size-full object-cover" />
      )}
    </span>
  );
}

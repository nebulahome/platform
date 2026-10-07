/**
 * A listing's logo in an install dialog: the Community Hub's, relayed by the API, or a monogram in
 * its colour.
 */
import { catalogueLogoUrl } from '@/packages/api';
import { VendorLogo } from '@/routes/library/vendor-card';

/** What the logo needs. */
export type ListingLogoProps = {
  readonly listing: {
    readonly name: string;

    /** `#rrggbb`, the monogram's colour; null for the accent. */
    readonly color: string | null;

    /** The logo's SHA-256 at the Hub; null when it has none. */
    readonly logo: string | null;
  };

  /** The side of the square, in pixels. */
  readonly size: number;
};

/**
 * Renders a listing's logo.
 *
 * @param props - See {@link ListingLogoProps}.
 * @returns The logo.
 */
export function ListingLogo(props: ListingLogoProps) {
  const { listing, size } = props;
  const logo = catalogueLogoUrl(listing.logo);

  return (
    <VendorLogo
      vendor={{
        name: listing.name,
        logoPadding: 0,
        ...(listing.color === null ? {} : { color: listing.color }),
        ...(logo === undefined ? {} : { logo }),
      }}
      size={size}
    />
  );
}

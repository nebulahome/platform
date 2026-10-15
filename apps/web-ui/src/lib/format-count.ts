/**
 * Counts as a person reads them in a list: `1.2M`, `34k`, `7`.
 */
import { numberFormat } from '@/i18n/formatters';

/**
 * A count written short: `1.2M`, `34k`.
 *
 * @param count - The count.
 * @returns It, short.
 */
export function shortCount(count: number): string {
  return numberFormat({ notation: 'compact', maximumFractionDigits: 1 }).format(count);
}

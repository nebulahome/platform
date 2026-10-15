/**
 * Sizes, rates and spans of time, as a person reads them.
 *
 * Decimal units - a kilobyte is a thousand bytes - because that is what a disk is sold in and
 * what the network entities carry (`B/s`), so the figure on the page and the one in an
 * automation agree. One decimal place below a hundred and none above: "1.9 GB" and "240 GB"
 * both read at a glance, where "240.3 GB" only adds a digit nobody acts on.
 */
import { numberFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';

/** The steps of the scale, each a thousand times the last. */
const UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * Scales a count of bytes to the largest unit it fills at least one of.
 *
 * @param bytes - The count.
 * @returns The number and the unit it is in.
 */
function scaled(bytes: number): { readonly value: number; readonly unit: string } {
  let value = Math.max(0, bytes);
  let step = 0;

  while (value >= 1000 && step < UNITS.length - 1) {
    value /= 1000;
    step += 1;
  }

  return { value, unit: UNITS[step] ?? 'B' };
}

/**
 * Writes a number with one decimal below a hundred, none above, and none for whole bytes.
 *
 * @param value - The number.
 * @param unit - Its unit.
 * @returns The digits.
 */
function digits(value: number, unit: string): string {
  const places = unit === 'B' || value >= 100 ? 0 : 1;

  return numberFormat({ minimumFractionDigits: places, maximumFractionDigits: places }).format(
    value,
  );
}

/**
 * Writes a size.
 *
 * @param bytes - The count of bytes.
 * @returns `1.9 GB`, `240 GB`, `512 B`.
 */
export function formatBytes(bytes: number): string {
  const { value, unit } = scaled(bytes);

  return `${digits(value, unit)} ${unit}`;
}

/**
 * Writes a rate.
 *
 * @param bytesPerSecond - The rate, or null when there is none to give.
 * @returns `1.2 MB/s`, or a dash when there is no rate.
 */
export function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) {
    return '—';
  }

  const { value, unit } = scaled(bytesPerSecond);

  return `${digits(value, unit)} ${unit}/s`;
}

/**
 * Writes a share as a whole percentage.
 *
 * @param percent - The share, 0 to 100, or null when there is none.
 * @returns `23%`, or a dash.
 */
export function formatPercent(percent: number | null): string {
  return percent === null ? '—' : `${String(Math.round(percent))}%`;
}

/**
 * Writes a slice of a whole as a whole percentage, without calling a real slice nothing.
 *
 * @param fraction - The slice, 0 to 1.
 * @returns `64%`, or `<1%` for a slice too thin to round to one - 2 GB of backups on a 500 GB
 * disk is there, and "0%" would say it is not.
 */
export function formatShare(fraction: number): string {
  const percent = fraction * 100;

  return percent > 0 && percent < 0.5 ? '<1%' : formatPercent(percent);
}

/**
 * Writes how long something has been up, in its two largest units.
 *
 * @param seconds - The span.
 * @returns `3 d 4 h`, `5 h 12 min`, `12 min`, `under a minute`.
 */
export function formatUptime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return translate('time.short.daysHours', '{{days}} d {{hours}} h', {
      days,
      hours: hours % 24,
    });
  }

  if (hours > 0) {
    return translate('time.short.hoursMinutes', '{{hours}} h {{minutes}} min', {
      hours,
      minutes: minutes % 60,
    });
  }

  return minutes > 0
    ? translate('time.short.minutes', '{{minutes}} min', { minutes })
    : translate('time.underMinute', 'under a minute');
}

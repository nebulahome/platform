import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names, letting later classes win over conflicting earlier ones.
 *
 * Plain string concatenation cannot do this: `"p-2 p-4"` leaves both classes in the DOM and the
 * winner depends on stylesheet order rather than on call order.
 *
 * @param inputs - Class values, in the shape clsx accepts.
 * @returns A single class string with Tailwind conflicts resolved.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

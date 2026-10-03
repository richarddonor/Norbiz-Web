import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Transaction lines in the order the user entered them (the backend's `lineNumber`).
 * Stable, so a split Purchase Receive line's repeated number keeps its parts together. */
export function byLineNumber<T extends { lineNumber: number }>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) => a.lineNumber - b.lineNumber)
}

import { randomBytes } from 'crypto'

/** URL-safe alphabet (no ambiguous 0/O/I/l). */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Generate an 8-char url-safe short code for share links. */
export function generateOwlSwapShortCode(length = 8): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length]!
  }
  return out
}

export function isValidOwlSwapShortCode(code: string): boolean {
  const t = code.trim()
  if (t.length < 6 || t.length > 16) return false
  return /^[A-Za-z0-9_-]+$/.test(t)
}

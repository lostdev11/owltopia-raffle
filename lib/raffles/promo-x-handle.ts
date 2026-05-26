export type PromoXHandleParseResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

/** Parse and normalize stored promo X handle (letters, numbers, underscore; max 15). */
export function parsePromoXHandleInput(raw: unknown): PromoXHandleParseResult {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null }
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Promo X handle must be a string' }
  }
  const t = raw.trim().replace(/^@+/, '')
  if (!t) {
    return { ok: true, value: null }
  }
  if (t.length > 15) {
    return { ok: false, error: 'X handle must be at most 15 characters' }
  }
  if (!/^[A-Za-z0-9_]+$/.test(t)) {
    return {
      ok: false,
      error: 'X handle may only contain letters, numbers, and underscores',
    }
  }
  return { ok: true, value: t }
}

export function formatPromoXHandleForShare(stored: string | null | undefined): string | null {
  const t = stored?.trim().replace(/^@+/, '')
  return t || null
}

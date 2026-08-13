/**
 * Permanent public redirects for raffle slugs we renamed away from phishing-shaped paths.
 *
 * Keys = deprecated public slug (may still be in Discord / old posts).
 * Values = canonical public slug.
 *
 * While the DB row still has the old slug, `getRaffleBySlug` resolves both.
 * After an admin renames the row to the canonical slug, old links still work via redirects.
 */
export const RAFFLE_SLUG_REDIRECTS: Readonly<Record<string, string>> = {
  'legendary-dumpster-14': 'dumpster-14',
}

export function normalizeRaffleSlugParam(slug: string): string {
  return slug.trim().toLowerCase()
}

/** Prefer the non-phishing public slug for canonical / share URLs. */
export function canonicalRaffleSlug(slug: string): string {
  const s = normalizeRaffleSlugParam(slug)
  return RAFFLE_SLUG_REDIRECTS[s] ?? s
}

/**
 * Ordered DB lookup candidates for a request slug.
 * Includes the requested slug, its redirect target, and any deprecated keys that map to it.
 */
export function raffleSlugStorageCandidates(slug: string): string[] {
  const s = normalizeRaffleSlugParam(slug)
  const out: string[] = []
  const push = (x: string) => {
    if (x && !out.includes(x)) out.push(x)
  }

  push(s)
  push(RAFFLE_SLUG_REDIRECTS[s] ?? '')
  for (const [from, to] of Object.entries(RAFFLE_SLUG_REDIRECTS)) {
    if (to === s) push(from)
  }
  return out
}

/** True when the URL slug should 308 to the canonical slug. */
export function raffleSlugNeedsRedirect(requestSlug: string): string | null {
  const s = normalizeRaffleSlugParam(requestSlug)
  const target = RAFFLE_SLUG_REDIRECTS[s]
  return target && target !== s ? target : null
}

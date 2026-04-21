/**
 * Council proposal URL slugs: optional on create (derived from title when omitted).
 */

const SLUG_MAX = 120

/** Normalize user-provided slug; returns null if empty or invalid pattern after cleanup. */
export function normalizeCouncilSlugInput(raw: string): string | null {
  const t = raw.trim().toLowerCase()
  if (!t) return null
  const s = t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX)
  if (!s || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return null
  return s
}

function slugifyTitleCore(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** Default slug when the creator does not supply one: title-based + random suffix (collision-resistant). */
export function suggestCouncilProposalSlugFromTitle(title: string): string {
  const core = slugifyTitleCore(title)
  const base = core && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(core) ? core : 'proposal'
  const suffix = Math.random().toString(36).slice(2, 8)
  let out = `${base}-${suffix}`.replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!out) out = `proposal-${suffix}`
  return out.slice(0, SLUG_MAX)
}

export function resolveCouncilProposalCreateSlug(
  slugInput: string | undefined,
  title: string
): { ok: true; slug: string } | { ok: false; message: string } {
  const trimmed = slugInput?.trim()
  if (trimmed) {
    const normalized = normalizeCouncilSlugInput(trimmed)
    if (!normalized) {
      return {
        ok: false,
        message: 'Custom URL: use lowercase letters, numbers, and hyphens only (e.g. treasury-roadmap).',
      }
    }
    return { ok: true, slug: normalized }
  }
  return { ok: true, slug: suggestCouncilProposalSlugFromTitle(title) }
}

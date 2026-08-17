/**
 * Owl Center launch URL slugs — kebab-case collection names for mint/share links.
 * Opaque `sub-<uuid>` slugs are a legacy submission format.
 */

export const OWL_CENTER_LAUNCH_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Matches creator-submission slugs: `sub-` + 32 hex chars (UUID without dashes). */
export const OPAQUE_OWL_CENTER_LAUNCH_SLUG_RE = /^sub-[0-9a-f]{32}$/

const SLUG_MAX = 64
/** Leave room for `-{n}` uniqueness suffixes. */
const SLUG_BASE_MAX = 56

/**
 * Path segments and flagship slugs that must not be used as collection mint URLs.
 * `gen2` is the Owltopia Gen2 launch; the rest collide with Owl Center app routes.
 */
export const OWL_CENTER_RESERVED_LAUNCH_SLUGS = new Set([
  'gen2',
  'collection',
  'collections',
  'launch',
  'launches',
  'generator',
  'drops',
  'my-launches',
  'presale',
  'admin',
  'm',
  'owl-center',
  'owltopia',
])

export function isValidOwlCenterLaunchSlug(slug: string): boolean {
  return OWL_CENTER_LAUNCH_SLUG_RE.test(slug) && !OWL_CENTER_RESERVED_LAUNCH_SLUGS.has(slug)
}

export function isOpaqueOwlCenterLaunchSlug(slug: string): boolean {
  return OPAQUE_OWL_CENTER_LAUNCH_SLUG_RE.test(slug)
}

/** URL param for public collection APIs. Rejects empty, malformed, and the flagship `gen2` slug. */
export function parseOwlCenterCollectionSlugParam(raw: string | undefined): string | null {
  const slug = raw?.trim().toLowerCase() ?? ''
  if (!OWL_CENTER_LAUNCH_SLUG_RE.test(slug) || slug === 'gen2') return null
  return slug
}

function collapseHyphens(slug: string): string {
  return slug.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
}

/** Collection name → kebab slug (no uniqueness). Empty / reserved names become `collection`. */
export function slugifyOwlCenterLaunchName(name: string): string {
  const core = collapseHyphens(
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
  ).slice(0, SLUG_BASE_MAX)

  if (!core || !OWL_CENTER_LAUNCH_SLUG_RE.test(core) || OWL_CENTER_RESERVED_LAUNCH_SLUGS.has(core)) {
    return 'collection'
  }
  return core
}

function withNumericSuffix(base: string, n: number): string {
  const suffix = `-${n}`
  const trimmed = base.slice(0, Math.max(1, SLUG_MAX - suffix.length))
  return collapseHyphens(`${trimmed}${suffix}`).slice(0, SLUG_MAX)
}

/**
 * Pick a unique slug from a kebab base against an in-memory taken set
 * (launch slugs + aliases). Reserved names such as `gen2` are never returned.
 */
export function allocateUniqueLaunchSlug(base: string, taken: ReadonlySet<string>): string {
  const cleaned = slugifyOwlCenterLaunchName(base)
  if (!taken.has(cleaned) && isValidOwlCenterLaunchSlug(cleaned)) return cleaned

  for (let n = 2; n <= 1000; n++) {
    const candidate = withNumericSuffix(cleaned, n)
    if (!taken.has(candidate) && isValidOwlCenterLaunchSlug(candidate)) return candidate
  }

  const fallback = withNumericSuffix(cleaned, Date.now() % 1_000_000)
  if (isValidOwlCenterLaunchSlug(fallback) && !taken.has(fallback)) return fallback
  return withNumericSuffix('collection', Date.now() % 1_000_000)
}

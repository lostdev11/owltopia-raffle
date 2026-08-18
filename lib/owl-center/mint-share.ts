/** Canonical mint page paths for Owl Center share links. */

/** Full mint page path (where the mint UI + OG metadata live). */
export function mintCanonicalPath(slug: string): string {
  return `/owl-center/collection/${encodeURIComponent(slug)}`
}

/** Legacy `/m/<slug>` redirect path. Kept so old short links still resolve. */
export function mintShortPath(slug: string): string {
  return `/m/${encodeURIComponent(slug)}`
}

/** Absolute official mint URL for copy/share — full owl-center path, not `/m/…`. */
export function mintCanonicalUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, '')}${mintCanonicalPath(slug)}`
}

/** Canonical + shortened share paths for an Owl Center mint page. */

/** Full mint page path (where the mint UI + OG metadata live). */
export function mintCanonicalPath(slug: string): string {
  return `/owl-center/collection/${encodeURIComponent(slug)}`
}

/** Short, shareable path (redirects to the canonical mint page). */
export function mintShortPath(slug: string): string {
  return `/m/${encodeURIComponent(slug)}`
}

/** Absolute short URL for copy/share, given an origin (e.g. window.location.origin). */
export function mintShortUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, '')}${mintShortPath(slug)}`
}

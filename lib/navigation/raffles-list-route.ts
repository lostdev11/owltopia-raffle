/**
 * True on the public raffle **list** page (`/raffles`), not on `/raffles/[slug]`,
 * `/admin/raffles`, etc.
 *
 * Uses both pathname and layout segments so the UI stays in sync even when one
 * source is briefly stale during navigation/hydration.
 */
export function isPublicRafflesListRoute(
  pathname: string | null | undefined,
  layoutSegmentsBelowRoot: readonly string[]
): boolean {
  if (pathname != null && pathname !== '') {
    const normalized = pathname.replace(/\/+$/, '') || '/'
    if (normalized === '/raffles') return true
  }
  const segs = layoutSegmentsBelowRoot
  return segs.length === 1 && segs[0] === 'raffles'
}

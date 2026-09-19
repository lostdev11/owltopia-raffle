/**
 * Decide whether the address bar drifted from the App Router pathname.
 * Returns the URL to write via replaceClientUrl, or null when already in sync.
 *
 * When the path drifted, drop the browser hash — it belonged to the previous page.
 * Search comes from the router (current page), not the stale address bar.
 */
export function buildSyncedBrowserUrl(opts: {
  routerPathname: string
  /** Search string without leading `?` (from useSearchParams().toString()). */
  routerSearch: string
  browserPathname: string
}): string | null {
  if (opts.browserPathname === opts.routerPathname) return null
  const qs = opts.routerSearch
  return qs ? `${opts.routerPathname}?${qs}` : opts.routerPathname
}

/** Absolute path + hash so shallow updates never attach a hash to a stale path. */
export function buildPathHashUrl(pathname: string, hashId: string): string {
  const id = hashId.replace(/^#/, '')
  return `${pathname}#${id}`
}

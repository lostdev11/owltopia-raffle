/**
 * Shallow-update the browser URL without fighting the App Router.
 *
 * Next.js patches `history.replaceState`. When the data argument lacks `__NA`
 * (e.g. `null` or `{}`), the patch copies internals *and* dispatches
 * `ACTION_RESTORE` via `startTransition`. That restore can race a concurrent
 * `<Link>` / `router.push` navigation and leave the address bar on the previous
 * path while the new page is showing — so copy-link / share copies the wrong URL.
 *
 * Passing the current `history.state` (which already has `__NA`) takes Next's
 * early path: URL updates, no restore action.
 *
 * Prefer `router.replace` / `router.push` when the change should participate in
 * React navigation. Use this helper for shallow cleanup (strip OAuth params,
 * set a hash, etc.). For hash updates, pass an absolute `pathname#id` (see
 * `buildPathHashUrl`) so a drifted address bar cannot keep the previous path.
 */
export function replaceClientUrl(url: string): void {
  if (typeof window === 'undefined') return
  const { history } = window
  if (typeof history.replaceState !== 'function') return
  history.replaceState(history.state, '', url)
}

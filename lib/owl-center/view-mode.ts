export type OwlCenterViewMode = 'public' | 'admin'

export const OWL_CENTER_VIEW_MODE_STORAGE_KEY = 'owl-center-view-mode'

/** Holder-facing landing when launchpad hub / sub-nav are hidden. */
export const OWL_CENTER_HOLDER_HOME = '/owl-center/collection/gen2'

export const OWL_CENTER_ADMIN_ONLY_PATH_PREFIXES = [
  '/owl-center/generator',
  '/owl-center/launch',
] as const

export function isOwlCenterAdminOnlyPath(pathname: string): boolean {
  return OWL_CENTER_ADMIN_ONLY_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export function readStoredOwlCenterViewMode(): OwlCenterViewMode {
  if (typeof window === 'undefined') return 'public'
  try {
    const stored = localStorage.getItem(OWL_CENTER_VIEW_MODE_STORAGE_KEY)
    return stored === 'admin' ? 'admin' : 'public'
  } catch {
    return 'public'
  }
}

export function writeStoredOwlCenterViewMode(mode: OwlCenterViewMode): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(OWL_CENTER_VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    /* ignore quota / private mode */
  }
}

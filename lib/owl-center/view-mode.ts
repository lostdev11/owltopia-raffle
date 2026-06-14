export type OwlCenterViewMode = 'public' | 'admin'

export const OWL_CENTER_VIEW_MODE_STORAGE_KEY = 'owl-center-view-mode'

/** Default Owl Center landing for visitors and non-admin redirects. */
export const OWL_CENTER_HOLDER_HOME = '/owl-center'

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
  return readStoredOwlCenterViewModeOrNull() ?? 'public'
}

/** `null` when the admin has not chosen a preference in this browser yet. */
export function readStoredOwlCenterViewModeOrNull(): OwlCenterViewMode | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = localStorage.getItem(OWL_CENTER_VIEW_MODE_STORAGE_KEY)
    if (stored === 'admin' || stored === 'public') return stored
    return null
  } catch {
    return null
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

export const OWL_RACE_DEFAULT_MINT =
  'JA2gZuhy83CD71xQNMJCMHvTvhxFnVFerw5dYiyFkAfM'

export const OWL_RACE_DEFAULT_COLLECTIONS = [
  'GkLgT4KuwAPKeMSzfcPPmzuGimRNPvK1FWNPks4kzFVA',
  'CLbUSk7m4wjwzom7xD9HRwtfkAoUB1BfwAXRnaY8ANmg',
] as const

export type RaceAccessMode = 'off' | 'admin' | 'public'

function parseRaceAccessMode(value: string | undefined): RaceAccessMode {
  if (value === 'off' || value === 'admin' || value === 'public') return value
  return process.env.NODE_ENV === 'development' ? 'public' : 'off'
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export const RACE_ACCESS_MODE = parseRaceAccessMode(
  process.env.NEXT_PUBLIC_RACE_ACCESS_MODE
)

export const RACE_OWL_MINT =
  process.env.NEXT_PUBLIC_OWL_MINT_ADDRESS?.trim() || OWL_RACE_DEFAULT_MINT

const configuredCollections = parseCsv(
  process.env.NEXT_PUBLIC_RACE_ELIGIBLE_COLLECTIONS
)

export const RACE_ELIGIBLE_COLLECTIONS =
  configuredCollections.length > 0
    ? configuredCollections
    : [...OWL_RACE_DEFAULT_COLLECTIONS]

export const RACE_DEFAULT_COURSE_ID =
  process.env.NEXT_PUBLIC_RACE_DEFAULT_COURSE_ID?.trim() || 'forest-run-01'

export const RACE_DEFAULT_SEASON_ID =
  process.env.NEXT_PUBLIC_RACE_DEFAULT_SEASON_ID?.trim() || 'preseason-01'

export function isRacePublic(): boolean {
  return RACE_ACCESS_MODE === 'public'
}

export function canAdminPreviewRace(isAdmin: boolean): boolean {
  return RACE_ACCESS_MODE === 'admin' && isAdmin
}

export function shouldShowRaceNavigation(isAdmin: boolean): boolean {
  return isRacePublic() || canAdminPreviewRace(isAdmin)
}

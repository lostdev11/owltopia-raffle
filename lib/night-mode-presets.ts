import type { ThemeAccent } from './types'

export interface NightModePreset {
  name: string
  label: string
  description: string
  themeAccent: ThemeAccent
  getEndTime: () => Date
}

/**
 * Get end time for Midnight Drop (12:00 AM local)
 */
function getMidnightDropTime(): Date {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  return tomorrow
}

/**
 * Get end time for Dawn Run (6:00 AM local)
 */
function getDawnRunTime(): Date {
  const now = new Date()
  const target = new Date(now)
  target.setHours(6, 0, 0, 0)
  if (target <= now) {
    target.setDate(target.getDate() + 1)
  }
  return target
}

/**
 * Get end time for Prime Time (9:00 PM local)
 */
function getPrimeTimeTime(): Date {
  const now = new Date()
  const target = new Date(now)
  target.setHours(21, 0, 0, 0)
  if (target <= now) {
    target.setDate(target.getDate() + 1)
  }
  return target
}

export const NIGHT_MODE_PRESETS: NightModePreset[] = [
  {
    name: 'midnight',
    label: 'Midnight Drop',
    description: 'Ends at 12:00 AM',
    themeAccent: 'midnight',
    getEndTime: getMidnightDropTime,
  },
  {
    name: 'dawn',
    label: 'Dawn Run',
    description: 'Ends at 6:00 AM',
    themeAccent: 'dawn',
    getEndTime: getDawnRunTime,
  },
  {
    name: 'prime',
    label: 'Prime Time',
    description: 'Ends at 9:00 PM',
    themeAccent: 'prime',
    getEndTime: getPrimeTimeTime,
  },
]

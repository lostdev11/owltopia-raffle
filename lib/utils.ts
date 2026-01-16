import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format } from 'date-fns'

/**
 * Converts a UTC ISO string (from database) to a local datetime-local input value
 * datetime-local inputs expect format: YYYY-MM-DDTHH:mm (in local timezone, no timezone info)
 */
export function utcToLocalDateTime(utcIsoString: string): string {
  const date = new Date(utcIsoString)
  // Get local time components
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

/**
 * Converts a datetime-local input value (in user's local timezone) to UTC ISO string
 * datetime-local inputs provide values in local timezone without timezone info
 */
export function localDateTimeToUtc(localDateTimeString: string): string {
  // Create a date in the user's local timezone
  const localDate = new Date(localDateTimeString)
  // Convert to ISO string (which is in UTC)
  return localDate.toISOString()
}

/**
 * Formats a UTC ISO string to display in the user's local timezone
 * Returns a formatted string like "Jan 15, 2024 at 3:30 PM"
 */
export function formatDateTimeLocal(utcIsoString: string, includeTime: boolean = true): string {
  const date = new Date(utcIsoString)
  if (includeTime) {
    return format(date, 'PPp') // e.g., "Jan 15, 2024, 3:30 PM"
  }
  return format(date, 'PP') // e.g., "Jan 15, 2024"
}

/**
 * Formats a UTC ISO string to display with timezone info
 * Returns a formatted string like "Jan 15, 2024 at 3:30 PM PST"
 */
export function formatDateTimeWithTimezone(utcIsoString: string): string {
  const date = new Date(utcIsoString)
  const timezoneName = new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop() || ''
  
  return `${format(date, 'PPp')} ${timezoneName}`
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

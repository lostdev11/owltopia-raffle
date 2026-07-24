import type { AdminRole } from '@/lib/db/admins'

/** Any Owl Vision admin (junior mod or full). */
export function isAnyAdminRole(role: string | null | undefined): role is AdminRole {
  return role === 'mod' || role === 'full'
}

/** Full Owl Vision — refunds, winners, prize moves, irreversible ops. */
export function isFullAdminRole(role: string | null | undefined): role is 'full' {
  return role === 'full'
}

/** Junior mod or full — support tools, comms, diagnostics. */
export function isModOrAboveRole(role: string | null | undefined): boolean {
  return role === 'mod' || role === 'full'
}

/** Normalize DB/API role strings; unknown values are rejected. */
export function parseAdminRole(role: unknown): AdminRole | null {
  if (role === 'mod' || role === 'full') return role
  return null
}

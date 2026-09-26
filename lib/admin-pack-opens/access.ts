import type { AdminRole } from '@/lib/db/admins'
import { isFullAdminRole, isModOrAboveRole } from '@/lib/admin/roles'

/** GET /api/admin/pack-opens — mod + full (same gate as Ops Log list). */
export function canReadAdminPackOpens(role: AdminRole | null | undefined): boolean {
  return isModOrAboveRole(role)
}

/** POST /api/admin/packs/resolve-open and other pack mutations — full only. */
export function canMutatePackOpensAdmin(role: AdminRole | null | undefined): boolean {
  return isFullAdminRole(role)
}

export type AdminPackOpensHttpAuthResult =
  | { allowed: true; role: AdminRole }
  | { allowed: false; status: 401 | 403; reason: 'no_session' | 'not_admin' }

/**
 * Pure helper mirroring list-route auth: session present + mod/full role.
 * Route handlers still call requireAdminSession; tests use this for matrix coverage.
 */
export function evaluateAdminPackOpensReadAccess(input: {
  hasSession: boolean
  role: AdminRole | null | undefined
}): AdminPackOpensHttpAuthResult {
  if (!input.hasSession) return { allowed: false, status: 401, reason: 'no_session' }
  if (!canReadAdminPackOpens(input.role)) {
    return { allowed: false, status: 403, reason: 'not_admin' }
  }
  return { allowed: true, role: input.role as AdminRole }
}

export function evaluatePackOpenResolveAccess(input: {
  hasSession: boolean
  role: AdminRole | null | undefined
}): AdminPackOpensHttpAuthResult {
  if (!input.hasSession) return { allowed: false, status: 401, reason: 'no_session' }
  if (!canMutatePackOpensAdmin(input.role)) {
    return { allowed: false, status: 403, reason: 'not_admin' }
  }
  return { allowed: true, role: input.role as AdminRole }
}

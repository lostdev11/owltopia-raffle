import type { AdminRole } from '@/lib/db/admins'
import { isFullAdminRole, isModOrAboveRole } from '@/lib/admin/roles'

/** Ops Log list + entry/payment mutations — mod + full (same as existing ops-log routes). */
export function canUseAdminOpsLog(role: AdminRole | null | undefined): boolean {
  return isModOrAboveRole(role)
}

export function canDeleteAdminOpsLogEntry(role: AdminRole | null | undefined): boolean {
  return isFullAdminRole(role)
}

export function evaluateAdminOpsLogAccess(input: {
  hasSession: boolean
  role: AdminRole | null
}): { allowed: boolean; status: 401 | 403; reason: string } {
  if (!input.hasSession) {
    return { allowed: false, status: 401, reason: 'no_session' }
  }
  if (!canUseAdminOpsLog(input.role)) {
    return { allowed: false, status: 403, reason: 'not_admin' }
  }
  return { allowed: true, status: 401, reason: 'ok' }
}

export function evaluateAdminOpsLogDeleteAccess(input: {
  hasSession: boolean
  role: AdminRole | null
}): { allowed: boolean; status: 401 | 403; reason: string } {
  if (!input.hasSession) {
    return { allowed: false, status: 401, reason: 'no_session' }
  }
  if (!canDeleteAdminOpsLogEntry(input.role)) {
    return { allowed: false, status: 403, reason: 'not_full_admin' }
  }
  return { allowed: true, status: 401, reason: 'ok' }
}

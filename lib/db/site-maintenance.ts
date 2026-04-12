import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'

const ROW_ID = 'default'

export interface SiteMaintenanceRow {
  id: string
  starts_at: string | null
  ends_at: string | null
  message: string | null
  updated_at: string
  updated_by_wallet: string | null
}

export function evaluateMaintenanceWindow(
  nowMs: number,
  startsAt: string | null,
  endsAt: string | null
): { publicActive: boolean; scheduled: boolean } {
  if (!startsAt || !endsAt) {
    return { publicActive: false, scheduled: false }
  }
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return { publicActive: false, scheduled: false }
  }
  if (nowMs < start) return { publicActive: false, scheduled: true }
  if (nowMs >= start && nowMs < end) return { publicActive: true, scheduled: false }
  return { publicActive: false, scheduled: false }
}

export async function getSiteMaintenance(): Promise<SiteMaintenanceRow | null> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('site_maintenance')
    .select('id, starts_at, ends_at, message, updated_at, updated_by_wallet')
    .eq('id', ROW_ID)
    .maybeSingle()

  if (error || !data) return null
  return {
    id: data.id,
    starts_at: data.starts_at ?? null,
    ends_at: data.ends_at ?? null,
    message: data.message ?? null,
    updated_at: data.updated_at ?? new Date().toISOString(),
    updated_by_wallet: data.updated_by_wallet ?? null,
  }
}

function rowFromData(data: Record<string, unknown>): SiteMaintenanceRow {
  return {
    id: String(data.id),
    starts_at: (data.starts_at as string) ?? null,
    ends_at: (data.ends_at as string) ?? null,
    message: (data.message as string) ?? null,
    updated_at: (data.updated_at as string) ?? new Date().toISOString(),
    updated_by_wallet: (data.updated_by_wallet as string) ?? null,
  }
}

/**
 * Clear window (public site never gated from this row).
 */
export async function clearSiteMaintenance(wallet: string): Promise<SiteMaintenanceRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('site_maintenance')
    .update({
      starts_at: null,
      ends_at: null,
      message: null,
      updated_by_wallet: wallet,
    })
    .eq('id', ROW_ID)
    .select('id, starts_at, ends_at, message, updated_at, updated_by_wallet')
    .single()

  if (error) {
    console.error('clearSiteMaintenance', error)
    return null
  }
  if (!data) return null
  return rowFromData(data as Record<string, unknown>)
}

/**
 * Set maintenance window (ISO timestamps).
 */
export async function setSiteMaintenanceWindow(input: {
  starts_at: string
  ends_at: string
  message?: string | null
  wallet: string
}): Promise<SiteMaintenanceRow | null> {
  const start = new Date(input.starts_at)
  const end = new Date(input.ends_at)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid date')
  }
  if (end.getTime() <= start.getTime()) {
    throw new Error('End time must be after start time')
  }

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('site_maintenance')
    .update({
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      message: input.message?.trim() ? input.message.trim() : null,
      updated_by_wallet: input.wallet,
    })
    .eq('id', ROW_ID)
    .select('id, starts_at, ends_at, message, updated_at, updated_by_wallet')
    .single()

  if (error) {
    console.error('setSiteMaintenanceWindow', error)
    return null
  }
  if (!data) return null
  return rowFromData(data as Record<string, unknown>)
}

/**
 * Shorten window so it ends now (keeps starts_at). No-op if row has no window.
 */
export async function endSiteMaintenanceEarly(wallet: string): Promise<SiteMaintenanceRow | null> {
  const current = await getSiteMaintenance()
  if (!current?.starts_at || !current?.ends_at) return current

  const db = getSupabaseAdmin()
  const nowIso = new Date().toISOString()
  const { data, error } = await db
    .from('site_maintenance')
    .update({
      ends_at: nowIso,
      updated_by_wallet: wallet,
    })
    .eq('id', ROW_ID)
    .select('id, starts_at, ends_at, message, updated_at, updated_by_wallet')
    .single()

  if (error) {
    console.error('endSiteMaintenanceEarly', error)
    return null
  }
  if (!data) return null
  return rowFromData(data as Record<string, unknown>)
}

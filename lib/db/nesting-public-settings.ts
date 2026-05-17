import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'

const ROW_ID = 'default'

export interface NestingPublicSettingsRow {
  id: string
  landing_public: boolean
  nesting_operations_paused: boolean
  updated_at: string
  updated_by_wallet: string | null
}

export async function getNestingPublicSettings(): Promise<NestingPublicSettingsRow | null> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('nesting_public_settings')
    .select('id, landing_public, nesting_operations_paused, updated_at, updated_by_wallet')
    .eq('id', ROW_ID)
    .maybeSingle()

  if (error || !data) return null
  return {
    id: data.id,
    landing_public: Boolean(data.landing_public),
    nesting_operations_paused: Boolean((data as { nesting_operations_paused?: boolean }).nesting_operations_paused),
    updated_at: data.updated_at ?? new Date().toISOString(),
    updated_by_wallet: data.updated_by_wallet ?? null,
  }
}

/**
 * When no settings row exists yet (pre-migration or empty DB), treat the landing as public
 * so `/nesting` is not accidentally hidden. Admins can still turn it off once the row exists.
 */
export async function isNestingLandingPublic(): Promise<boolean> {
  const row = await getNestingPublicSettings()
  if (!row) return true
  return row.landing_public === true
}

export async function setNestingLandingPublic(input: {
  landing_public: boolean
  wallet: string
}): Promise<NestingPublicSettingsRow | null> {
  return patchNestingPublicSettings({
    landing_public: input.landing_public,
    wallet: input.wallet,
  })
}

export async function patchNestingPublicSettings(input: {
  wallet: string
  landing_public?: boolean
  nesting_operations_paused?: boolean
}): Promise<NestingPublicSettingsRow | null> {
  const patch: Record<string, unknown> = { updated_by_wallet: input.wallet }
  if (typeof input.landing_public === 'boolean') {
    patch.landing_public = input.landing_public
  }
  if (typeof input.nesting_operations_paused === 'boolean') {
    patch.nesting_operations_paused = input.nesting_operations_paused
  }
  if (Object.keys(patch).length <= 1) {
    console.error('patchNestingPublicSettings: no fields to update')
    return null
  }

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('nesting_public_settings')
    .update(patch)
    .eq('id', ROW_ID)
    .select('id, landing_public, nesting_operations_paused, updated_at, updated_by_wallet')
    .single()

  if (error) {
    console.error('patchNestingPublicSettings', error)
    return null
  }
  if (!data) return null
  return {
    id: data.id,
    landing_public: Boolean(data.landing_public),
    nesting_operations_paused: Boolean((data as { nesting_operations_paused?: boolean }).nesting_operations_paused),
    updated_at: data.updated_at ?? new Date().toISOString(),
    updated_by_wallet: data.updated_by_wallet ?? null,
  }
}

/** True when the admin (or legacy row) has turned off live nesting operations. Missing row = not paused. */
export async function isNestingOperationsPausedInDb(): Promise<boolean> {
  const row = await getNestingPublicSettings()
  if (!row) return false
  return row.nesting_operations_paused === true
}

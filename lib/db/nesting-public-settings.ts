import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'

const ROW_ID = 'default'

export interface NestingPublicSettingsRow {
  id: string
  landing_public: boolean
  updated_at: string
  updated_by_wallet: string | null
}

export async function getNestingPublicSettings(): Promise<NestingPublicSettingsRow | null> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('nesting_public_settings')
    .select('id, landing_public, updated_at, updated_by_wallet')
    .eq('id', ROW_ID)
    .maybeSingle()

  if (error || !data) return null
  return {
    id: data.id,
    landing_public: Boolean(data.landing_public),
    updated_at: data.updated_at ?? new Date().toISOString(),
    updated_by_wallet: data.updated_by_wallet ?? null,
  }
}

/** Safe default when migration not applied yet. */
export async function isNestingLandingPublic(): Promise<boolean> {
  const row = await getNestingPublicSettings()
  return row?.landing_public === true
}

export async function setNestingLandingPublic(input: {
  landing_public: boolean
  wallet: string
}): Promise<NestingPublicSettingsRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('nesting_public_settings')
    .update({
      landing_public: input.landing_public,
      updated_by_wallet: input.wallet,
    })
    .eq('id', ROW_ID)
    .select('id, landing_public, updated_at, updated_by_wallet')
    .single()

  if (error) {
    console.error('setNestingLandingPublic', error)
    return null
  }
  if (!data) return null
  return {
    id: data.id,
    landing_public: Boolean(data.landing_public),
    updated_at: data.updated_at ?? new Date().toISOString(),
    updated_by_wallet: data.updated_by_wallet ?? null,
  }
}

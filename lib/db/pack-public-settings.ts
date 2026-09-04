import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'

const ROW_ID = 'default'

export type PackAccessMode = 'public' | 'restricted'

export type PackPublicSettingsRow = {
  id: string
  access_mode: PackAccessMode
  updated_at: string
  updated_by_wallet: string | null
}

function parseAccessMode(raw: unknown): PackAccessMode {
  return raw === 'public' ? 'public' : 'restricted'
}

export async function getPackPublicSettings(): Promise<PackPublicSettingsRow | null> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('pack_public_settings')
    .select('id, access_mode, updated_at, updated_by_wallet')
    .eq('id', ROW_ID)
    .maybeSingle()

  if (error || !data) return null
  return {
    id: data.id,
    access_mode: parseAccessMode(data.access_mode),
    updated_at: data.updated_at ?? new Date().toISOString(),
    updated_by_wallet: data.updated_by_wallet ?? null,
  }
}

/**
 * When no settings row exists yet, treat as restricted so production does not
 * accidentally go fully public before an admin chooses a launch mode.
 */
export async function getPackAccessMode(): Promise<PackAccessMode> {
  const row = await getPackPublicSettings()
  if (!row) return 'restricted'
  return row.access_mode
}

export async function isPacksAccessModePublic(): Promise<boolean> {
  return (await getPackAccessMode()) === 'public'
}

export async function setPackAccessMode(input: {
  access_mode: PackAccessMode
  wallet: string
}): Promise<PackPublicSettingsRow | null> {
  if (input.access_mode !== 'public' && input.access_mode !== 'restricted') {
    console.error('setPackAccessMode: invalid access_mode')
    return null
  }

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('pack_public_settings')
    .upsert(
      {
        id: ROW_ID,
        access_mode: input.access_mode,
        updated_by_wallet: input.wallet.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    .select('id, access_mode, updated_at, updated_by_wallet')
    .single()

  if (error) {
    console.error('setPackAccessMode', error)
    return null
  }
  if (!data) return null
  return {
    id: data.id,
    access_mode: parseAccessMode(data.access_mode),
    updated_at: data.updated_at ?? new Date().toISOString(),
    updated_by_wallet: data.updated_by_wallet ?? null,
  }
}

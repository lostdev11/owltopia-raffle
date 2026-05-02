import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'

const ROW_ID = 'default'

export type Gen2PresaleSettingsRow = {
  id: string
  is_live: boolean
  updated_at: string
  updated_by_wallet: string | null
}

export async function getGen2PresaleSettings(): Promise<Gen2PresaleSettingsRow> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('gen2_presale_settings')
    .select('id, is_live, updated_at, updated_by_wallet')
    .eq('id', ROW_ID)
    .maybeSingle()

  if (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('gen2_presale_settings read failed (run migration 094?):', error.message)
    }
  }

  if (error || !data) {
    return {
      id: ROW_ID,
      is_live: false,
      updated_at: new Date().toISOString(),
      updated_by_wallet: null,
    }
  }

  return {
    id: String(data.id),
    is_live: Boolean(data.is_live),
    updated_at: (data.updated_at as string) ?? new Date().toISOString(),
    updated_by_wallet: (data.updated_by_wallet as string | null) ?? null,
  }
}

export async function setGen2PresaleLive(isLive: boolean, wallet: string): Promise<Gen2PresaleSettingsRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('gen2_presale_settings')
    .update({
      is_live: isLive,
      updated_at: new Date().toISOString(),
      updated_by_wallet: wallet,
    })
    .eq('id', ROW_ID)
    .select('id, is_live, updated_at, updated_by_wallet')
    .single()

  if (error || !data) {
    console.error('setGen2PresaleLive', error)
    return null
  }

  return {
    id: String(data.id),
    is_live: Boolean(data.is_live),
    updated_at: (data.updated_at as string) ?? new Date().toISOString(),
    updated_by_wallet: (data.updated_by_wallet as string | null) ?? null,
  }
}

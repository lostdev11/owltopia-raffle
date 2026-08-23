import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'
import { invalidateCoinArtUpgradeEnabledCache } from '@/lib/coin-upgrade/config'

const ROW_ID = 'default'

export type CoinArtUpgradeSettingsRow = {
  id: string
  upgrades_enabled: boolean
  updated_at: string
  updated_by_wallet: string | null
}

export async function getCoinArtUpgradeSettings(): Promise<CoinArtUpgradeSettingsRow> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('coin_art_upgrade_settings')
    .select('id, upgrades_enabled, updated_at, updated_by_wallet')
    .eq('id', ROW_ID)
    .maybeSingle()

  if (error) {
    console.error('[coin-art-upgrade-settings] get:', error.message)
  }

  if (data) {
    return {
      id: data.id,
      upgrades_enabled: Boolean(data.upgrades_enabled),
      updated_at: data.updated_at ?? new Date().toISOString(),
      updated_by_wallet: data.updated_by_wallet ?? null,
    }
  }

  return {
    id: ROW_ID,
    upgrades_enabled: false,
    updated_at: new Date().toISOString(),
    updated_by_wallet: null,
  }
}

export async function patchCoinArtUpgradeSettings(input: {
  wallet: string
  upgrades_enabled: boolean
}): Promise<CoinArtUpgradeSettingsRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('coin_art_upgrade_settings')
    .update({
      upgrades_enabled: input.upgrades_enabled,
      updated_by_wallet: input.wallet,
    })
    .eq('id', ROW_ID)
    .select('id, upgrades_enabled, updated_at, updated_by_wallet')
    .single()

  if (error) {
    console.error('[coin-art-upgrade-settings] patch:', error.message)
    return null
  }
  if (!data) return null

  invalidateCoinArtUpgradeEnabledCache()
  return {
    id: data.id,
    upgrades_enabled: Boolean(data.upgrades_enabled),
    updated_at: data.updated_at ?? new Date().toISOString(),
    updated_by_wallet: data.updated_by_wallet ?? null,
  }
}

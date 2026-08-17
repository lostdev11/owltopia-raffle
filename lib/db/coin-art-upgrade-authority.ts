import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type CoinArtUpgradeAuthorityRow = {
  id: number
  wallet_address: string
  secret_key: string
  created_by: string | null
  rotated_at: string | null
  created_at: string
  updated_at: string
}

export async function getCoinArtUpgradeAuthorityRow(): Promise<CoinArtUpgradeAuthorityRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrade_authority')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as CoinArtUpgradeAuthorityRow | null) ?? null
}

/** Public fields only — never return secret_key to the client. */
export async function getCoinArtUpgradeAuthorityPublic(): Promise<{
  wallet_address: string
  created_at: string
  rotated_at: string | null
  created_by: string | null
  source: 'database'
} | null> {
  const row = await getCoinArtUpgradeAuthorityRow()
  if (!row) return null
  return {
    wallet_address: row.wallet_address,
    created_at: row.created_at,
    rotated_at: row.rotated_at,
    created_by: row.created_by,
    source: 'database',
  }
}

export async function upsertCoinArtUpgradeAuthority(params: {
  wallet_address: string
  secret_key: string
  created_by: string | null
  rotating: boolean
}): Promise<CoinArtUpgradeAuthorityRow> {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrade_authority')
    .upsert(
      {
        id: 1,
        wallet_address: params.wallet_address.trim(),
        secret_key: params.secret_key,
        created_by: params.created_by,
        rotated_at: params.rotating ? now : null,
        updated_at: now,
      },
      { onConflict: 'id' }
    )
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as CoinArtUpgradeAuthorityRow
}

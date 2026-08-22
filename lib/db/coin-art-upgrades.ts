import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type CoinArtUpgradeStatus = 'paid' | 'updated' | 'failed'

export interface CoinArtUpgradeCatalogRow {
  asset_id: string
  coin_number: number | null
  name: string | null
  new_uri: string
  new_image_uri: string | null
  original_uri: string | null
  created_at: string
  updated_at: string
}

export interface CoinArtUpgradePaymentRow {
  tx_signature: string
  wallet_address: string
  units: number
  lamports: number
  asset_ids: string[]
  created_at: string
}

export interface CoinArtUpgradeRow {
  asset_id: string
  wallet_address: string
  payment_tx_signature: string
  status: CoinArtUpgradeStatus
  previous_uri: string | null
  new_uri: string
  update_tx_signature: string | null
  last_error: string | null
  reward_boost_applied_at: string | null
  reward_boost_position_id: string | null
  upgraded_at: string | null
  created_at: string
  updated_at: string
}

export async function listCoinArtUpgradeCatalogEntries(
  assetIds: string[]
): Promise<CoinArtUpgradeCatalogRow[]> {
  const ids = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return []
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrade_catalog')
    .select('*')
    .in('asset_id', ids)
  if (error) throw new Error(error.message)
  return (data || []) as CoinArtUpgradeCatalogRow[]
}

export async function countCoinArtUpgradeCatalogEntries(): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from('coin_art_upgrade_catalog')
    .select('asset_id', { count: 'exact', head: true })
  if (error) throw new Error(error.message)
  return count ?? 0
}

export type CoinArtUpgradePreviewSample = {
  coin_number: number | null
  name: string | null
  image: string
}

/**
 * Sample new-art images for Nesting Coming soon (no Helius). Spreads across
 * coin numbers so the teaser isn't just #1–#8.
 */
export async function listCoinArtUpgradeCatalogPreviewSamples(
  limit = 8
): Promise<CoinArtUpgradePreviewSample[]> {
  const capped = Math.max(1, Math.min(24, Math.floor(limit)))
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrade_catalog')
    .select('coin_number, name, new_image_uri')
    .not('new_image_uri', 'is', null)
    .order('coin_number', { ascending: true, nullsFirst: false })
    .limit(240)
  if (error) throw new Error(error.message)
  const rows = (data || []).filter(
    (r): r is { coin_number: number | null; name: string | null; new_image_uri: string } =>
      typeof (r as { new_image_uri?: unknown }).new_image_uri === 'string' &&
      Boolean(String((r as { new_image_uri: string }).new_image_uri).trim())
  )
  if (rows.length === 0) return []
  if (rows.length <= capped) {
    return rows.map((r) => ({
      coin_number: r.coin_number,
      name: r.name,
      image: r.new_image_uri.trim(),
    }))
  }
  const out: CoinArtUpgradePreviewSample[] = []
  for (let i = 0; i < capped; i += 1) {
    const idx = Math.floor((i * (rows.length - 1)) / (capped - 1))
    const r = rows[idx]!
    out.push({
      coin_number: r.coin_number,
      name: r.name,
      image: r.new_image_uri.trim(),
    })
  }
  return out
}

export async function listCoinArtUpgradesByAssetIds(assetIds: string[]): Promise<CoinArtUpgradeRow[]> {
  const ids = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return []
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrades')
    .select('*')
    .in('asset_id', ids)
  if (error) throw new Error(error.message)
  return (data || []) as CoinArtUpgradeRow[]
}

export async function getCoinArtUpgradeByAssetId(assetId: string): Promise<CoinArtUpgradeRow | null> {
  const id = assetId.trim()
  if (!id) return null
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrades')
    .select('*')
    .eq('asset_id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as CoinArtUpgradeRow | null) ?? null
}

export async function getCoinArtUpgradePaymentBySignature(
  txSignature: string
): Promise<CoinArtUpgradePaymentRow | null> {
  const sig = txSignature.trim()
  if (!sig) return null
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrade_payments')
    .select('*')
    .eq('tx_signature', sig)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    tx_signature: String(data.tx_signature),
    wallet_address: String(data.wallet_address),
    units: Number(data.units),
    lamports: Number(data.lamports),
    asset_ids: Array.isArray(data.asset_ids) ? data.asset_ids.map(String) : [],
    created_at: String(data.created_at),
  }
}

export async function insertCoinArtUpgradePayment(row: {
  tx_signature: string
  wallet_address: string
  units: number
  lamports: number
  asset_ids: string[]
}): Promise<void> {
  const { error } = await getSupabaseAdmin().from('coin_art_upgrade_payments').insert({
    tx_signature: row.tx_signature.trim(),
    wallet_address: row.wallet_address.trim(),
    units: row.units,
    lamports: row.lamports,
    asset_ids: row.asset_ids,
  })
  if (error) throw new Error(error.message)
}

export async function appendCoinArtUpgradePaymentAssetIds(
  txSignature: string,
  assetIds: string[]
): Promise<void> {
  const existing = await getCoinArtUpgradePaymentBySignature(txSignature)
  if (!existing) throw new Error('Coin art upgrade payment not found.')
  const merged = [...new Set([...existing.asset_ids, ...assetIds.map((id) => id.trim())])]
  const { error } = await getSupabaseAdmin()
    .from('coin_art_upgrade_payments')
    .update({ asset_ids: merged })
    .eq('tx_signature', txSignature.trim())
  if (error) throw new Error(error.message)
}

export async function insertCoinArtUpgradeRow(row: {
  asset_id: string
  wallet_address: string
  payment_tx_signature: string
  new_uri: string
}): Promise<CoinArtUpgradeRow> {
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrades')
    .insert({
      asset_id: row.asset_id.trim(),
      wallet_address: row.wallet_address.trim(),
      payment_tx_signature: row.payment_tx_signature.trim(),
      status: 'paid',
      new_uri: row.new_uri,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as CoinArtUpgradeRow
}

export async function patchCoinArtUpgradeRow(
  assetId: string,
  patch: Partial<
    Pick<
      CoinArtUpgradeRow,
      | 'status'
      | 'previous_uri'
      | 'update_tx_signature'
      | 'last_error'
      | 'reward_boost_applied_at'
      | 'reward_boost_position_id'
      | 'upgraded_at'
    >
  >
): Promise<CoinArtUpgradeRow> {
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrades')
    .update(patch)
    .eq('asset_id', assetId.trim())
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as CoinArtUpgradeRow
}

/** Paid rows whose Core URI update or reward boost is still outstanding (repair cron scan). */
export async function listCoinArtUpgradesNeedingRepair(limit: number): Promise<CoinArtUpgradeRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrades')
    .select('*')
    .or('status.in.(paid,failed),reward_boost_applied_at.is.null')
    .order('updated_at', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 50)))
  if (error) throw new Error(error.message)
  return (data || []) as CoinArtUpgradeRow[]
}

export type CoinArtUpgradeStats = {
  total: number
  updated: number
  pending: number
  failed: number
  lamports_collected: number
  catalog_size: number
}

export async function getCoinArtUpgradeStats(): Promise<CoinArtUpgradeStats> {
  const db = getSupabaseAdmin()
  const [{ data: rows, error }, catalogSize] = await Promise.all([
    db.from('coin_art_upgrades').select('status'),
    countCoinArtUpgradeCatalogEntries(),
  ])
  if (error) throw new Error(error.message)

  const { data: payments, error: payErr } = await db
    .from('coin_art_upgrade_payments')
    .select('lamports')
  if (payErr) throw new Error(payErr.message)

  const statuses = (rows || []).map((r) => String((r as { status: string }).status))
  return {
    total: statuses.length,
    updated: statuses.filter((s) => s === 'updated').length,
    pending: statuses.filter((s) => s === 'paid').length,
    failed: statuses.filter((s) => s === 'failed').length,
    lamports_collected: (payments || []).reduce((sum, p) => sum + Number((p as { lamports: number }).lamports || 0), 0),
    catalog_size: catalogSize,
  }
}

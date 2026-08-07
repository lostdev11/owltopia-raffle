import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  PACKS_PRODUCT_SLUG,
  PACK_PRICE_SOL,
  PACK_RTP_BPS,
} from '@/lib/packs/config'
import type {
  PackInventoryRow,
  PackOpenRow,
  PackProductRow,
  PackTicketCreditRow,
  PackVaultConfigRow,
} from '@/lib/packs/types'
import { getPacksVaultPublicKey } from '@/lib/packs/vault'

export async function getActivePackProduct(): Promise<PackProductRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_products')
    .select('*')
    .eq('slug', PACKS_PRODUCT_SLUG)
    .eq('active', true)
    .maybeSingle()
  if (error) throw error
  return (data as PackProductRow | null) ?? null
}

export async function getPackVaultConfig(): Promise<PackVaultConfigRow> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_vault_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  if (data) return data as PackVaultConfigRow
  const vault = getPacksVaultPublicKey()
  return {
    id: 1,
    vault_pubkey: vault,
    paused: true,
    pause_reason: 'Vault config missing — apply migration 212',
    min_owl_balance: 100,
    min_sol_balance: 1,
    min_nft_count: 1,
    owl_sol_price: null,
    updated_at: new Date().toISOString(),
  }
}

export async function updatePackVaultConfig(
  patch: Partial<
    Pick<
      PackVaultConfigRow,
      | 'vault_pubkey'
      | 'paused'
      | 'pause_reason'
      | 'min_owl_balance'
      | 'min_sol_balance'
      | 'min_nft_count'
      | 'owl_sol_price'
    >
  >
): Promise<PackVaultConfigRow> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_vault_config')
    .upsert(
      {
        id: 1,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single()
  if (error) throw error
  return data as PackVaultConfigRow
}

export async function countAvailableNftsInBand(
  minFair: number,
  maxFair: number
): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from('pack_inventory')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'available')
    .gte('fair_value_sol', minFair)
    .lte('fair_value_sol', maxFair)
  if (error) throw error
  return count ?? 0
}

export async function countAvailableNfts(): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from('pack_inventory')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'available')
  if (error) throw error
  return count ?? 0
}

export async function listPackInventory(status?: string): Promise<PackInventoryRow[]> {
  let q = getSupabaseAdmin().from('pack_inventory').select('*').order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  const { data, error } = await q.limit(500)
  if (error) throw error
  return (data as PackInventoryRow[]) ?? []
}

export async function addPackInventoryNft(input: {
  mint_address: string
  name?: string | null
  image_url?: string | null
  fair_value_sol: number
}): Promise<PackInventoryRow> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_inventory')
    .insert({
      kind: 'nft',
      mint_address: input.mint_address.trim(),
      name: input.name ?? null,
      image_url: input.image_url ?? null,
      fair_value_sol: input.fair_value_sol,
      status: 'available',
    })
    .select('*')
    .single()
  if (error) throw error
  return data as PackInventoryRow
}

export async function removePackInventoryNft(id: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('pack_inventory')
    .update({ status: 'removed', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'available')
  if (error) throw error
}

/** Reserve a random available NFT in [min,max] fair value. Returns null if none. */
export async function reserveNftInBand(
  openId: string,
  minFair: number,
  maxFair: number
): Promise<PackInventoryRow | null> {
  const { data: rows, error } = await getSupabaseAdmin()
    .from('pack_inventory')
    .select('*')
    .eq('status', 'available')
    .gte('fair_value_sol', minFair)
    .lte('fair_value_sol', maxFair)
    .order('created_at', { ascending: true })
    .limit(20)
  if (error) throw error
  const list = (rows as PackInventoryRow[]) ?? []
  if (list.length === 0) return null

  for (const row of list) {
    const { data, error: upErr } = await getSupabaseAdmin()
      .from('pack_inventory')
      .update({
        status: 'reserved',
        reserved_open_id: openId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'available')
      .select('*')
      .maybeSingle()
    if (upErr) throw upErr
    if (data) return data as PackInventoryRow
  }
  return null
}

export async function markNftPaid(
  inventoryId: string,
  openId: string,
  signature: string
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('pack_inventory')
    .update({
      status: 'paid',
      paid_open_id: openId,
      payout_signature: signature,
      updated_at: new Date().toISOString(),
    })
    .eq('id', inventoryId)
  if (error) throw error
}

export async function releaseNftReservation(inventoryId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('pack_inventory')
    .update({
      status: 'available',
      reserved_open_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', inventoryId)
    .eq('status', 'reserved')
  if (error) throw error
}

export async function createPendingPackOpen(input: {
  productId: string
  buyerWallet: string
}): Promise<PackOpenRow> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_opens')
    .insert({
      product_id: input.productId,
      buyer_wallet: input.buyerWallet.trim(),
      status: 'pending_payment',
    })
    .select('*')
    .single()
  if (error) throw error
  return data as PackOpenRow
}

export async function getPackOpenById(id: string): Promise<PackOpenRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_opens')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as PackOpenRow | null) ?? null
}

export async function getPackOpenByPaymentSignature(
  signature: string
): Promise<PackOpenRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_opens')
    .select('*')
    .eq('payment_signature', signature)
    .maybeSingle()
  if (error) throw error
  return (data as PackOpenRow | null) ?? null
}

export async function updatePackOpen(
  id: string,
  patch: Partial<PackOpenRow>
): Promise<PackOpenRow> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_opens')
    .update({ ...patch })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as PackOpenRow
}

export async function listRecentCompletedOpens(limit = 30): Promise<PackOpenRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_opens')
    .select('*')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data as PackOpenRow[]) ?? []
}

export async function grantPackTicketCredits(input: {
  wallet: string
  openId: string
  credits: number
}): Promise<PackTicketCreditRow | null> {
  if (input.credits <= 0) return null
  const { data, error } = await getSupabaseAdmin()
    .from('pack_ticket_credits')
    .insert({
      wallet: input.wallet.trim(),
      open_id: input.openId,
      credits_granted: input.credits,
      credits_remaining: input.credits,
    })
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await getSupabaseAdmin()
        .from('pack_ticket_credits')
        .select('*')
        .eq('open_id', input.openId)
        .maybeSingle()
      return (existing as PackTicketCreditRow | null) ?? null
    }
    throw error
  }
  return data as PackTicketCreditRow
}

export async function getWalletTicketCreditBalance(wallet: string): Promise<number> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_ticket_credits')
    .select('credits_remaining')
    .eq('wallet', wallet.trim())
    .gt('credits_remaining', 0)
  if (error) throw error
  return ((data as { credits_remaining: number }[]) ?? []).reduce(
    (sum, r) => sum + (r.credits_remaining || 0),
    0
  )
}

/**
 * Consume `tickets` credits FIFO. Returns false if insufficient balance.
 */
export async function consumePackTicketCredits(
  wallet: string,
  tickets: number,
  raffleId: string,
  entryId: string | null
): Promise<boolean> {
  if (tickets <= 0) return false
  const { data, error } = await getSupabaseAdmin()
    .from('pack_ticket_credits')
    .select('*')
    .eq('wallet', wallet.trim())
    .gt('credits_remaining', 0)
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = (data as PackTicketCreditRow[]) ?? []
  const total = rows.reduce((s, r) => s + r.credits_remaining, 0)
  if (total < tickets) return false

  let left = tickets
  for (const row of rows) {
    if (left <= 0) break
    const take = Math.min(left, row.credits_remaining)
    const { error: upErr } = await getSupabaseAdmin()
      .from('pack_ticket_credits')
      .update({ credits_remaining: row.credits_remaining - take })
      .eq('id', row.id)
      .eq('credits_remaining', row.credits_remaining)
    if (upErr) throw upErr
    const { error: redErr } = await getSupabaseAdmin().from('pack_ticket_redemptions').insert({
      wallet: wallet.trim(),
      credit_id: row.id,
      raffle_id: raffleId,
      entry_id: entryId,
      tickets: take,
    })
    if (redErr) throw redErr
    left -= take
  }
  return left === 0
}

export function defaultProductFallback(): Pick<
  PackProductRow,
  'slug' | 'name' | 'price_sol' | 'rtp_bps'
> {
  return {
    slug: PACKS_PRODUCT_SLUG,
    name: 'Owl Pack',
    price_sol: PACK_PRICE_SOL,
    rtp_bps: PACK_RTP_BPS,
  }
}

import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  PACKS_PRODUCT_SLUG,
  PACK_PRICE_SOL,
  PACK_RTP_BPS,
} from '@/lib/packs/config'
import { expectedJackpotPoolSol } from '@/lib/packs/jackpot'
import type {
  PackInventoryPrizeStandard,
  PackInventoryRow,
  PackLedgerEntry,
  PackNftOddsTier,
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
  if (data) {
    const row = data as PackVaultConfigRow
    return {
      ...row,
      jackpot_pool_sol: Number(row.jackpot_pool_sol ?? 0),
      jackpot_contribution_sol: Number(row.jackpot_contribution_sol ?? 0.02),
      jackpot_win_odds_bps: Number(row.jackpot_win_odds_bps ?? 20),
    }
  }
  const vault = getPacksVaultPublicKey()
  return {
    id: 1,
    vault_pubkey: vault,
    paused: true,
    pause_reason: 'Vault isn’t set up yet',
    min_owl_balance: 100,
    min_sol_balance: 1,
    min_nft_count: 1,
    owl_sol_price: null,
    jackpot_pool_sol: 0,
    jackpot_contribution_sol: 0.02,
    jackpot_win_odds_bps: 20,
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
      | 'jackpot_pool_sol'
      | 'jackpot_contribution_sol'
      | 'jackpot_win_odds_bps'
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

/**
 * Add contribution to jackpot pool; optionally drain full pool on a win.
 * Returns pool state after this open's contribution is applied.
 */
export async function resolvePackJackpotForOpen(input: {
  contributionSol: number
  won: boolean
}): Promise<{
  poolBeforeSol: number
  poolAfterSol: number
  jackpotPayoutSol: number | null
}> {
  const config = await getPackVaultConfig()
  const poolBefore = Number(config.jackpot_pool_sol ?? 0)
  const poolWithContribution =
    Math.round((poolBefore + input.contributionSol) * 1_000_000_000) / 1_000_000_000

  if (input.won) {
    const payout = poolWithContribution
    await updatePackVaultConfig({ jackpot_pool_sol: 0 })
    return {
      poolBeforeSol: poolBefore,
      poolAfterSol: 0,
      jackpotPayoutSol: payout,
    }
  }

  await updatePackVaultConfig({ jackpot_pool_sol: poolWithContribution })
  return {
    poolBeforeSol: poolBefore,
    poolAfterSol: poolWithContribution,
    jackpotPayoutSol: null,
  }
}

/**
 * Recompute jackpot_pool_sol from pack_opens history (completed + paid unfinished).
 * Use after stuck paid opens or manual corrections so the visible pool matches purchases.
 */
export async function recalculatePackJackpotPool(): Promise<{
  previousPoolSol: number
  expectedPoolSol: number
  completedContribSol: number
  paidUnfinishedContribSol: number
  completedOpens: number
  paidUnfinishedOpens: number
  sinceJackpotWinAt: string | null
}> {
  const config = await getPackVaultConfig()
  const { data, error } = await getSupabaseAdmin()
    .from('pack_opens')
    .select(
      'status, payment_signature, jackpot_contribution_sol, is_jackpot_win, completed_at, created_at'
    )
  if (error) throw error

  const accounting = expectedJackpotPoolSol({
    contributionSol: Number(config.jackpot_contribution_sol ?? 0.02),
    opens: (data ?? []) as {
      status: string
      payment_signature: string | null
      jackpot_contribution_sol: number | null
      is_jackpot_win: boolean | null
      completed_at: string | null
      created_at: string
    }[],
  })

  const previousPoolSol = Number(config.jackpot_pool_sol ?? 0)
  if (previousPoolSol !== accounting.expectedPoolSol) {
    await updatePackVaultConfig({ jackpot_pool_sol: accounting.expectedPoolSol })
  }

  return {
    previousPoolSol,
    ...accounting,
  }
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
  prize_standard?: PackInventoryPrizeStandard
  odds_tier?: PackNftOddsTier
}): Promise<PackInventoryRow> {
  const odds_tier = input.odds_tier === 'premium_1pct' ? 'premium_1pct' : 'standard'
  const { data, error } = await getSupabaseAdmin()
    .from('pack_inventory')
    .insert({
      kind: 'nft',
      mint_address: input.mint_address.trim(),
      name: input.name ?? null,
      image_url: input.image_url ?? null,
      fair_value_sol: input.fair_value_sol,
      prize_standard: input.prize_standard ?? 'spl',
      odds_tier,
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

/** Available NFTs eligible for packs open (min fair value enforced; no 0.5 SOL cap). */
export async function updatePackInventoryOddsTier(
  id: string,
  oddsTier: PackNftOddsTier
): Promise<PackInventoryRow> {
  const odds_tier = oddsTier === 'premium_1pct' ? 'premium_1pct' : 'standard'
  const { data, error } = await getSupabaseAdmin()
    .from('pack_inventory')
    .update({ odds_tier, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['available', 'reserved'])
    .select('*')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Inventory item not found or not editable')
  return data as PackInventoryRow
}


export async function listAvailableNftsForOpen(): Promise<PackInventoryRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_inventory')
    .select('*')
    .eq('status', 'available')
    .gte('fair_value_sol', 0.05)
    .order('mint_address', { ascending: true })
  if (error) throw error
  return (data as PackInventoryRow[]) ?? []
}

/** Atomically reserve a specific inventory row by id. Returns null if already taken. */
export async function reserveNftById(
  openId: string,
  inventoryId: string
): Promise<PackInventoryRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('pack_inventory')
    .update({
      status: 'reserved',
      reserved_open_id: openId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', inventoryId)
    .eq('status', 'available')
    .select('*')
    .maybeSingle()
  if (error) throw error
  return (data as PackInventoryRow | null) ?? null
}

/** @deprecated Prefer listAvailableNftsForOpen + reserveNftById (per-NFT FP weighting). */
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
    const reserved = await reserveNftById(openId, row.id)
    if (reserved) return reserved
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
  paymentCurrency?: 'SOL' | 'OWL'
  paymentOwlAmount?: number | null
  paymentFeeSol?: number | null
}): Promise<PackOpenRow> {
  const currency = input.paymentCurrency === 'OWL' ? 'OWL' : 'SOL'
  const { data, error } = await getSupabaseAdmin()
    .from('pack_opens')
    .insert({
      product_id: input.productId,
      buyer_wallet: input.buyerWallet.trim(),
      status: 'pending_payment',
      payment_currency: currency,
      payment_owl_amount: currency === 'OWL' ? (input.paymentOwlAmount ?? null) : null,
      payment_fee_sol: currency === 'OWL' ? (input.paymentFeeSol ?? null) : null,
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

export async function countCompletedPackOpensForWallet(wallet: string): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from('pack_opens')
    .select('*', { count: 'exact', head: true })
    .eq('buyer_wallet', wallet.trim())
    .eq('status', 'completed')
  if (error) throw error
  return count ?? 0
}

type PackOpenLedgerDbRow = {
  id: string
  completed_at: string | null
  category: string | null
  prize_label: string | null
  payment_signature: string | null
  payout_signature: string | null
  is_jackpot_win: boolean | null
  pack_products: { name: string; slug: string } | { name: string; slug: string }[] | null
}

function mapPackOpenLedgerRow(row: PackOpenLedgerDbRow): PackLedgerEntry | null {
  if (!row.completed_at) return null
  const productRaw = row.pack_products
  const product = Array.isArray(productRaw) ? productRaw[0] : productRaw
  return {
    id: row.id,
    completedAt: row.completed_at,
    productName: product?.name?.trim() || 'Owl Pack',
    productSlug: product?.slug?.trim() || PACKS_PRODUCT_SLUG,
    category: row.category ?? 'owl',
    prizeLabel: row.prize_label?.trim() || 'Prize',
    paymentSignature: row.payment_signature,
    payoutSignature: row.payout_signature,
    isJackpotWin: row.is_jackpot_win === true,
  }
}

export async function listCompletedPackOpensForWallet(input: {
  wallet: string
  limit?: number
  offset?: number
}): Promise<PackLedgerEntry[]> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
  const offset = Math.max(input.offset ?? 0, 0)
  const { data, error } = await getSupabaseAdmin()
    .from('pack_opens')
    .select(
      `
      id,
      completed_at,
      category,
      prize_label,
      payment_signature,
      payout_signature,
      is_jackpot_win,
      pack_products ( name, slug )
    `
    )
    .eq('buyer_wallet', input.wallet.trim())
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw error
  return ((data as PackOpenLedgerDbRow[]) ?? [])
    .map(mapPackOpenLedgerRow)
    .filter((r): r is PackLedgerEntry => r != null)
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

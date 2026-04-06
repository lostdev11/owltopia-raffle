import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { NftGiveaway, PrizeStandard } from '@/lib/types'

function mapRow(row: Record<string, unknown>): NftGiveaway {
  return {
    id: String(row.id),
    title: row.title != null ? String(row.title) : null,
    nft_mint_address: String(row.nft_mint_address),
    nft_token_id: row.nft_token_id != null ? String(row.nft_token_id) : null,
    prize_standard: (row.prize_standard as PrizeStandard | null) ?? null,
    eligible_wallet: String(row.eligible_wallet),
    deposit_tx_signature: row.deposit_tx_signature != null ? String(row.deposit_tx_signature) : null,
    prize_deposited_at: row.prize_deposited_at != null ? String(row.prize_deposited_at) : null,
    claim_tx_signature: row.claim_tx_signature != null ? String(row.claim_tx_signature) : null,
    claimed_at: row.claimed_at != null ? String(row.claimed_at) : null,
    nft_claim_locked_at: row.nft_claim_locked_at != null ? String(row.nft_claim_locked_at) : null,
    nft_claim_locked_wallet: row.nft_claim_locked_wallet != null ? String(row.nft_claim_locked_wallet) : null,
    created_by_wallet: row.created_by_wallet != null ? String(row.created_by_wallet) : null,
    notes: row.notes != null ? String(row.notes) : null,
    discord_partner_tenant_id:
      row.discord_partner_tenant_id != null ? String(row.discord_partner_tenant_id) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export async function listAllNftGiveaways(): Promise<NftGiveaway[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('nft_giveaways')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('listAllNftGiveaways:', error.message)
    throw new Error(error.message)
  }
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
}

export async function getNftGiveawayById(id: string): Promise<NftGiveaway | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('nft_giveaways')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('getNftGiveawayById:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function listNftGiveawaysForWallet(walletAddress: string): Promise<NftGiveaway[]> {
  const w = walletAddress.trim()
  const { data, error } = await getSupabaseAdmin()
    .from('nft_giveaways')
    .select('*')
    .eq('eligible_wallet', w)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('listNftGiveawaysForWallet:', error.message)
    throw new Error(error.message)
  }
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
}

export type CreateNftGiveawayInput = {
  title?: string | null
  nft_mint_address: string
  nft_token_id?: string | null
  prize_standard?: PrizeStandard | null
  eligible_wallet: string
  deposit_tx_signature?: string | null
  notes?: string | null
  discord_partner_tenant_id?: string | null
  created_by_wallet: string
}

export async function createNftGiveaway(input: CreateNftGiveawayInput): Promise<NftGiveaway> {
  const { data, error } = await getSupabaseAdmin()
    .from('nft_giveaways')
    .insert({
      title: input.title?.trim() || null,
      nft_mint_address: input.nft_mint_address.trim(),
      nft_token_id: input.nft_token_id?.trim() || null,
      prize_standard: input.prize_standard ?? null,
      eligible_wallet: input.eligible_wallet.trim(),
      deposit_tx_signature: input.deposit_tx_signature?.trim() || null,
      notes: input.notes?.trim() || null,
      discord_partner_tenant_id: input.discord_partner_tenant_id?.trim() || null,
      created_by_wallet: input.created_by_wallet.trim(),
    })
    .select()
    .single()

  if (error) {
    console.error('createNftGiveaway:', error.message)
    throw new Error(error.message)
  }
  return mapRow(data as Record<string, unknown>)
}

export async function updateNftGiveaway(
  id: string,
  patch: Partial<{
    title: string | null
    nft_mint_address: string
    nft_token_id: string | null
    prize_standard: PrizeStandard | null
    eligible_wallet: string
    deposit_tx_signature: string | null
    prize_deposited_at: string | null
    notes: string | null
    discord_partner_tenant_id: string | null
    claim_tx_signature: string | null
    claimed_at: string | null
    nft_claim_locked_at: string | null
    nft_claim_locked_wallet: string | null
  }>
): Promise<NftGiveaway | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('nft_giveaways')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) {
    console.error('updateNftGiveaway:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapRow(data as Record<string, unknown>)
}

/**
 * Short-lived claim mutex (same pattern as raffle NFT prize claim).
 */
export async function acquireNftGiveawayClaimLock(
  giveawayId: string,
  walletAddress: string
): Promise<{ acquired: boolean }> {
  const wallet = walletAddress.trim()
  const lockAt = new Date().toISOString()
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  await getSupabaseAdmin()
    .from('nft_giveaways')
    .update({ nft_claim_locked_at: null, nft_claim_locked_wallet: null })
    .eq('id', giveawayId)
    .is('claim_tx_signature', null)
    .not('nft_claim_locked_at', 'is', null)
    .lt('nft_claim_locked_at', staleBefore)

  const { data, error } = await getSupabaseAdmin()
    .from('nft_giveaways')
    .update({
      nft_claim_locked_at: lockAt,
      nft_claim_locked_wallet: wallet,
    })
    .eq('id', giveawayId)
    .is('claim_tx_signature', null)
    .is('claimed_at', null)
    .is('nft_claim_locked_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('acquireNftGiveawayClaimLock:', error.message)
    throw new Error(error.message)
  }
  return { acquired: !!data }
}

export async function clearNftGiveawayClaimLock(giveawayId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('nft_giveaways')
    .update({ nft_claim_locked_at: null, nft_claim_locked_wallet: null })
    .eq('id', giveawayId)
  if (error) {
    console.error('clearNftGiveawayClaimLock:', error.message)
    throw new Error(error.message)
  }
}

export async function markNftGiveawayClaimed(
  giveawayId: string,
  claimTxSignature: string
): Promise<NftGiveaway | null> {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseAdmin()
    .from('nft_giveaways')
    .update({
      claim_tx_signature: claimTxSignature,
      claimed_at: now,
      nft_claim_locked_at: null,
      nft_claim_locked_wallet: null,
    })
    .eq('id', giveawayId)
    .select()
    .maybeSingle()

  if (error) {
    console.error('markNftGiveawayClaimed:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapRow(data as Record<string, unknown>)
}

import { COMMUNITY_GIVEAWAY_MAX_DRAW_WEIGHT } from '@/lib/config/community-giveaways'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type {
  CommunityGiveaway,
  CommunityGiveawayAccessGate,
  CommunityGiveawayEntry,
  CommunityGiveawayStatus,
  PrizeStandard,
} from '@/lib/types'

function mapGiveawayRow(row: Record<string, unknown>): CommunityGiveaway {
  return {
    id: String(row.id),
    title: String(row.title),
    description: row.description != null ? String(row.description) : null,
    access_gate: row.access_gate as CommunityGiveawayAccessGate,
    status: row.status as CommunityGiveawayStatus,
    starts_at: String(row.starts_at),
    ends_at: row.ends_at != null ? String(row.ends_at) : null,
    nft_mint_address: String(row.nft_mint_address),
    nft_token_id: row.nft_token_id != null ? String(row.nft_token_id) : null,
    prize_standard: (row.prize_standard as PrizeStandard | null) ?? null,
    deposit_tx_signature: row.deposit_tx_signature != null ? String(row.deposit_tx_signature) : null,
    prize_deposited_at: row.prize_deposited_at != null ? String(row.prize_deposited_at) : null,
    winner_wallet: row.winner_wallet != null ? String(row.winner_wallet) : null,
    winner_selected_at: row.winner_selected_at != null ? String(row.winner_selected_at) : null,
    claim_tx_signature: row.claim_tx_signature != null ? String(row.claim_tx_signature) : null,
    claimed_at: row.claimed_at != null ? String(row.claimed_at) : null,
    nft_claim_locked_at: row.nft_claim_locked_at != null ? String(row.nft_claim_locked_at) : null,
    nft_claim_locked_wallet: row.nft_claim_locked_wallet != null ? String(row.nft_claim_locked_wallet) : null,
    created_by_wallet: row.created_by_wallet != null ? String(row.created_by_wallet) : null,
    notes: row.notes != null ? String(row.notes) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

function mapEntryRow(row: Record<string, unknown>): CommunityGiveawayEntry {
  return {
    id: String(row.id),
    giveaway_id: String(row.giveaway_id),
    wallet_address: String(row.wallet_address),
    draw_weight: Number(row.draw_weight),
    created_at: String(row.created_at),
  }
}

export async function listAllCommunityGiveaways(): Promise<CommunityGiveaway[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaways')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('listAllCommunityGiveaways:', error.message)
    throw new Error(error.message)
  }
  return (data ?? []).map((r) => mapGiveawayRow(r as Record<string, unknown>))
}

/** Public directory: non-draft giveaways for /raffles Giveaways tab (newest first, capped). */
export async function listPublicCommunityGiveaways(limit = 80): Promise<CommunityGiveaway[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaways')
    .select('*')
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200))

  if (error) {
    console.error('listPublicCommunityGiveaways:', error.message)
    throw new Error(error.message)
  }
  return (data ?? []).map((r) => mapGiveawayRow(r as Record<string, unknown>))
}

/**
 * Open giveaways past `ends_at` with verified prize — candidates for automatic winner draw (cron / public fetch).
 * Giveaways without `ends_at` stay manual-only until an admin draws.
 */
export async function listOpenCommunityGiveawaysPastEnd(nowIso: string): Promise<CommunityGiveaway[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaways')
    .select('*')
    .eq('status', 'open')
    .is('winner_wallet', null)
    .not('prize_deposited_at', 'is', null)
    .not('ends_at', 'is', null)
    .lt('ends_at', nowIso)
    .order('ends_at', { ascending: true })

  if (error) {
    console.error('listOpenCommunityGiveawaysPastEnd:', error.message)
    throw new Error(error.message)
  }
  return (data ?? []).map((r) => mapGiveawayRow(r as Record<string, unknown>))
}

export async function getCommunityGiveawayById(id: string): Promise<CommunityGiveaway | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaways')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('getCommunityGiveawayById:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapGiveawayRow(data as Record<string, unknown>)
}

export async function listCommunityGiveawaysWonByWallet(
  walletAddress: string
): Promise<CommunityGiveaway[]> {
  const w = walletAddress.trim()
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaways')
    .select('*')
    .eq('winner_wallet', w)
    .order('winner_selected_at', { ascending: false })

  if (error) {
    console.error('listCommunityGiveawaysWonByWallet:', error.message)
    throw new Error(error.message)
  }
  return (data ?? []).map((r) => mapGiveawayRow(r as Record<string, unknown>))
}

export async function getEntriesByGiveawayId(giveawayId: string): Promise<CommunityGiveawayEntry[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaway_entries')
    .select('*')
    .eq('giveaway_id', giveawayId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('getEntriesByGiveawayId:', error.message)
    throw new Error(error.message)
  }
  return (data ?? []).map((r) => mapEntryRow(r as Record<string, unknown>))
}

export async function countEntriesByGiveawayId(giveawayId: string): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from('community_giveaway_entries')
    .select('*', { count: 'exact', head: true })
    .eq('giveaway_id', giveawayId)

  if (error) {
    console.error('countEntriesByGiveawayId:', error.message)
    throw new Error(error.message)
  }
  return count ?? 0
}

/** One grouped query for browse lists; falls back to per-id counts if RPC is unavailable. */
export async function countEntriesByGiveawayIds(giveawayIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(giveawayIds.map((id) => id.trim()).filter(Boolean))]
  const map = new Map<string, number>()
  if (unique.length === 0) return map

  const { data, error } = await getSupabaseAdmin().rpc('count_community_giveaway_entries_for_ids', {
    p_ids: unique,
  })

  if (!error && Array.isArray(data)) {
    for (const row of data as { giveaway_id: string; entry_count: number | string }[]) {
      const gid = String(row.giveaway_id)
      const n = Number(row.entry_count)
      map.set(gid, Number.isFinite(n) ? n : 0)
    }
    for (const id of unique) {
      if (!map.has(id)) map.set(id, 0)
    }
    return map
  }

  if (error) {
    console.warn('countEntriesByGiveawayIds: RPC failed, falling back:', error.message)
  }

  await Promise.all(
    unique.map(async (id) => {
      map.set(id, await countEntriesByGiveawayId(id))
    })
  )
  return map
}

/** True if this tx was already used for any OWL boost. */
export async function isOwlBoostTxUsed(signature: string): Promise<boolean> {
  const sig = signature.trim()
  if (!sig) return false
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaway_owl_boosts')
    .select('id')
    .eq('tx_signature', sig)
    .maybeSingle()

  if (error) {
    console.error('isOwlBoostTxUsed:', error.message)
    throw new Error(error.message)
  }
  return !!data
}

export async function getEntryForWallet(
  giveawayId: string,
  walletAddress: string
): Promise<CommunityGiveawayEntry | null> {
  const w = walletAddress.trim()
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaway_entries')
    .select('*')
    .eq('giveaway_id', giveawayId)
    .eq('wallet_address', w)
    .maybeSingle()

  if (error) {
    console.error('getEntryForWallet:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapEntryRow(data as Record<string, unknown>)
}

export type CreateCommunityGiveawayInput = {
  title: string
  description?: string | null
  access_gate: CommunityGiveawayAccessGate
  starts_at: string
  ends_at?: string | null
  nft_mint_address: string
  nft_token_id?: string | null
  prize_standard?: PrizeStandard | null
  deposit_tx_signature?: string | null
  notes?: string | null
  created_by_wallet: string
}

export async function createCommunityGiveaway(
  input: CreateCommunityGiveawayInput
): Promise<CommunityGiveaway> {
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaways')
    .insert({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      access_gate: input.access_gate,
      status: 'draft',
      starts_at: input.starts_at,
      ends_at: input.ends_at?.trim() || null,
      nft_mint_address: input.nft_mint_address.trim(),
      nft_token_id: input.nft_token_id?.trim() || null,
      prize_standard: input.prize_standard ?? null,
      deposit_tx_signature: input.deposit_tx_signature?.trim() || null,
      notes: input.notes?.trim() || null,
      created_by_wallet: input.created_by_wallet.trim(),
    })
    .select()
    .single()

  if (error) {
    console.error('createCommunityGiveaway:', error.message)
    throw new Error(error.message)
  }
  return mapGiveawayRow(data as Record<string, unknown>)
}

export async function updateCommunityGiveaway(
  id: string,
  patch: Partial<{
    title: string
    description: string | null
    access_gate: CommunityGiveawayAccessGate
    status: CommunityGiveawayStatus
    starts_at: string
    ends_at: string | null
    nft_mint_address: string
    nft_token_id: string | null
    prize_standard: PrizeStandard | null
    deposit_tx_signature: string | null
    prize_deposited_at: string | null
    winner_wallet: string | null
    winner_selected_at: string | null
    notes: string | null
    claim_tx_signature: string | null
    claimed_at: string | null
    nft_claim_locked_at: string | null
    nft_claim_locked_wallet: string | null
  }>
): Promise<CommunityGiveaway | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaways')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) {
    console.error('updateCommunityGiveaway:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapGiveawayRow(data as Record<string, unknown>)
}

export async function insertCommunityGiveawayEntry(
  giveawayId: string,
  walletAddress: string
): Promise<CommunityGiveawayEntry> {
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaway_entries')
    .insert({
      giveaway_id: giveawayId,
      wallet_address: walletAddress.trim(),
      draw_weight: 1,
    })
    .select()
    .single()

  if (error) {
    console.error('insertCommunityGiveawayEntry:', error.message)
    throw new Error(error.message)
  }
  return mapEntryRow(data as Record<string, unknown>)
}

/**
 * +1 draw_weight for one verified OWL payment (DB function: insert boost + increment, atomic).
 * Returns null if no entry or already at max draw weight.
 */
export async function applyOwlBoostIncrement(
  giveawayId: string,
  walletAddress: string,
  owlBoostTx: string
): Promise<CommunityGiveawayEntry | null> {
  const entry = await getEntryForWallet(giveawayId, walletAddress)
  if (!entry) return null

  const current = Math.max(1, Math.floor(Number(entry.draw_weight) || 1))
  if (current >= COMMUNITY_GIVEAWAY_MAX_DRAW_WEIGHT) return null

  const { data, error } = await getSupabaseAdmin().rpc('apply_community_giveaway_owl_boost', {
    p_entry_id: entry.id,
    p_tx: owlBoostTx.trim(),
  })

  if (error) {
    console.error('applyOwlBoostIncrement rpc:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  return mapEntryRow(row as Record<string, unknown>)
}

/**
 * Weighted random winner; persists winner + status drawn only if still open.
 */
export async function drawCommunityGiveawayWinner(giveawayId: string): Promise<string | null> {
  const giveaway = await getCommunityGiveawayById(giveawayId)
  if (!giveaway || giveaway.status !== 'open') {
    return null
  }

  const entries = await getEntriesByGiveawayId(giveawayId)
  if (entries.length === 0) {
    return null
  }

  const wallets = entries.map((e) => e.wallet_address)
  const weights = entries.map((e) => Math.max(1, Math.floor(Number(e.draw_weight) || 1)))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) {
    return null
  }

  let random = Math.random() * total
  let winnerWallet = wallets[0]
  for (let i = 0; i < wallets.length; i++) {
    random -= weights[i]
    if (random <= 0) {
      winnerWallet = wallets[i]
      break
    }
  }

  const now = new Date().toISOString()
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaways')
    .update({
      winner_wallet: winnerWallet,
      winner_selected_at: now,
      status: 'drawn',
    })
    .eq('id', giveawayId)
    .eq('status', 'open')
    .is('winner_wallet', null)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('drawCommunityGiveawayWinner:', error.message)
    throw new Error(error.message)
  }
  return data ? winnerWallet : null
}

export async function acquireCommunityGiveawayClaimLock(
  giveawayId: string,
  walletAddress: string
): Promise<{ acquired: boolean }> {
  const wallet = walletAddress.trim()
  const lockAt = new Date().toISOString()
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  await getSupabaseAdmin()
    .from('community_giveaways')
    .update({ nft_claim_locked_at: null, nft_claim_locked_wallet: null })
    .eq('id', giveawayId)
    .is('claim_tx_signature', null)
    .not('nft_claim_locked_at', 'is', null)
    .lt('nft_claim_locked_at', staleBefore)

  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaways')
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
    console.error('acquireCommunityGiveawayClaimLock:', error.message)
    throw new Error(error.message)
  }
  return { acquired: !!data }
}

export async function clearCommunityGiveawayClaimLock(giveawayId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('community_giveaways')
    .update({ nft_claim_locked_at: null, nft_claim_locked_wallet: null })
    .eq('id', giveawayId)
  if (error) {
    console.error('clearCommunityGiveawayClaimLock:', error.message)
    throw new Error(error.message)
  }
}

export async function markCommunityGiveawayClaimed(
  giveawayId: string,
  claimTxSignature: string
): Promise<CommunityGiveaway | null> {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseAdmin()
    .from('community_giveaways')
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
    console.error('markCommunityGiveawayClaimed:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapGiveawayRow(data as Record<string, unknown>)
}

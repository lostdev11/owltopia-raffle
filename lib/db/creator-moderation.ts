import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  isCreatorModerationBanned,
  listingFeeLamportsForStrikeCount,
  MODERATION_MAX_STRIKES_BEFORE_BAN,
} from '@/lib/raffles/creator-moderation-policy'

export type CreatorBlacklistEntry = {
  wallet_address: string
  reason: string
  added_by: string
  notes: string | null
  strike_count: number
  banned_at: string | null
  created_at: string
  updated_at: string
}

function normalizeWallet(wallet: string): string {
  return wallet.trim()
}

export async function getCreatorBlacklistEntry(wallet: string): Promise<CreatorBlacklistEntry | null> {
  const normalized = normalizeWallet(wallet)
  if (!normalized) return null
  const { data, error } = await getSupabaseAdmin()
    .from('creator_blacklist')
    .select(
      'wallet_address, reason, added_by, notes, strike_count, banned_at, created_at, updated_at'
    )
    .eq('wallet_address', normalized)
    .maybeSingle()
  if (error) {
    console.error('[creator-moderation] getCreatorBlacklistEntry', error)
    return null
  }
  if (!data) return null
  return {
    wallet_address: String(data.wallet_address),
    reason: String(data.reason),
    added_by: String(data.added_by),
    notes: data.notes == null ? null : String(data.notes),
    strike_count: Math.max(0, Math.floor(Number(data.strike_count) || 0)),
    banned_at: data.banned_at == null ? null : String(data.banned_at),
    created_at: String(data.created_at),
    updated_at: String(data.updated_at),
  }
}

export async function listCreatorBlacklistEntries(limit = 200): Promise<CreatorBlacklistEntry[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('creator_blacklist')
    .select(
      'wallet_address, reason, added_by, notes, strike_count, banned_at, created_at, updated_at'
    )
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[creator-moderation] listCreatorBlacklistEntries', error)
    return []
  }
  return (data || []).map((row) => ({
    wallet_address: String(row.wallet_address),
    reason: String(row.reason),
    added_by: String(row.added_by),
    notes: row.notes == null ? null : String(row.notes),
    strike_count: Math.max(0, Math.floor(Number(row.strike_count) || 0)),
    banned_at: row.banned_at == null ? null : String(row.banned_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }))
}

export async function upsertCreatorBlacklist(params: {
  walletAddress: string
  reason: string
  addedBy: string
  notes?: string | null
}): Promise<CreatorBlacklistEntry | null> {
  const wallet_address = normalizeWallet(params.walletAddress)
  const reason = params.reason.trim()
  if (!wallet_address || !reason) return null
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseAdmin()
    .from('creator_blacklist')
    .upsert(
      {
        wallet_address,
        reason,
        added_by: params.addedBy.trim(),
        notes: params.notes?.trim() || null,
        updated_at: now,
      },
      { onConflict: 'wallet_address' }
    )
    .select(
      'wallet_address, reason, added_by, notes, strike_count, banned_at, created_at, updated_at'
    )
    .single()
  if (error) {
    console.error('[creator-moderation] upsertCreatorBlacklist', error)
    return null
  }
  return {
    wallet_address: String(data.wallet_address),
    reason: String(data.reason),
    added_by: String(data.added_by),
    notes: data.notes == null ? null : String(data.notes),
    strike_count: Math.max(0, Math.floor(Number(data.strike_count) || 0)),
    banned_at: data.banned_at == null ? null : String(data.banned_at),
    created_at: String(data.created_at),
    updated_at: String(data.updated_at),
  }
}

export async function removeCreatorBlacklist(wallet: string): Promise<boolean> {
  const normalized = normalizeWallet(wallet)
  if (!normalized) return false
  const { error } = await getSupabaseAdmin().from('creator_blacklist').delete().eq('wallet_address', normalized)
  if (error) {
    console.error('[creator-moderation] removeCreatorBlacklist', error)
    return false
  }
  return true
}

export type CreatorModerationCreateContext = {
  blacklisted: boolean
  banned: boolean
  strikeCount: number
  listingFeeLamports: number | null
  reason: string | null
}

export async function getCreatorModerationCreateContext(
  wallet: string
): Promise<CreatorModerationCreateContext> {
  const entry = await getCreatorBlacklistEntry(wallet)
  if (!entry) {
    return {
      blacklisted: false,
      banned: false,
      strikeCount: 0,
      listingFeeLamports: null,
      reason: null,
    }
  }
  const banned = isCreatorModerationBanned(entry.strike_count, entry.banned_at)
  const listingFeeLamports = banned ? null : listingFeeLamportsForStrikeCount(entry.strike_count)
  return {
    blacklisted: true,
    banned,
    strikeCount: entry.strike_count,
    listingFeeLamports,
    reason: entry.reason,
  }
}

export async function recordModerationStrikeOnPublish(params: {
  walletAddress: string
  raffleId: string
  listingFeeLamports: number
  listingFeePaymentTx: string | null
}): Promise<{ recorded: boolean; strikeNumber: number | null }> {
  const wallet_address = normalizeWallet(params.walletAddress)
  if (!wallet_address) return { recorded: false, strikeNumber: null }

  const { data: existingEvent, error: existingErr } = await getSupabaseAdmin()
    .from('creator_moderation_strike_events')
    .select('id, strike_number')
    .eq('raffle_id', params.raffleId)
    .maybeSingle()
  if (existingErr) {
    console.error('[creator-moderation] recordModerationStrikeOnPublish existing', existingErr)
    return { recorded: false, strikeNumber: null }
  }
  if (existingEvent) {
    return {
      recorded: false,
      strikeNumber: Math.max(1, Math.floor(Number(existingEvent.strike_number) || 0)),
    }
  }

  const entry = await getCreatorBlacklistEntry(wallet_address)
  if (!entry) return { recorded: false, strikeNumber: null }

  const strikeNumber = entry.strike_count + 1
  const now = new Date().toISOString()
  const banned_at =
    strikeNumber >= MODERATION_MAX_STRIKES_BEFORE_BAN ? entry.banned_at ?? now : entry.banned_at

  const { error: eventErr } = await getSupabaseAdmin().from('creator_moderation_strike_events').insert({
    wallet_address,
    strike_number: strikeNumber,
    raffle_id: params.raffleId,
    listing_fee_lamports: params.listingFeeLamports,
    listing_fee_payment_tx: params.listingFeePaymentTx?.trim() || null,
    created_at: now,
  })
  if (eventErr) {
    console.error('[creator-moderation] recordModerationStrikeOnPublish insert event', eventErr)
    return { recorded: false, strikeNumber: null }
  }

  const { error: updateErr } = await getSupabaseAdmin()
    .from('creator_blacklist')
    .update({
      strike_count: strikeNumber,
      banned_at,
      updated_at: now,
    })
    .eq('wallet_address', wallet_address)
  if (updateErr) {
    console.error('[creator-moderation] recordModerationStrikeOnPublish update blacklist', updateErr)
  }

  return { recorded: true, strikeNumber }
}

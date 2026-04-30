import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import type { Entry } from '@/lib/types'
import { getDisplayNamesByWallets } from '@/lib/db/wallet-profiles'
import { withRetry } from '@/lib/db-retry'
import { RAFFLE_CURRENCIES } from '@/lib/tokens'

/** Thrown when the DB rejects a duplicate transaction_signature (unique index). */
export class TransactionSignatureAlreadyUsedError extends Error {
  constructor() {
    super('Transaction signature already used for another entry')
    this.name = 'TransactionSignatureAlreadyUsedError'
  }
}

/** Thrown when confirm_entry_with_tx RPC raises tx_already_used (replay). */
export class TxAlreadyUsedError extends Error {
  constructor() {
    super('Transaction signature already used for another entry')
    this.name = 'TxAlreadyUsedError'
  }
}

/** Thrown when confirm_entry_with_tx RPC raises insufficient_tickets. */
export class InsufficientTicketsError extends Error {
  constructor(message = 'Would exceed maximum ticket limit') {
    super(message)
    this.name = 'InsufficientTicketsError'
  }
}

/** Thrown when confirm_entry_with_tx RPC raises invalid_state. */
export class ConfirmEntryInvalidStateError extends Error {
  constructor(message = 'Invalid entry state for confirmation') {
    super(message)
    this.name = 'ConfirmEntryInvalidStateError'
  }
}

/** Referral free ticket already redeemed for this wallet (lifetime, all raffles). */
export class ComplimentaryQuotaExceededError extends Error {
  constructor() {
    super('Referral complimentary ticket already used for this wallet')
    this.name = 'ComplimentaryQuotaExceededError'
  }
}

export type ClaimVerifiedTransactionResult =
  | { claimed: true }
  | { claimed: false; existingEntryId: string }

/**
 * Idempotency lock: claim a transaction signature at DB level before any entry update.
 * INSERT into verified_transactions; duplicate → return existing entry_id for same-tx retry check.
 * @deprecated Prefer confirmEntryWithTx RPC for atomic verify flow.
 */
export async function claimOrGetVerifiedTransaction(
  txSig: string,
  raffleId: string,
  entryId: string,
  walletAddress: string,
  amountPaid: number
): Promise<ClaimVerifiedTransactionResult> {
  const { error: insertError } = await getSupabaseAdmin()
    .from('verified_transactions')
    .insert({
      tx_sig: txSig,
      raffle_id: raffleId,
      entry_id: entryId,
      wallet_address: walletAddress,
      amount_paid: amountPaid,
    })

  if (!insertError) {
    return { claimed: true }
  }

  if (insertError.code !== '23505') {
    console.error('Error inserting verified_transaction:', insertError)
    throw insertError
  }

  const { data: existing, error: selectError } = await getSupabaseAdmin()
    .from('verified_transactions')
    .select('entry_id')
    .eq('tx_sig', txSig)
    .single()

  if (selectError || !existing?.entry_id) {
    console.error('Duplicate tx_sig but failed to load row:', selectError)
    throw new TransactionSignatureAlreadyUsedError()
  }

  return { claimed: false, existingEntryId: existing.entry_id as string }
}

/** Result of successful confirm_entry_with_tx RPC (entry is snake_case from DB). */
export interface ConfirmEntryWithTxResult {
  success: true
  entry: Entry
}

function mapRpcError(message: string): never {
  if (message.includes('tx_already_used')) throw new TxAlreadyUsedError()
  if (message.includes('insufficient_tickets')) throw new InsufficientTicketsError()
  if (message.includes('batch_empty')) throw new ConfirmEntryInvalidStateError(message)
  if (message.includes('invalid_state')) throw new ConfirmEntryInvalidStateError(message)
  if (message.includes('invalid_token')) throw new ConfirmEntryInvalidStateError(message)
  if (message.includes('token_expired')) throw new ConfirmEntryInvalidStateError(message)
  if (message.includes('complimentary_quota_exceeded')) throw new ComplimentaryQuotaExceededError()
  if (message.includes('entry_not_found')) throw new ConfirmEntryInvalidStateError(message)
  if (message.includes('raffle_not_found')) throw new ConfirmEntryInvalidStateError(message)
  throw new Error(message)
}

function coerceRpcJsonRecord(data: unknown): Record<string, unknown> | null {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>
  }
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

/**
 * Atomic confirm entry with tx via Postgres RPC.
 * Locks raffle + entry, validates, inserts verified_transactions, enforces max_tickets, updates entry.
 * Idempotent: same entry + same tx returns success (already confirmed).
 * @throws TxAlreadyUsedError, InsufficientTicketsError, ConfirmEntryInvalidStateError
 */
export async function confirmEntryWithTx(
  entryId: string,
  raffleId: string,
  walletAddress: string,
  txSig: string,
  amountPaid: number,
  ticketQuantity: number
): Promise<ConfirmEntryWithTxResult> {
  const { data, error } = await getSupabaseAdmin().rpc('confirm_entry_with_tx', {
    p_entry_id: entryId,
    p_raffle_id: raffleId,
    p_wallet_address: walletAddress,
    p_tx_sig: txSig,
    p_amount_paid: amountPaid,
    p_ticket_quantity: ticketQuantity,
  })

  if (error) {
    mapRpcError(error.message)
  }

  const row = coerceRpcJsonRecord(data)
  if (!row || !('entry' in row) || row.success !== true) {
    console.error('Unexpected confirm_entry_with_tx response:', typeof data, data)
    throw new Error('Invalid response from confirm_entry_with_tx')
  }

  return { success: true, entry: row.entry as Entry }
}

/** One Solana signature confirms every cart row — single DB txn (migration 090). */
export async function confirmCartBatchWithTx(
  walletAddress: string,
  txSig: string,
  entryIds: readonly string[]
): Promise<{ success: true; entryIds: string[] }> {
  const uniqueSorted = [...new Set(entryIds.map(id => id.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  )
  if (uniqueSorted.length === 0) {
    throw new ConfirmEntryInvalidStateError('batch_empty')
  }

  const { data, error } = await getSupabaseAdmin().rpc('confirm_cart_batch_with_tx', {
    p_wallet_address: walletAddress.trim(),
    p_tx_sig: txSig.trim(),
    p_entry_ids: uniqueSorted,
  })

  if (error) {
    mapRpcError(error.message)
  }

  const parsed = coerceRpcJsonRecord(data)
  if (!parsed || parsed.success !== true) {
    console.error('Unexpected confirm_cart_batch_with_tx response:', typeof data, data)
    throw new Error('Invalid response from confirm_cart_batch_with_tx')
  }

  return { success: true, entryIds: uniqueSorted }
}

export async function hasConfirmedEntryForWalletInRaffle(
  raffleId: string,
  walletAddress: string
): Promise<boolean> {
  const rid = raffleId.trim()
  const w = walletAddress.trim()
  if (!rid || !w) return false

  const { count, error } = await getSupabaseAdmin()
    .from('entries')
    .select('*', { count: 'exact', head: true })
    .eq('raffle_id', rid)
    .eq('wallet_address', w)
    .eq('status', 'confirmed')

  if (error) {
    console.error('hasConfirmedEntryForWalletInRaffle:', error.message)
    return true
  }
  return (count ?? 0) > 0
}

/** True if this wallet has already confirmed a referral complimentary (free) ticket on any raffle. */
export async function hasConfirmedReferralComplimentaryGlobally(
  walletAddress: string
): Promise<boolean> {
  const w = walletAddress.trim()
  if (!w) return false

  const { count, error } = await getSupabaseAdmin()
    .from('entries')
    .select('*', { count: 'exact', head: true })
    .eq('wallet_address', w)
    .eq('referral_complimentary', true)
    .eq('status', 'confirmed')

  if (error) {
    console.error('hasConfirmedReferralComplimentaryGlobally:', error.message)
    return true
  }
  return (count ?? 0) > 0
}

/**
 * Reject any other pending referral complimentary rows for this wallet (any raffle).
 * Ensures only one in-flight free ticket and avoids orphan pendings blocking UX.
 */
export async function invalidatePendingReferralComplimentaryEntriesForWallet(
  walletAddress: string
): Promise<void> {
  const w = walletAddress.trim()
  if (!w) return

  const { error } = await getSupabaseAdmin()
    .from('entries')
    .update({ status: 'rejected' })
    .eq('wallet_address', w)
    .eq('referral_complimentary', true)
    .eq('status', 'pending')

  if (error) {
    console.error('invalidatePendingReferralComplimentaryEntriesForWallet:', error.message)
  }
}

/**
 * Confirm a referral complimentary row (0 paid) using one-time token + DB RPC.
 */
export async function confirmComplimentaryReferralEntry(
  entryId: string,
  token: string
): Promise<ConfirmEntryWithTxResult> {
  const { data, error } = await getSupabaseAdmin().rpc('confirm_complimentary_referral_entry', {
    p_entry_id: entryId,
    p_token: token.trim(),
  })

  if (error) {
    mapRpcError(error.message)
  }

  if (!data || typeof data !== 'object' || !('entry' in data) || data.success !== true) {
    console.error('Unexpected confirm_complimentary_referral_entry response:', data)
    throw new Error('Invalid response from confirm_complimentary_referral_entry')
  }

  return { success: true, entry: data.entry as Entry }
}

export async function getEntryById(id: string) {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      console.error('Error fetching entry:', error)
      return null
    }

    return data as Entry
  }, { maxRetries: 2 })
}

export async function getEntryByTransactionSignature(transactionSignature: string) {
  const sig = transactionSignature.trim()
  if (!sig) return null
  return withRetry(async () => {
    /** Batch cart confirms several rows with one signature; never use maybeSingle here. */
    const { data, error } = await getSupabaseAdmin()
      .from('entries')
      .select('*')
      .eq('transaction_signature', sig)
      .order('verified_at', { ascending: false, nullsFirst: false })
      .limit(1)

    if (error) {
      console.error('Error fetching entry by transaction signature:', error)
      return null
    }
    const row = Array.isArray(data) && data[0] ? data[0] : null
    return row as Entry | null
  }, { maxRetries: 2 })
}

/**
 * All pending rows sharing a Solana signature (multi-raffle cart batch checkout).
 */
export async function getPendingEntriesByTransactionSignature(
  transactionSignature: string
): Promise<Entry[]> {
  const sig = transactionSignature.trim()
  if (!sig) return []

  const { data, error } = await getSupabaseAdmin()
    .from('entries')
    .select('*')
    .eq('transaction_signature', sig)
    .eq('status', 'pending')
    .order('raffle_id', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    console.error('getPendingEntriesByTransactionSignature:', error.message)
    return []
  }
  return (data || []) as Entry[]
}

/**
 * Get IDs of pending entries for a raffle + wallet.
 * Used to avoid invalidating an entry that is currently being verified.
 */
export async function getPendingEntryIdsForWalletAndRaffle(
  raffleId: string,
  walletAddress: string
): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('entries')
    .select('id')
    .eq('raffle_id', raffleId)
    .eq('wallet_address', walletAddress)
    .eq('status', 'pending')

  if (error) {
    console.error('Error fetching pending entry IDs:', error)
    return []
  }
  return (data || []).map((row) => row.id as string)
}

/**
 * Pending rows that already have a saved Solana signature are mid-flight confirmations.
 * Never reject those in invalidate — a second create-batch would orphan the payment vs entry IDs.
 */
export async function hasPendingWithSavedSignatureForWalletRaffle(
  raffleId: string,
  walletAddress: string
): Promise<boolean> {
  const rid = raffleId.trim()
  const w = walletAddress.trim()
  if (!rid || !w) return false

  const { data, error } = await getSupabaseAdmin()
    .from('entries')
    .select('transaction_signature')
    .eq('raffle_id', rid)
    .eq('wallet_address', w)
    .eq('status', 'pending')
    .limit(25)

  if (error || !data?.length) return false
  return data.some(row => {
    const s = row.transaction_signature
    return typeof s === 'string' && s.trim().length >= 80
  })
}

/**
 * Invalidate unsigned pending entries for the same raffle + wallet.
 * Skips rows with a stored signature (payment submitted / verifying).
 */
export async function invalidateAllPendingEntriesForWallet(
  raffleId: string,
  walletAddress: string
): Promise<void> {
  const rid = raffleId.trim()
  const w = walletAddress.trim()
  if (!rid || !w) return

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('entries')
    .select('id, transaction_signature')
    .eq('raffle_id', rid)
    .eq('wallet_address', w)
    .eq('status', 'pending')

  if (error || !data?.length) return

  const toReject = data
    .filter(row => {
      const sig = row.transaction_signature
      return typeof sig !== 'string' || sig.trim().length < 80
    })
    .map(row => row.id as string)

  if (!toReject.length) return

  const { error: upErr } = await admin.from('entries').update({ status: 'rejected' }).in('id', toReject)

  if (upErr) {
    console.error('Error invalidating previous pending entries:', upErr)
  }
}

export async function createEntry(
  entry: Omit<Entry, 'id' | 'created_at' | 'verified_at' | 'restored_at' | 'restored_by'>
) {
  // Validate currency is SOL, USDC, or OWL
  if (!RAFFLE_CURRENCIES.includes(entry.currency as 'SOL' | 'USDC' | 'OWL')) {
    console.error('Invalid currency for entry. Must be SOL, USDC, or OWL.')
    return null
  }

  return withRetry(async () => {
    if (entry.referral_complimentary === true) {
      await invalidatePendingReferralComplimentaryEntriesForWallet(entry.wallet_address)
    }
    // Invalidate first so only one pending per wallet+raffle (eliminates race)
    await invalidateAllPendingEntriesForWallet(entry.raffle_id, entry.wallet_address)

    const { data, error } = await getSupabaseAdmin()
      .from('entries')
      .insert(entry)
      .select()
      .single()

    if (error) {
      console.error('Error creating entry:', error)
      return null
    }

    return data as Entry
  }, { maxRetries: 2 })
}

/**
 * Save transaction signature to an entry without changing status
 * This allows automatic verification to retry later
 */
export async function saveTransactionSignature(
  id: string,
  transactionSignature: string
) {
  const { data, error } = await getSupabaseAdmin()
    .from('entries')
    .update({ transaction_signature: transactionSignature })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new TransactionSignatureAlreadyUsedError()
    }
    console.error('Error saving transaction signature:', error)
    console.error('Entry ID:', id)
    console.error('Supabase error details:', JSON.stringify(error, null, 2))
    return null
  }

  return data as Entry
}

export async function updateEntryStatus(
  id: string,
  status: Entry['status'],
  transactionSignature?: string
) {
  return withRetry(async () => {
    const updateData: Partial<Entry> = {
      status,
      verified_at: status === 'confirmed' ? new Date().toISOString() : null,
    }

    if (transactionSignature) {
      updateData.transaction_signature = transactionSignature
    }

    const { data, error } = await getSupabaseAdmin()
      .from('entries')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        throw new TransactionSignatureAlreadyUsedError()
      }
      console.error('Error updating entry:', error)
      console.error('Entry ID:', id)
      console.error('Update data:', updateData)
      console.error('Supabase error details:', JSON.stringify(error, null, 2))
      return null
    }

    return data as Entry
  }, { maxRetries: 2 })
}

export async function deleteEntry(id: string, deletedBy: string) {
  // First, get the entry to be deleted
  const entry = await getEntryById(id)
  if (!entry) {
    console.warn('No entry found with id:', id)
    return false
  }

  // Store the entry in deleted_entries audit table before deleting
  const { error: auditError } = await getSupabaseAdmin()
    .from('deleted_entries')
    .insert({
      original_entry_id: entry.id,
      raffle_id: entry.raffle_id,
      wallet_address: entry.wallet_address,
      ticket_quantity: entry.ticket_quantity,
      transaction_signature: entry.transaction_signature,
      status: entry.status,
      amount_paid: entry.amount_paid,
      currency: entry.currency,
      created_at: entry.created_at,
      verified_at: entry.verified_at,
      deleted_by: deletedBy,
      original_entry_data: entry as any,
    })

  if (auditError) {
    console.error('Error storing deleted entry in audit table:', auditError)
    // Continue with deletion even if audit fails
  }

  // Now delete the entry
  const { error, data } = await getSupabaseAdmin()
    .from('entries')
    .delete()
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error deleting entry:', error)
    console.error('Entry ID:', id)
    console.error('Supabase error details:', JSON.stringify(error, null, 2))
    return false
  }

  // Check if any rows were actually deleted
  if (!data) {
    console.warn('No entry found with id:', id)
    return false
  }

  console.log('Successfully deleted entry:', id)
  return true
}

export async function getDeletedEntries(raffleId?: string) {
  let query = supabase
    .from('deleted_entries')
    .select('*')
    .order('deleted_at', { ascending: false })

  if (raffleId) {
    query = query.eq('raffle_id', raffleId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching deleted entries:', error)
    return []
  }

  return data || []
}

/**
 * Mark an entry as restored (when it's restored via verify-by-tx endpoint)
 */
export async function markEntryAsRestored(
  id: string,
  restoredBy?: string
) {
  const { data, error } = await getSupabaseAdmin()
    .from('entries')
    .update({ 
      restored_at: new Date().toISOString(),
      restored_by: restoredBy || null,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error marking entry as restored:', error)
    console.error('Entry ID:', id)
    return null
  }

  return data as Entry
}

/**
 * Get all restored entries (entries that have restored_at set, or were likely restored)
 * This includes:
 * 1. Entries explicitly marked as restored (have restored_at)
 * 2. Entries that were likely restored before tracking was added:
 *    - Have transaction_signature
 *    - Have verified_at
 *    - Created significantly before verified_at (more than 5 minutes, indicating restoration)
 */
export async function getRestoredEntries(walletAddress?: string) {
  // First, get entries explicitly marked as restored
  let query = supabase
    .from('entries')
    .select('*')
    .not('restored_at', 'is', null)
    .order('restored_at', { ascending: false })

  if (walletAddress) {
    query = query.eq('wallet_address', walletAddress)
  }

  const { data: explicitlyRestored, error: error1 } = await query

  if (error1) {
    console.error('Error fetching explicitly restored entries:', error1)
  }

  // Also get entries that were likely restored before tracking was added
  // These are entries with transaction_signature and verified_at where
  // created_at is significantly before verified_at (indicating restoration)
  let likelyRestoredQuery = supabase
    .from('entries')
    .select('*')
    .not('transaction_signature', 'is', null)
    .not('verified_at', 'is', null)
    .is('restored_at', null) // Don't include ones already marked
    .order('verified_at', { ascending: false })

  if (walletAddress) {
    likelyRestoredQuery = likelyRestoredQuery.eq('wallet_address', walletAddress)
  }

  const { data: likelyRestored, error: error2 } = await likelyRestoredQuery

  if (error2) {
    console.error('Error fetching likely restored entries:', error2)
  }

  // Filter likely restored entries: created_at should be at least 5 minutes before verified_at
  // This indicates the entry was pending/rejected and then restored later
  const filteredLikelyRestored = (likelyRestored || []).filter((entry) => {
    if (!entry.created_at || !entry.verified_at) return false
    
    const createdTime = new Date(entry.created_at).getTime()
    const verifiedTime = new Date(entry.verified_at).getTime()
    const timeDiffMinutes = (verifiedTime - createdTime) / (1000 * 60)
    
    // If verified more than 5 minutes after creation, it was likely restored
    return timeDiffMinutes > 5
  })

  // Combine both sets and remove duplicates
  const allRestored = [
    ...(explicitlyRestored || []),
    ...filteredLikelyRestored,
  ]

  // Remove duplicates by ID
  const uniqueRestored = Array.from(
    new Map(allRestored.map((entry) => [entry.id, entry])).values()
  )

  // Sort by restored_at (if available) or verified_at, descending
  uniqueRestored.sort((a, b) => {
    const aTime = a.restored_at ? new Date(a.restored_at).getTime() : (a.verified_at ? new Date(a.verified_at).getTime() : 0)
    const bTime = b.restored_at ? new Date(b.restored_at).getTime() : (b.verified_at ? new Date(b.verified_at).getTime() : 0)
    return bTime - aTime
  })

  return uniqueRestored as Entry[]
}

/**
 * Get all pending entries (for admin Owl Vision improvement workflow).
 * Returns entries that could improve Owl Vision score when confirmed.
 */
export async function getPendingEntries(): Promise<Entry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching pending entries:', error)
    return []
  }
  return (data || []) as Entry[]
}

/**
 * Pending entries that already have a tx signature (candidates for bulk re-verification).
 * Includes raffles in any status (e.g. completed) — unlike Owl Vision list.
 */
export async function getPendingEntriesWithTransactionSignature(options?: {
  currency?: string
  limit?: number
}): Promise<Entry[]> {
  const rawLimit = options?.limit ?? 60
  const limit = Math.min(Math.max(rawLimit, 1), 200)

  let query = getSupabaseAdmin()
    .from('entries')
    .select('*')
    .eq('status', 'pending')
    .not('transaction_signature', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  const c = options?.currency?.trim().toUpperCase()
  if (c === 'SOL' || c === 'USDC' || c === 'OWL') {
    query = query.eq('currency', c)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching pending entries with tx:', error)
    return []
  }
  return (data || []) as Entry[]
}

/** Minimal raffle fields needed for "my entries" list + winner NFT claim on dashboard */
export interface RaffleInfoForEntry {
  id: string
  slug: string
  title: string
  end_time: string
  status: string | null
  winner_wallet: string | null
  winner_selected_at: string | null
  ticket_payments_to_funds_escrow?: boolean | null
  prize_type?: string | null
  prize_currency?: string | null
  nft_mint_address?: string | null
  nft_transfer_transaction?: string | null
  prize_deposited_at?: string | null
  prize_returned_at?: string | null
  prize_standard?: string | null
}

export interface EntryWithRaffle {
  entry: Entry
  raffle: RaffleInfoForEntry
  /** Buyer-facing label for `entry.referrer_wallet` (My Dashboard). */
  referred_by_label?: string | null
}

export interface RefundCandidateByWallet {
  wallet: string
  totalAmount: number
  refundedAmount: number
  pendingAmount: number
  confirmedEntries: number
  refundedEntries: number
}

/**
 * Get all entries for a wallet with raffle info.
 * Used so users can see only their own raffles entered (e.g. dashboard).
 * Uses server read client when available so dashboard API can load data (bypasses RLS).
 */
export async function getEntriesByWallet(walletAddress: string): Promise<EntryWithRaffle[]> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('entries')
    .select(`
      *,
      raffles (id, slug, title, end_time, status, winner_wallet, winner_selected_at, ticket_payments_to_funds_escrow, prize_type, prize_currency, nft_mint_address, nft_transfer_transaction, prize_deposited_at, prize_returned_at, prize_standard)
    `)
    .eq('wallet_address', walletAddress)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching entries by wallet:', error)
    return []
  }

  if (!data || data.length === 0) return []

  const result: EntryWithRaffle[] = []
  for (const row of data as any[]) {
    const raffle = row.raffles
    if (!raffle) continue
    const { raffles: _, ...entryRow } = row
    result.push({
      entry: entryRow as Entry,
      raffle: raffle as RaffleInfoForEntry,
    })
  }

  const referrers = new Set<string>()
  for (const r of result) {
    const rw = r.entry.referrer_wallet?.trim()
    if (rw) referrers.add(rw)
  }
  if (referrers.size > 0) {
    const names = await getDisplayNamesByWallets([...referrers])
    const shortWallet = (w: string) => {
      const t = w.trim()
      if (t.length <= 12) return t
      return `${t.slice(0, 4)}…${t.slice(-4)}`
    }
    for (const r of result) {
      const rw = r.entry.referrer_wallet?.trim()
      r.referred_by_label = rw ? (names[rw] || shortWallet(rw)) : null
    }
  }

  return result
}

/**
 * Count of confirmed entries that are not refunded (still represent live ticket liability / volume).
 */
export async function countUnrefundedConfirmedEntries(raffleId: string): Promise<number> {
  const id = typeof raffleId === 'string' ? raffleId.trim() : ''
  if (!id) return Number.POSITIVE_INFINITY

  const { count, error } = await getSupabaseForServerRead(supabase)
    .from('entries')
    .select('*', { count: 'exact', head: true })
    .eq('raffle_id', id)
    .eq('status', 'confirmed')
    .is('refunded_at', null)

  if (error) {
    console.error('countUnrefundedConfirmedEntries:', error)
    return Number.POSITIVE_INFINITY
  }
  return count ?? 0
}

/**
 * For creator dashboard: aggregated refund candidates per raffle.
 * Includes confirmed entries only; groups by wallet and computes pending amount.
 */
export async function getRefundCandidatesByRaffleIds(
  raffleIds: string[]
): Promise<Record<string, RefundCandidateByWallet[]>> {
  const ids = Array.from(new Set(raffleIds.map((x) => x.trim()).filter(Boolean)))
  if (ids.length === 0) return {}

  const { data, error } = await getSupabaseForServerRead(supabase)
    .from('entries')
    .select('raffle_id, wallet_address, amount_paid, status, refunded_at')
    .in('raffle_id', ids)
    .eq('status', 'confirmed')

  if (error) {
    console.error('Error fetching refund candidates by raffle IDs:', error)
    return {}
  }

  const byRaffle = new Map<string, Map<string, RefundCandidateByWallet>>()
  for (const row of data || []) {
    const raffleId = String((row as { raffle_id?: string }).raffle_id || '').trim()
    const wallet = String((row as { wallet_address?: string }).wallet_address || '').trim()
    if (!raffleId || !wallet) continue
    const amount = Number((row as { amount_paid?: unknown }).amount_paid ?? 0)
    const safeAmount = Number.isFinite(amount) ? amount : 0
    const refunded = !!(row as { refunded_at?: string | null }).refunded_at

    const walletMap = byRaffle.get(raffleId) ?? new Map<string, RefundCandidateByWallet>()
    const existing = walletMap.get(wallet) ?? {
      wallet,
      totalAmount: 0,
      refundedAmount: 0,
      pendingAmount: 0,
      confirmedEntries: 0,
      refundedEntries: 0,
    }
    existing.totalAmount += safeAmount
    existing.confirmedEntries += 1
    if (refunded) {
      existing.refundedAmount += safeAmount
      existing.refundedEntries += 1
    }
    existing.pendingAmount = Math.max(0, existing.totalAmount - existing.refundedAmount)
    walletMap.set(wallet, existing)
    byRaffle.set(raffleId, walletMap)
  }

  const out: Record<string, RefundCandidateByWallet[]> = {}
  for (const [raffleId, walletMap] of byRaffle.entries()) {
    out[raffleId] = Array.from(walletMap.values()).sort((a, b) => b.pendingAmount - a.pendingAmount)
  }
  return out
}

/** Short mutex so two refund requests for the same entry cannot double-pay. */
export async function acquireEntryRefundLock(entryId: string): Promise<{ acquired: boolean }> {
  const lockAt = new Date().toISOString()
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  await getSupabaseAdmin()
    .from('entries')
    .update({ refund_lock_started_at: null })
    .eq('id', entryId)
    .is('refunded_at', null)
    .not('refund_lock_started_at', 'is', null)
    .lt('refund_lock_started_at', staleBefore)

  const { data, error } = await getSupabaseAdmin()
    .from('entries')
    .update({ refund_lock_started_at: lockAt })
    .eq('id', entryId)
    .eq('status', 'confirmed')
    .is('refunded_at', null)
    .is('refund_lock_started_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('acquireEntryRefundLock error:', error)
    throw new Error(`Failed to acquire refund lock: ${error.message}`)
  }

  return { acquired: !!data }
}

export async function clearEntryRefundLock(entryId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('entries')
    .update({ refund_lock_started_at: null })
    .eq('id', entryId)
  if (error) {
    console.error('clearEntryRefundLock error:', error)
    throw new Error(`Failed to clear refund lock: ${error.message}`)
  }
}

export async function markEntryRefunded(entryId: string, transactionSignature: string): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await getSupabaseAdmin()
    .from('entries')
    .update({
      refunded_at: now,
      refund_transaction_signature: transactionSignature,
      refund_lock_started_at: null,
    })
    .eq('id', entryId)

  if (error) {
    console.error('markEntryRefunded error:', error)
    throw new Error(`Failed to mark entry refunded: ${error.message}`)
  }
}

/**
 * Full admin manual refund recording: set refunded_at for confirmed, unrefunded entries in this raffle only.
 * One on-chain tx may cover multiple rows — the same signature is stored on each updated entry.
 */
export async function markEntriesRefundedManual(
  raffleId: string,
  entryIds: string[],
  transactionSignature: string
): Promise<{ updatedIds: string[] }> {
  const rid = typeof raffleId === 'string' ? raffleId.trim() : ''
  const sig = typeof transactionSignature === 'string' ? transactionSignature.trim() : ''
  const ids = Array.from(new Set(entryIds.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)))
  if (!rid || ids.length === 0 || !sig) {
    return { updatedIds: [] }
  }

  const now = new Date().toISOString()
  const { data, error } = await getSupabaseAdmin()
    .from('entries')
    .update({
      refunded_at: now,
      refund_transaction_signature: sig,
      refund_lock_started_at: null,
    })
    .in('id', ids)
    .eq('raffle_id', rid)
    .eq('status', 'confirmed')
    .is('refunded_at', null)
    .select('id')

  if (error) {
    console.error('markEntriesRefundedManual:', error)
    throw new Error(`Failed to mark entries refunded: ${error.message}`)
  }

  const updatedIds = (data ?? []).map((row) => String((row as { id: string }).id))
  return { updatedIds }
}

/** Cap how many matching entry rows we scan when aggregating by raffle (dashboard list). */
const PENDING_MANUAL_REFUND_ENTRY_SCAN_LIMIT = 25_000

export type UnrefundedConfirmedEntryRaffleRow = {
  raffleId: string
  unrefundedEntryCount: number
}

/**
 * Raffles that have confirmed tickets not yet marked refunded (manual admin record or buyer self-claim).
 * Uses DB aggregation (migration 059) so raffles are not dropped when >25k unrefunded rows exist globally.
 */
export async function listRaffleUnrefundedConfirmedEntryCounts(): Promise<UnrefundedConfirmedEntryRaffleRow[]> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.rpc('list_raffle_unrefunded_confirmed_entry_counts')

  if (!error && Array.isArray(data)) {
    return (data as { raffle_id: string; unrefunded_entry_count: number | string }[]).map((row) => ({
      raffleId: String(row.raffle_id),
      unrefundedEntryCount: Number(row.unrefunded_entry_count),
    }))
  }

  if (error) {
    console.error('listRaffleUnrefundedConfirmedEntryCounts rpc:', error)
  }

  const { data: rows, error: scanError } = await admin
    .from('entries')
    .select('raffle_id')
    .eq('status', 'confirmed')
    .is('refunded_at', null)
    .limit(PENDING_MANUAL_REFUND_ENTRY_SCAN_LIMIT)

  if (scanError) {
    console.error('listRaffleUnrefundedConfirmedEntryCounts scan fallback:', scanError)
    return []
  }

  const counts = new Map<string, number>()
  for (const row of rows ?? []) {
    const rid = String((row as { raffle_id?: string }).raffle_id ?? '').trim()
    if (!rid) continue
    counts.set(rid, (counts.get(rid) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([raffleId, unrefundedEntryCount]) => ({ raffleId, unrefundedEntryCount }))
    .sort((a, b) => b.unrefundedEntryCount - a.unrefundedEntryCount)
}

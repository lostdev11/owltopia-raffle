import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { Entry } from '@/lib/types'
import { withRetry } from '@/lib/db-retry'
import { RAFFLE_CURRENCIES } from '@/lib/tokens'

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
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .eq('transaction_signature', transactionSignature)
      .maybeSingle()

    if (error) {
      console.error('Error fetching entry by transaction signature:', error)
      return null
    }

    return data as Entry | null
  }, { maxRetries: 2 })
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
  const { data, error } = await supabase
    .from('entries')
    .update({ transaction_signature: transactionSignature })
    .eq('id', id)
    .select()
    .single()

  if (error) {
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

/** Minimal raffle fields needed for "my entries" list */
export interface RaffleInfoForEntry {
  id: string
  slug: string
  title: string
  end_time: string
  status: string | null
  winner_wallet: string | null
  winner_selected_at: string | null
}

export interface EntryWithRaffle {
  entry: Entry
  raffle: RaffleInfoForEntry
}

/**
 * Get all entries for a wallet with raffle info.
 * Used so users can see only their own raffles entered, with date and blockchain validation.
 */
export async function getEntriesByWallet(walletAddress: string): Promise<EntryWithRaffle[]> {
  const { data, error } = await supabase
    .from('entries')
    .select(`
      *,
      raffles (id, slug, title, end_time, status, winner_wallet, winner_selected_at)
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
  return result
}

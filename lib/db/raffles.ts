import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import type { Raffle, Entry } from '@/lib/types'
import { withRetry } from '@/lib/db-retry'

function getSupabaseForRead() {
  return getSupabaseForServerRead(supabase)
}

// Cache for migration status to avoid repeated checks
let nftMigrationCache: { applied: boolean; checked: boolean } = {
  applied: false,
  checked: false,
}

/**
 * Check if NFT support migration has been applied by checking if prize_type column exists
 * Results are cached to avoid repeated database queries
 */
async function checkNftMigrationApplied(): Promise<boolean> {
  // Return cached result if already checked
  if (nftMigrationCache.checked) {
    return nftMigrationCache.applied
  }

  try {
    // Try to query prize_type column - if it exists, migration is applied
    // Use a simple query that won't fail even if table is empty
    const { error } = await getSupabaseForRead()
      .from('raffles')
      .select('id, prize_type')
      .limit(1)
    
    // If error mentions missing column or schema, migration not applied
    let isApplied = true
    if (error) {
      const errorMsg = error.message?.toLowerCase() || ''
      const errorCode = error.code?.toLowerCase() || ''
      
      // Check for column-related errors
      if (errorMsg.includes('column') || 
          errorMsg.includes('does not exist') ||
          errorMsg.includes('prize_type') ||
          errorCode === '42703' || // PostgreSQL undefined_column error code
          errorCode === '42p01') { // PostgreSQL undefined_table error code
        isApplied = false
      }
      // Other errors (like no rows, connection issues) are unrelated - assume migration is applied
    }
    
    // Cache the result
    nftMigrationCache = {
      applied: isApplied,
      checked: true,
    }
    
    return isApplied
  } catch (err) {
    // If query fails completely, assume migration not applied to be safe
    console.warn('Could not check NFT migration status, assuming not applied:', err)
    nftMigrationCache = {
      applied: false,
      checked: true,
    }
    return false
  }
}

/**
 * Get the base columns that exist before NFT migration
 */
function getBaseRaffleColumns(): string {
  return 'id,slug,title,description,image_url,prize_amount,prize_currency,ticket_price,currency,max_tickets,min_tickets,start_time,end_time,original_end_time,theme_accent,edited_after_entries,created_at,updated_at,created_by,is_active,winner_wallet,winner_selected_at,status,nft_transfer_transaction,rank,floor_price'
}

// Cache column list so we only run migration check once per process (faster subsequent loads)
let raffleColumnsCache: string | null = null

const FULL_RAFFLE_COLUMNS = getBaseRaffleColumns() + ',prize_type,nft_mint_address,nft_collection_name,nft_token_id,nft_metadata_uri'

/**
 * Get all columns including NFT columns if migration is applied.
 * Uses cache so we only hit the DB once per process after the first getRaffles.
 */
async function getRaffleColumns(): Promise<string> {
  if (raffleColumnsCache !== null) {
    return raffleColumnsCache
  }
  const hasNftSupport = await checkNftMigrationApplied()
  raffleColumnsCache =
    hasNftSupport ? FULL_RAFFLE_COLUMNS : getBaseRaffleColumns()
  return raffleColumnsCache
}

/** Result type for getRaffles so callers can distinguish error from empty list (e.g. RLS/403). */
export type GetRafflesResult = { data: Raffle[]; error: null } | { data: Raffle[]; error: { message: string; code?: string } }

function isColumnError(errorMessage: string, errorCode?: string): boolean {
  const msg = (errorMessage || '').toLowerCase()
  const code = (errorCode || '').toLowerCase()
  return (
    msg.includes('column') ||
    msg.includes('does not exist') ||
    msg.includes('prize_type') ||
    msg.includes('nft') ||
    code === '42703' ||
    code === '42p01'
  )
}

/** User-friendly message for connection/timeout errors shown in the UI */
const CONNECTION_ERROR_MESSAGE =
  'Unable to load raffles. Please check your connection and try again.'

function toUserFriendlyMessage(rawMessage: string): string {
  if (!rawMessage || rawMessage === 'unknown') return 'Failed to fetch raffles'
  const lower = rawMessage.toLowerCase()
  if (
    lower.includes('connection') ||
    lower.includes('timeout') ||
    lower.includes('upstream') ||
    lower.includes('disconnect') ||
    lower.includes('reset') ||
    lower.includes('network') ||
    lower.includes('fetch failed')
  ) {
    return CONNECTION_ERROR_MESSAGE
  }
  return rawMessage
}

/** Same patterns as isRetryableError; check raw string so we always throw for connection/timeout. */
function isRetryableMessage(rawMessage: string): boolean {
  const lower = (rawMessage ?? '').toLowerCase()
  const patterns = [
    'connection', 'timeout', 'network', 'upstream', 'disconnect', 'reset',
    'econnrefused', 'enotfound', 'etimedout', 'socket', 'fetch failed', 'failed to fetch',
    'rest error', 'postgrest', 'pgrst', 'connection terminated',
    'server closed the connection', 'connection reset',
  ]
  return patterns.some((p) => lower.includes(p))
}

/** Status values for public raffle listing (excludes draft) */
const PUBLIC_STATUSES = ['live', 'ready_to_draw', 'completed'] as const

/** Status values when admin needs to see drafts too */
const ALL_STATUSES = ['draft', 'live', 'ready_to_draw', 'completed'] as const

/** REST select: full columns including NFT (matches Raffle type) */
const RAFFLE_SELECT_FULL =
  getBaseRaffleColumns() + ',prize_type,nft_mint_address,nft_collection_name,nft_token_id,nft_metadata_uri'
/** REST select: base only (when NFT migration not applied) */
const RAFFLE_SELECT_BASE = getBaseRaffleColumns()

function normalizeBaseRowToRaffle(row: Record<string, unknown>): Raffle {
  return {
    ...row,
    prize_type: 'crypto' as const,
    nft_mint_address: null,
    nft_collection_name: null,
    nft_token_id: null,
    nft_metadata_uri: null,
  } as Raffle
}

function isColumnOrSchemaError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('column') ||
    m.includes('does not exist') ||
    m.includes('prize_type') ||
    m.includes('nft_') ||
    m.includes('42703') ||
    m.includes('42p01')
  )
}

/**
 * Direct REST fetch for raffles (bypasses Supabase JS client).
 * Use for server render and API route to avoid connection timeouts on cold start / paused project.
 */
async function fetchRafflesViaRestRaw(
  baseUrl: string,
  apiKey: string,
  activeOnly: boolean,
  select: string,
  perAttemptMs: number
): Promise<Raffle[]> {
  const url = new URL(`${baseUrl}/rest/v1/raffles`)
  url.searchParams.set('status', 'in.(live,ready_to_draw,completed)')
  if (activeOnly) url.searchParams.set('is_active', 'is.true')
  url.searchParams.set('order', 'created_at.desc,id.desc')
  url.searchParams.set('limit', '24')
  url.searchParams.set('select', select)

  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), perAttemptMs)
  try {
    const res = await fetch(url.toString(), {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        Connection: 'keep-alive',
      },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`rest error: Supabase ${res.status} ${text.slice(0, 200)}`)
    }
    const data = await res.json()
    if (select === RAFFLE_SELECT_BASE && Array.isArray(data)) {
      return data.map((row: Record<string, unknown>) => normalizeBaseRowToRaffle(row))
    }
    return Array.isArray(data) ? data : []
  } finally {
    clearTimeout(id)
  }
}

export interface GetRafflesViaRestOptions {
  activeOnly?: boolean
  timeoutMs?: number
  maxRetries?: number
  perAttemptMs?: number
}

/**
 * Fetch raffles via direct REST with retries and optional timeout.
 * Prefer this for server-side raffles list when Supabase may be cold or slow.
 */
export async function getRafflesViaRest(
  activeOnly: boolean = false,
  options: GetRafflesViaRestOptions = {}
): Promise<GetRafflesResult> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const apiKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!baseUrl || !apiKey) {
    return {
      data: [],
      error: {
        message: 'Missing NEXT_PUBLIC_SUPABASE_URL or Supabase API key',
        code: 'CONFIG',
      },
    }
  }

  const timeoutMs = options.timeoutMs ?? 15_000
  const maxRetries = options.maxRetries ?? 2
  const perAttemptMs = options.perAttemptMs ?? 6_000

  const run = async (): Promise<Raffle[]> => {
    try {
      return await withRetry(
        async () => fetchRafflesViaRestRaw(baseUrl, apiKey, activeOnly, RAFFLE_SELECT_FULL, perAttemptMs),
        { maxRetries, initialDelayMs: 600 }
      )
    } catch (fullErr) {
      const msg = (fullErr as Error)?.message ?? ''
      if (!isColumnOrSchemaError(msg)) throw fullErr
      return await withRetry(
        async () => fetchRafflesViaRestRaw(baseUrl, apiKey, activeOnly, RAFFLE_SELECT_BASE, perAttemptMs),
        { maxRetries, initialDelayMs: 600 }
      )
    }
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const withTimeoutPromise =
    timeoutMs > 0
      ? Promise.race([
          run().then((result) => {
            if (timeoutId) clearTimeout(timeoutId)
            return result
          }),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error(`Request timed out after ${timeoutMs}ms`)),
              timeoutMs
            )
          }),
        ])
      : run()

  try {
    const data = await withTimeoutPromise
    return { data: Array.isArray(data) ? data : [], error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      data: [],
      error: { message: toUserFriendlyMessage(message), code: message.includes('timed out') ? 'TIMEOUT' : undefined },
    }
  }
}

/**
 * Fetch raffles for public list. No wallet filter — public list shows all raffles.
 * - activeOnly=false, includeDraft=false: fetches status IN ('live','ready_to_draw','completed') — excludes draft
 * - activeOnly=true: fetches status IN ('live','ready_to_draw') — active raffles only
 * - includeDraft=true: fetches all statuses including draft (for admin)
 * Does a single Supabase round-trip (no separate migration check) to avoid upstream timeouts.
 */
export async function getRaffles(
  activeOnly: boolean = false,
  options?: { includeDraft?: boolean }
): Promise<GetRafflesResult> {
  try {
    return await withRetry(async () => {
      const client = getSupabaseForRead()
      const columns = raffleColumnsCache ?? FULL_RAFFLE_COLUMNS
      const statuses = options?.includeDraft ? ALL_STATUSES : activeOnly ? ['live', 'ready_to_draw'] : PUBLIC_STATUSES
      let query = client
        .from('raffles')
        .select(columns)
        .in('status', statuses)
        .order('created_at', { ascending: false })
      const { data, error } = await query

      if (error) {
        if (isColumnError(error.message, error.code)) {
          raffleColumnsCache = getBaseRaffleColumns()
          nftMigrationCache = { applied: false, checked: true }
          const retryStatuses = options?.includeDraft ? ALL_STATUSES : activeOnly ? ['live', 'ready_to_draw'] : PUBLIC_STATUSES
          let retryQuery = client
            .from('raffles')
            .select(raffleColumnsCache)
            .in('status', retryStatuses)
            .order('created_at', { ascending: false })
          const retry = await retryQuery
          if (retry.error) {
            const err = retry.error as { message?: string; code?: string; details?: string }
            const msg = err?.message ?? 'unknown'
            if (isRetryableMessage(msg)) throw new Error(msg)
            const code = err?.code ?? ''
            const details = err?.details ?? ''
            console.warn(`Error fetching raffles (retry with base columns): message=${msg} code=${code} details=${details}`)
            return {
              data: [],
              error: { message: toUserFriendlyMessage(msg), code: err?.code },
            }
          }
          const raffles = (retry.data || []).map((r: any) => ({
            ...r,
            prize_type: 'crypto' as const,
            nft_mint_address: null,
            nft_collection_name: null,
            nft_token_id: null,
            nft_metadata_uri: null,
          })) as Raffle[]
          return { data: raffles, error: null }
        }
        const err = error as { message?: string; code?: string; details?: string }
        const msg = err?.message ?? 'unknown'
        if (isRetryableMessage(msg)) throw new Error(msg)
        const code = err?.code ?? ''
        const details = err?.details ?? ''
        console.warn(`Error fetching raffles: message=${msg} code=${code} details=${details}`)
        return {
          data: [],
          error: { message: toUserFriendlyMessage(msg), code: err?.code },
        }
      }

      raffleColumnsCache = columns
      nftMigrationCache = { applied: true, checked: true }
      const hasNftSupport = columns.includes('prize_type')
      let raffles = (data || []) as unknown as Raffle[]
      if (!hasNftSupport && data?.length) {
        raffles = data.map((raffle: any) => ({
          ...raffle,
          prize_type: 'crypto' as const,
          nft_mint_address: null,
          nft_collection_name: null,
          nft_token_id: null,
          nft_metadata_uri: null,
        })) as Raffle[]
      }
      return { data: raffles, error: null }
    }, { maxRetries: 2 })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    // Handled: we show a friendly message in the UI; log as warn to avoid red Server error in client
    console.warn(`Error fetching raffles after retries: message=${err.message} name=${err.name}`)
    return {
      data: [],
      error: { message: toUserFriendlyMessage(err.message) },
    }
  }
}

export async function getRaffleBySlug(slug: string) {
  return withRetry(async () => {
    const columns = await getRaffleColumns()
    const { data, error } = await getSupabaseForRead()
      .from('raffles')
      .select(columns)
      .eq('slug', slug)
      .single()

    if (error) {
      console.error('Error fetching raffle:', error)
      
      // Check if error is related to missing NFT columns
      const errorMsg = error.message?.toLowerCase() || ''
      if (errorMsg.includes('column') && 
          (errorMsg.includes('prize_type') || 
           errorMsg.includes('nft') || 
           errorMsg.includes('does not exist'))) {
        console.error(
          'Database migration missing: The NFT support migration (006_add_nft_support.sql) has not been applied. ' +
          'Please run the migration in your Supabase SQL Editor.'
        )
      }
      
      return null
    }

    // Ensure raffle has prize_type defaulted to 'crypto' if migration not applied
    const hasNftSupport = await checkNftMigrationApplied()
    if (!hasNftSupport && data) {
      const row = data as unknown as Record<string, unknown>
      return {
        ...row,
        prize_type: 'crypto' as const,
        nft_mint_address: null,
        nft_collection_name: null,
        nft_token_id: null,
        nft_metadata_uri: null,
      } as Raffle
    }

    return data as unknown as Raffle
  }, { maxRetries: 2 })
}

export async function getRaffleById(id: string) {
  return withRetry(async () => {
    const columns = await getRaffleColumns()
    const { data, error } = await getSupabaseForRead()
      .from('raffles')
      .select(columns)
      .eq('id', id)
      .single()

    if (error) {
      console.error('Error fetching raffle:', error)
      
      // Check if error is related to missing NFT columns
      const errorMsg = error.message?.toLowerCase() || ''
      if (errorMsg.includes('column') && 
          (errorMsg.includes('prize_type') || 
           errorMsg.includes('nft') || 
           errorMsg.includes('does not exist'))) {
        console.error(
          'Database migration missing: The NFT support migration (006_add_nft_support.sql) has not been applied. ' +
          'Please run the migration in your Supabase SQL Editor.'
        )
      }
      
      return null
    }

    // Ensure raffle has prize_type defaulted to 'crypto' if migration not applied
    const hasNftSupport = await checkNftMigrationApplied()
    if (!hasNftSupport && data) {
      const row = data as unknown as Record<string, unknown>
      return {
        ...row,
        prize_type: 'crypto' as const,
        nft_mint_address: null,
        nft_collection_name: null,
        nft_token_id: null,
        nft_metadata_uri: null,
      } as Raffle
    }

    return data as unknown as Raffle
  }, { maxRetries: 2 })
}

export async function getEntriesByRaffleId(raffleId: string) {
  // Fetch all entries using pagination to handle any Supabase row limits
  // Supabase defaults to 1000 rows per query, but projects can have custom limits
  const allEntries: Entry[] = []
  const pageSize = 1000
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await getSupabaseForRead()
      .from('entries')
      .select('*')
      .eq('raffle_id', raffleId)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (error) {
      console.error('Error fetching entries:', error)
      return []
    }

    if (!data || data.length === 0) {
      hasMore = false
    } else {
      allEntries.push(...(data as Entry[]))
      // If we got fewer than pageSize results, we've reached the end
      if (data.length < pageSize) {
        hasMore = false
      } else {
        offset += pageSize
      }
    }
  }

  return allEntries
}

/**
 * Generate a unique slug from a title by checking for duplicates
 * If the slug already exists, appends a number (e.g., "my-raffle-2")
 */
export async function generateUniqueSlug(baseSlug: string): Promise<string> {
  let slug = baseSlug
  let counter = 1
  
  // Check if slug exists, and if so, append a number
  while (true) {
    const existing = await getRaffleBySlug(slug)
    
    if (!existing) {
      // Slug is available
      return slug
    }
    
    // Slug exists, try with a number appended
    counter++
    slug = `${baseSlug}-${counter}`
    
    // Safety check to prevent infinite loops
    if (counter > 1000) {
      // Fallback to timestamp-based slug
      slug = `${baseSlug}-${Date.now()}`
      break
    }
  }
  
  return slug
}

export async function createRaffle(raffle: Omit<Raffle, 'id' | 'created_at' | 'updated_at'>) {
  // Build insert object conditionally to handle cases where NFT columns might not exist
  // Only include NFT fields if prize_type is 'nft' or if they have values
  const insertData: any = {
    slug: raffle.slug,
    title: raffle.title,
    description: raffle.description,
    image_url: raffle.image_url,
    prize_type: raffle.prize_type,
    prize_amount: raffle.prize_amount,
    prize_currency: raffle.prize_currency,
    ticket_price: raffle.ticket_price,
    currency: raffle.currency,
    max_tickets: raffle.max_tickets,
    min_tickets: raffle.min_tickets,
    start_time: raffle.start_time,
    end_time: raffle.end_time,
    original_end_time: raffle.original_end_time,
    theme_accent: raffle.theme_accent,
    edited_after_entries: raffle.edited_after_entries,
    created_by: raffle.created_by,
    is_active: raffle.is_active,
    winner_wallet: raffle.winner_wallet,
    winner_selected_at: raffle.winner_selected_at,
    status: raffle.status ?? null,
    nft_transfer_transaction: raffle.nft_transfer_transaction,
  }

  // Only include NFT fields if prize_type is 'nft' or if NFT fields are provided
  // This helps avoid errors if the migration hasn't been run yet
  if (raffle.prize_type === 'nft' || raffle.nft_mint_address || raffle.nft_token_id || 
      raffle.nft_collection_name || raffle.nft_metadata_uri) {
    insertData.nft_mint_address = raffle.nft_mint_address
    insertData.nft_token_id = raffle.nft_token_id
    insertData.nft_collection_name = raffle.nft_collection_name
    insertData.nft_metadata_uri = raffle.nft_metadata_uri
  }

  // Include optional metadata fields
  insertData.rank = raffle.rank
  insertData.floor_price = raffle.floor_price

  const { data, error } = await getSupabaseAdmin()
    .from('raffles')
    .insert(insertData)
    .select()
    .single()

  if (error) {
    console.error('Error creating raffle:', error)
    console.error('Raffle data attempted:', JSON.stringify(insertData, null, 2))
    
    // Handle duplicate slug error
    if (error.message?.includes('raffles_slug_key') || 
        error.message?.includes('duplicate key') ||
        error.message?.includes('unique constraint')) {
      throw new Error(
        `A raffle with the slug "${raffle.slug}" already exists. Please use a different title.`
      )
    }
    
    // Provide helpful error message if NFT columns are missing
    if (error.message?.includes('nft_collection_name') || 
        error.message?.includes('nft_mint_address') ||
        error.message?.includes('nft_token_id') ||
        error.message?.includes('nft_metadata_uri') ||
        error.message?.includes('schema cache')) {
      throw new Error(
        `Database migration missing: The NFT support migration (006_add_nft_support.sql) has not been applied to your database. ` +
        `Please run the migration to add NFT support columns to the raffles table.`
      )
    }
    
    // Return error details for debugging
    throw new Error(`Database error: ${error.message}`)
  }

  return data as unknown as Raffle
}

export async function updateRaffle(
  id: string,
  updates: Partial<Raffle> & { edited_after_entries?: boolean }
) {
  // Check if there are confirmed entries before updating
  const existingEntries = await getEntriesByRaffleId(id)
  const hasConfirmedEntries = existingEntries.some(e => e.status === 'confirmed')

  if (hasConfirmedEntries && !updates.edited_after_entries) {
    updates.edited_after_entries = true
  }

  const { data, error } = await getSupabaseAdmin()
    .from('raffles')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating raffle:', error)
    console.error('Update data:', JSON.stringify(updates, null, 2))
    console.error('Raffle ID:', id)
    throw new Error(`Database error updating raffle: ${error.message}`)
  }

  return data as unknown as Raffle
}

export async function deleteRaffle(id: string) {
  const { error, data } = await getSupabaseAdmin()
    .from('raffles')
    .delete()
    .eq('id', id)
    .select()

  if (error) {
    console.error('Error deleting raffle:', error)
    console.error('Error details:', JSON.stringify(error, null, 2))
    return false
  }

  // Check if any rows were actually deleted
  if (!data || data.length === 0) {
    console.warn('No raffle found with id:', id)
    return false
  }

  console.log('Successfully deleted raffle:', id)
  return true
}

/**
 * Select a winner for a raffle based on weighted random selection.
 * Each wallet's chance is proportional to their total ticket quantity.
 * Only considers confirmed entries.
 * Checks if raffle meets minimum requirements before drawing.
 * 
 * @param raffleId - The ID of the raffle
 * @param forceOverride - If true, bypass minimum check (for admin override)
 * @returns The winner's wallet address, or null if no valid entries or minimum not met
 */
export async function selectWinner(raffleId: string, forceOverride: boolean = false): Promise<string | null> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) {
    console.warn(`Raffle not found: ${raffleId}`)
    return null
  }

  // Get all confirmed entries for this raffle
  const entries = await getEntriesByRaffleId(raffleId)
  const confirmedEntries = entries.filter(e => e.status === 'confirmed')

  if (confirmedEntries.length === 0) {
    console.warn(`No confirmed entries found for raffle ${raffleId}`)
    return null
  }

  // Check if winner can be selected (min tickets met AND 7 days passed) unless override is forced
  if (!forceOverride && !canSelectWinner(raffle, entries)) {
    const meetsMinTickets = isRaffleEligibleToDraw(raffle, entries)
    const sevenDaysPassed = hasSevenDaysPassedSinceOriginalEnd(raffle)
    
    if (!meetsMinTickets) {
      console.warn(`Raffle ${raffleId} does not meet minimum ticket requirements`)
    }
    if (!sevenDaysPassed) {
      console.warn(`Raffle ${raffleId} has not passed 7 days since original end time`)
    }
    
    // Raffle ended, min not met — no status update; caller may extend and set status to 'live'
    return null
  }

  // Aggregate ticket quantities by wallet address
  const walletTickets = new Map<string, number>()
  for (const entry of confirmedEntries) {
    const current = walletTickets.get(entry.wallet_address) || 0
    walletTickets.set(entry.wallet_address, current + entry.ticket_quantity)
  }

  // Convert to arrays for weighted random selection
  const wallets = Array.from(walletTickets.keys())
  const weights = Array.from(walletTickets.values())

  // Calculate total tickets
  const totalTickets = weights.reduce((sum, weight) => sum + weight, 0)

  if (totalTickets === 0) {
    console.warn(`Total ticket count is 0 for raffle ${raffleId}`)
    return null
  }

  // Weighted random selection
  // Generate a random number between 0 and totalTickets
  let random = Math.random() * totalTickets

  // Find which wallet wins by iterating through weighted ranges
  for (let i = 0; i < wallets.length; i++) {
    random -= weights[i]
    if (random <= 0) {
      const winnerWallet = wallets[i]
      
      // Update the raffle with the winner
      const now = new Date().toISOString()
      const { error } = await getSupabaseAdmin()
        .from('raffles')
        .update({
          winner_wallet: winnerWallet,
          winner_selected_at: now,
          status: 'completed',
        })
        .eq('id', raffleId)

      if (error) {
        console.error('Error updating raffle with winner:', error)
        throw new Error(`Failed to update raffle with winner: ${error.message}`)
      }

      console.log(`Winner selected for raffle ${raffleId}: ${winnerWallet} (${weights[i]} tickets)`)
      return winnerWallet
    }
  }

  // Fallback to last wallet (should not happen due to random <= 0 check)
  const winnerWallet = wallets[wallets.length - 1]
  const now = new Date().toISOString()
  const { error } = await getSupabaseAdmin()
    .from('raffles')
    .update({
      winner_wallet: winnerWallet,
      winner_selected_at: now,
      status: 'completed',
    })
    .eq('id', raffleId)

  if (error) {
    console.error('Error updating raffle with winner:', error)
    throw new Error(`Failed to update raffle with winner: ${error.message}`)
  }

  return winnerWallet
}

/**
 * Get all raffles that have ended but don't have a winner selected yet
 * Includes raffles where:
 * - end_time has passed, OR
 * - original_end_time exists and 7 days have passed since it (for extended raffles that meet minimum)
 */
export async function getEndedRafflesWithoutWinner(): Promise<Raffle[]> {
  const now = new Date()
  const columns = await getRaffleColumns()
  
  // Fetch raffles without winners (status live or ready_to_draw), then filter in JavaScript
  // This ensures we catch all cases including extended raffles where 7 days have passed
  // since original_end_time even if end_time is still in the future
  const { data, error } = await getSupabaseForRead()
    .from('raffles')
    .select(columns)
    .is('winner_wallet', null)
    .is('winner_selected_at', null)
    .in('status', ['live', 'ready_to_draw'])

  if (error) {
    console.error('Error fetching ended raffles without winner:', error)
    
    // Check if error is related to missing NFT columns
    const errorMsg = error.message?.toLowerCase() || ''
    if (errorMsg.includes('column') && 
        (errorMsg.includes('prize_type') || 
         errorMsg.includes('nft') || 
         errorMsg.includes('does not exist'))) {
      console.error(
        'Database migration missing: The NFT support migration (006_add_nft_support.sql) has not been applied. ' +
        'Please run the migration in your Supabase SQL Editor.'
      )
    }
    
    return []
  }

  // Ensure all raffles have prize_type defaulted to 'crypto' if migration not applied
  const hasNftSupport = await checkNftMigrationApplied()
  let raffles = (data || []) as unknown as Raffle[]
  
  if (!hasNftSupport && data) {
    raffles = data.map((raffle: any) => ({
      ...raffle,
      prize_type: 'crypto' as const,
      nft_mint_address: null,
      nft_collection_name: null,
      nft_token_id: null,
      nft_metadata_uri: null,
    })) as Raffle[]
  }

  // Filter to only include raffles where end_time has passed.
  // Use end_time only: after restore, end_time is the extended time; don't treat as ended until it passes.
  const filteredRaffles = raffles.filter(raffle => {
    const endTime = new Date(raffle.end_time)
    return endTime <= now
  })

  return filteredRaffles
}

/**
 * Calculate total tickets sold for a raffle from confirmed entries
 */
export function calculateTicketsSold(entries: Entry[]): number {
  return entries
    .filter(e => e.status === 'confirmed')
    .reduce((sum, entry) => sum + entry.ticket_quantity, 0)
}

/**
 * Calculate unique participants (wallets) for a raffle from confirmed entries
 */
export function calculateUniqueParticipants(entries: Entry[]): number {
  const uniqueWallets = new Set(
    entries
      .filter(e => e.status === 'confirmed')
      .map(e => e.wallet_address)
  )
  return uniqueWallets.size
}

/**
 * Check if a raffle is eligible to be drawn (meets minimum requirements)
 * Returns true if no minimum is set OR if minimum is met
 */
export function isRaffleEligibleToDraw(raffle: Raffle, entries: Entry[]): boolean {
  // If no minimum is set, raffle is always eligible
  if (!raffle.min_tickets) {
    return true
  }

  // Check if minimum tickets requirement is met
  const ticketsSold = calculateTicketsSold(entries)
  return ticketsSold >= raffle.min_tickets
}

/**
 * Check if 7 days have passed since the original end time
 * If original_end_time is null, use end_time as the reference point
 */
export function hasSevenDaysPassedSinceOriginalEnd(raffle: Raffle): boolean {
  const now = new Date()
  // Use original_end_time if set, otherwise use end_time (for raffles that haven't been extended)
  const referenceTime = raffle.original_end_time ? new Date(raffle.original_end_time) : new Date(raffle.end_time)
  const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000
  const timeSinceReference = now.getTime() - referenceTime.getTime()
  return timeSinceReference >= sevenDaysInMs
}

/**
 * Check if a raffle can have a winner selected
 * - If no min_tickets: winner can be selected immediately when raffle ends
 * - If min_tickets set:
 *   - If raffle hasn't been extended (no original_end_time): can select immediately when min tickets met and raffle ended
 *   - If raffle was extended (has original_end_time): requires both min tickets met AND 7 days passed since original end time
 */
export function canSelectWinner(raffle: Raffle, entries: Entry[]): boolean {
  // If no minimum is set, raffle can be drawn immediately when it ends
  if (!raffle.min_tickets) {
    return true
  }

  // Check minimum tickets requirement
  const meetsMinTickets = isRaffleEligibleToDraw(raffle, entries)
  
  // If raffle was extended (has original_end_time), require 7 days to pass
  // This gives people time to buy more tickets after the extension
  if (raffle.original_end_time) {
    const sevenDaysPassed = hasSevenDaysPassedSinceOriginalEnd(raffle)
    return meetsMinTickets && sevenDaysPassed
  }
  
  // If raffle hasn't been extended and min tickets are met, can select immediately when raffle ends
  return meetsMinTickets
}

/**
 * Get the minimum threshold for a raffle (prefers min_tickets over min_participants if both exist)
 * This is for display purposes
 */
export function getRaffleMinimum(raffle: Raffle): number | null {
  // Default to min_tickets if both exist (as per requirements)
  return raffle.min_tickets ?? null
}
import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import type { Raffle, Entry } from '@/lib/types'
import { withRetry, withQueryRetry } from '@/lib/db-retry'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { calculateSettlement } from '@/lib/raffles/calculate-settlement'
import { getRaffleRevenue } from '@/lib/raffle-profit'

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

/** Base columns including prize return, cancellation, and purchases_blocked (migrations 036, 038, 040). */
function getBaseRaffleColumns(): string {
  return 'id,slug,title,description,image_url,prize_amount,prize_currency,ticket_price,currency,max_tickets,min_tickets,start_time,end_time,original_end_time,theme_accent,edited_after_entries,created_at,updated_at,created_by,is_active,winner_wallet,winner_selected_at,status,nft_transfer_transaction,nft_claim_locked_at,nft_claim_locked_wallet,creator_wallet,fee_bps_applied,fee_tier_reason,platform_fee_amount,creator_payout_amount,settled_at,rank,floor_price,prize_deposited_at,prize_returned_at,prize_return_reason,prize_return_tx,cancellation_requested_at,cancelled_at,cancellation_fee_amount,cancellation_fee_currency,cancellation_refund_policy,purchases_blocked_at'
}

/** Minimal columns when prize return / cancellation migrations (036, 038) are not yet applied. */
function getMinimalBaseRaffleColumns(): string {
  return 'id,slug,title,description,image_url,prize_amount,prize_currency,ticket_price,currency,max_tickets,min_tickets,start_time,end_time,original_end_time,theme_accent,edited_after_entries,created_at,updated_at,created_by,is_active,winner_wallet,winner_selected_at,status,nft_transfer_transaction,nft_claim_locked_at,nft_claim_locked_wallet,creator_wallet,fee_bps_applied,fee_tier_reason,platform_fee_amount,creator_payout_amount,settled_at,rank,floor_price,prize_deposited_at'
}

// Cache column list so we only run migration check once per process (faster subsequent loads)
let raffleColumnsCache: string | null = null

const FULL_RAFFLE_COLUMNS =
  getBaseRaffleColumns() +
  ',prize_type,nft_mint_address,nft_collection_name,nft_token_id,nft_metadata_uri,prize_standard'

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

/** Postgrest errors often print as `{}` with console — log message/code/details explicitly. */
function formatPostgrestError(err: { message?: string; code?: string; details?: string } | null | undefined): string {
  if (!err) return 'null'
  const msg = err.message ?? ''
  const code = err.code ?? ''
  const details = err.details ?? ''
  return `message=${msg} code=${code} details=${details}`
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
    lower.includes('fetch failed') ||
    lower.includes('aborted') ||
    lower.includes('522')
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

/** Status values for public raffle listing (excludes draft and cancelled) */
const PUBLIC_STATUSES = ['live', 'ready_to_draw', 'completed'] as const

/** Status values when admin needs to see drafts and cancelled */
const ALL_STATUSES = ['draft', 'live', 'ready_to_draw', 'completed', 'cancelled'] as const

/**
 * Public list uses direct REST for cold-start resilience. Must be high enough that older **live**
 * raffles are not dropped (admin `getRaffles` has no limit — a low cap here made long-running
 * raffles disappear from /raffles while still visible in Owl Vision).
 * PostgREST default max is often 1000; override via RAFFLES_REST_LIST_LIMIT if needed.
 */
function getRafflesRestListLimit(): number {
  const raw = process.env.RAFFLES_REST_LIST_LIMIT?.trim()
  if (raw) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 24 && n <= 10_000) return n
  }
  return 1000
}

/** REST select: full columns including NFT (matches Raffle type) */
const RAFFLE_SELECT_FULL =
  getBaseRaffleColumns() +
  ',prize_type,nft_mint_address,nft_collection_name,nft_token_id,nft_metadata_uri,prize_standard'
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
 * When includeDraft is true, draft raffles are included so "Future Raffles" can show scheduled drafts to everyone.
 */
async function fetchRafflesViaRestRaw(
  baseUrl: string,
  apiKey: string,
  activeOnly: boolean,
  select: string,
  perAttemptMs: number,
  includeDraft: boolean = false
): Promise<Raffle[]> {
  const url = new URL(`${baseUrl}/rest/v1/raffles`)
  const statusFilter = includeDraft
    ? 'in.(draft,live,ready_to_draw,completed,cancelled)'
    : 'in.(live,ready_to_draw,completed)'
  url.searchParams.set('status', statusFilter)
  if (activeOnly) url.searchParams.set('is_active', 'is.true')
  url.searchParams.set('order', 'created_at.desc,id.desc')
  url.searchParams.set('limit', String(getRafflesRestListLimit()))
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
  /** Include draft status so future (scheduled) raffles show for everyone */
  includeDraft?: boolean
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

  const includeDraft = options?.includeDraft ?? false
  const run = async (): Promise<Raffle[]> => {
    try {
      return await withRetry(
        async () => fetchRafflesViaRestRaw(baseUrl, apiKey, activeOnly, RAFFLE_SELECT_FULL, perAttemptMs, includeDraft),
        { maxRetries, initialDelayMs: 600 }
      )
    } catch (fullErr) {
      const msg = (fullErr as Error)?.message ?? ''
      if (!isColumnOrSchemaError(msg)) throw fullErr
      return await withRetry(
        async () => fetchRafflesViaRestRaw(baseUrl, apiKey, activeOnly, RAFFLE_SELECT_BASE, perAttemptMs, includeDraft),
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
    const client = getSupabaseForRead()
    const columns = await getRaffleColumns()
    const { data, error } = await client
      .from('raffles')
      .select(columns)
      .eq('slug', slug)
      .single()

    if (error) {
      if (isColumnError(error.message, error.code)) {
        raffleColumnsCache = getMinimalBaseRaffleColumns()
        const hasNftSupport = await checkNftMigrationApplied()
        const minimalColumns = hasNftSupport
          ? getMinimalBaseRaffleColumns() + ',prize_type,nft_mint_address,nft_collection_name,nft_token_id,nft_metadata_uri'
          : getMinimalBaseRaffleColumns()
        const retry = await client
          .from('raffles')
          .select(minimalColumns)
          .eq('slug', slug)
          .single()
        if (retry.error || !retry.data) {
          console.warn(
            `Error fetching raffle by slug (retry with minimal columns): ${formatPostgrestError(retry.error)}`,
          )
          return null
        }
        return normalizeRaffleRow(retry.data as unknown as Record<string, unknown>)
      }
      console.warn(`Error fetching raffle: ${formatPostgrestError(error)}`)
      return null
    }

    const hasNftSupport = await checkNftMigrationApplied()
    let row = data as unknown as Record<string, unknown>
    if (!hasNftSupport && row) {
      row = {
        ...row,
        prize_type: 'crypto',
        nft_mint_address: null,
        nft_collection_name: null,
        nft_token_id: null,
        nft_metadata_uri: null,
      }
    }
    return normalizeRaffleRow(row)
  }, { maxRetries: 2 })
}

export async function getRaffleById(id: string) {
  return withRetry(async () => {
    const client = getSupabaseForRead()
    const columns = await getRaffleColumns()
    const { data, error } = await client
      .from('raffles')
      .select(columns)
      .eq('id', id)
      .single()

    if (error) {
      if (isColumnError(error.message, error.code)) {
        raffleColumnsCache = getMinimalBaseRaffleColumns()
        const hasNftSupport = await checkNftMigrationApplied()
        const minimalColumns = hasNftSupport
          ? getMinimalBaseRaffleColumns() + ',prize_type,nft_mint_address,nft_collection_name,nft_token_id,nft_metadata_uri'
          : getMinimalBaseRaffleColumns()
        const retry = await client
          .from('raffles')
          .select(minimalColumns)
          .eq('id', id)
          .single()
        if (retry.error || !retry.data) {
          console.warn(
            `Error fetching raffle by id (retry with minimal columns): ${formatPostgrestError(retry.error)}`,
          )
          return null
        }
        return normalizeRaffleRow(retry.data as unknown as Record<string, unknown>)
      }
      console.warn(`Error fetching raffle: ${formatPostgrestError(error)}`)
      return null
    }

    const hasNftSupport = await checkNftMigrationApplied()
    let row = data as unknown as Record<string, unknown>
    if (!hasNftSupport && row) {
      row = {
        ...row,
        prize_type: 'crypto',
        nft_mint_address: null,
        nft_collection_name: null,
        nft_token_id: null,
        nft_metadata_uri: null,
      }
    }
    return normalizeRaffleRow(row)
  }, { maxRetries: 2 })
}

/**
 * Fetch raffles created by a given wallet (for "My raffles" list).
 * Returns only raffles where this wallet is the creator (created_by or creator_wallet).
 */
/** Ensure raffle row has prize return / cancellation fields (for minimal column select). */
function normalizeRaffleRow(row: Record<string, unknown>): Raffle {
  return {
    ...row,
    prize_returned_at: (row.prize_returned_at as string | null) ?? null,
    prize_return_reason: (row.prize_return_reason as string | null) ?? null,
    prize_return_tx: (row.prize_return_tx as string | null) ?? null,
    cancellation_requested_at: (row.cancellation_requested_at as string | null) ?? null,
    cancelled_at: (row.cancelled_at as string | null) ?? null,
    cancellation_fee_amount: (row.cancellation_fee_amount as number | null) ?? null,
    cancellation_fee_currency: (row.cancellation_fee_currency as string | null) ?? null,
    cancellation_refund_policy: (row.cancellation_refund_policy as string | null) ?? null,
    prize_type: (row.prize_type as 'crypto' | 'nft') ?? 'crypto',
    prize_standard: (row.prize_standard as any) ?? null,
    nft_mint_address: (row.nft_mint_address as string | null) ?? null,
    nft_collection_name: (row.nft_collection_name as string | null) ?? null,
    nft_token_id: (row.nft_token_id as string | null) ?? null,
    nft_metadata_uri: (row.nft_metadata_uri as string | null) ?? null,
    purchases_blocked_at: (row.purchases_blocked_at as string | null) ?? null,
  } as Raffle
}

export async function getRafflesByCreator(walletAddress: string): Promise<Raffle[]> {
  const normalized = typeof walletAddress === 'string' ? walletAddress.trim() : ''
  if (!normalized) return []

  return withRetry(async () => {
    const columns = await getRaffleColumns()
    const client = getSupabaseForRead()
    const { data, error } = await client
      .from('raffles')
      .select(columns)
      .or(`created_by.eq.${normalized},creator_wallet.eq.${normalized}`)
      .order('created_at', { ascending: false })

    if (error) {
      if (isColumnError(error.message, error.code)) {
        raffleColumnsCache = getMinimalBaseRaffleColumns()
        const hasNftSupport = await checkNftMigrationApplied()
        const minimalColumns = hasNftSupport
          ? getMinimalBaseRaffleColumns() + ',prize_type,nft_mint_address,nft_collection_name,nft_token_id,nft_metadata_uri'
          : getMinimalBaseRaffleColumns()
        const retry = await client
          .from('raffles')
          .select(minimalColumns)
          .or(`created_by.eq.${normalized},creator_wallet.eq.${normalized}`)
          .order('created_at', { ascending: false })
        if (retry.error) {
          console.warn(
            `Error fetching raffles by creator (retry with minimal columns): ${formatPostgrestError(retry.error)}`,
          )
          return []
        }
        const rows = (retry.data || []) as unknown as Record<string, unknown>[]
        return rows.map(normalizeRaffleRow)
      }
      console.warn(`Error fetching raffles by creator: ${formatPostgrestError(error)}`)
      return []
    }

    const hasNftSupport = await checkNftMigrationApplied()
    let rows = (data || []) as unknown as Record<string, unknown>[]
    if (!hasNftSupport && rows.length) {
      rows = rows.map((r) => ({
        ...r,
        prize_type: 'crypto',
        nft_mint_address: null,
        nft_collection_name: null,
        nft_token_id: null,
        nft_metadata_uri: null,
      }))
    }
    return rows.map(normalizeRaffleRow)
  }, { maxRetries: 2 })
}

/**
 * Sum of creator_payout_amount for completed raffles where this wallet is the creator.
 * Used for user dashboard revenue.
 */
export async function getCreatorRevenueByWallet(walletAddress: string): Promise<{
  totalCreatorRevenue: number
  byCurrency: Record<string, number>
}> {
  const normalized = typeof walletAddress === 'string' ? walletAddress.trim() : ''
  if (!normalized) return { totalCreatorRevenue: 0, byCurrency: {} }

  const { data, error } = await getSupabaseForRead()
    .from('raffles')
    .select('creator_payout_amount, currency')
    .eq('status', 'completed')
    .not('creator_payout_amount', 'is', null)
    .or(`created_by.eq.${normalized},creator_wallet.eq.${normalized}`)

  if (error) {
    console.error('Error fetching creator revenue:', error)
    return { totalCreatorRevenue: 0, byCurrency: {} }
  }

  const byCurrency: Record<string, number> = {}
  let total = 0
  for (const row of data || []) {
    const amount = Number(row.creator_payout_amount ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const cur = (row.currency as string) || 'SOL'
    byCurrency[cur] = (byCurrency[cur] ?? 0) + amount
    total += amount
  }
  return { totalCreatorRevenue: total, byCurrency }
}

/**
 * Creator's share of ticket sales (after platform fee) from live / ready-to-draw raffles.
 * Matches on-chain split math at purchase time (same as calculateSettlement per entry).
 */
export async function getCreatorLiveEarningsByWallet(walletAddress: string): Promise<{
  totalCreatorRevenue: number
  byCurrency: Record<string, number>
}> {
  const normalized = typeof walletAddress === 'string' ? walletAddress.trim() : ''
  if (!normalized) return { totalCreatorRevenue: 0, byCurrency: {} }

  const { data: raffles, error: rafflesError } = await getSupabaseForRead()
    .from('raffles')
    .select('id, status')
    .or(`created_by.eq.${normalized},creator_wallet.eq.${normalized}`)
    .in('status', ['live', 'ready_to_draw'])

  if (rafflesError) {
    console.error('Error fetching live raffles for creator earnings:', rafflesError)
    return { totalCreatorRevenue: 0, byCurrency: {} }
  }

  if (!raffles || raffles.length === 0) {
    return { totalCreatorRevenue: 0, byCurrency: {} }
  }

  const raffleIds = raffles.map((r) => r.id as string)

  const { data: entries, error: entriesError } = await getSupabaseForRead()
    .from('entries')
    .select('amount_paid, currency, raffle_id, status')
    .in('raffle_id', raffleIds)
    .eq('status', 'confirmed')

  if (entriesError) {
    console.error('Error fetching live creator earnings entries:', entriesError)
    return { totalCreatorRevenue: 0, byCurrency: {} }
  }

  const { feeBps } = await getCreatorFeeTier(normalized, { skipCache: true })

  const byCurrency: Record<string, number> = {}
  let total = 0
  for (const row of entries || []) {
    const amount = Number((row as { amount_paid?: unknown }).amount_paid ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const cur = String((row as { currency?: string }).currency || 'SOL').toUpperCase()
    const { creatorPayout } = calculateSettlement(amount, feeBps)
    byCurrency[cur] = (byCurrency[cur] ?? 0) + creatorPayout
    total += creatorPayout
  }

  return { totalCreatorRevenue: total, byCurrency }
}

/**
 * Total confirmed ticket sales (gross) for this creator's raffles in the given statuses.
 * Used for dashboard "all-time gross" (before platform fee).
 */
export async function getCreatorTicketSalesGrossByWallet(
  walletAddress: string,
  statuses: readonly string[] = ['live', 'ready_to_draw', 'completed']
): Promise<{ totalGross: number; byCurrency: Record<string, number> }> {
  const normalized = typeof walletAddress === 'string' ? walletAddress.trim() : ''
  if (!normalized) return { totalGross: 0, byCurrency: {} }

  const { data: raffles, error: rafflesError } = await getSupabaseForRead()
    .from('raffles')
    .select('id')
    .or(`created_by.eq.${normalized},creator_wallet.eq.${normalized}`)
    .in('status', [...statuses])

  if (rafflesError) {
    console.error('Error fetching raffles for creator gross sales:', rafflesError)
    return { totalGross: 0, byCurrency: {} }
  }

  if (!raffles || raffles.length === 0) {
    return { totalGross: 0, byCurrency: {} }
  }

  const raffleIds = raffles.map((r) => r.id as string)

  const { data: entries, error: entriesError } = await getSupabaseForRead()
    .from('entries')
    .select('amount_paid, currency')
    .in('raffle_id', raffleIds)
    .eq('status', 'confirmed')

  if (entriesError) {
    console.error('Error fetching entries for creator gross sales:', entriesError)
    return { totalGross: 0, byCurrency: {} }
  }

  const byCurrency: Record<string, number> = {}
  let totalGross = 0
  for (const row of entries || []) {
    const amount = Number((row as { amount_paid?: unknown }).amount_paid ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const cur = String((row as { currency?: string }).currency || 'SOL').toUpperCase()
    byCurrency[cur] = (byCurrency[cur] ?? 0) + amount
    totalGross += amount
  }

  return { totalGross, byCurrency }
}

export async function getEntriesByRaffleId(raffleId: string) {
  // Fetch all entries using pagination to handle any Supabase row limits
  // Supabase defaults to 1000 rows per query, but projects can have custom limits
  const allEntries: Entry[] = []
  const pageSize = 1000
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const result = await withQueryRetry(
      getSupabaseForRead()
        .from('entries')
        .select('*')
        .eq('raffle_id', raffleId)
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1),
      { maxRetries: 2 }
    )
    const { data, error } = result

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

/** Start of today in UTC (00:00:00.000Z). */
function getTodayStartUTC(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/** Start of tomorrow in UTC (00:00:00.000Z). */
function getTomorrowStartUTC(): Date {
  const d = getTodayStartUTC()
  d.setUTCDate(d.getUTCDate() + 1)
  return d
}

/**
 * Returns how many raffles the given creator wallet has created today (UTC calendar day).
 * Used to enforce daily hosting limits: holders 3/day, non-holders 1/day.
 */
export async function getRaffleCreationCountForCreatorToday(creatorWallet: string): Promise<number> {
  const normalized = creatorWallet?.trim()
  if (!normalized) return 0
  const todayStart = getTodayStartUTC().toISOString()
  const todayEnd = getTomorrowStartUTC().toISOString()
  const { count, error } = await getSupabaseAdmin()
    .from('raffles')
    .select('id', { count: 'exact', head: true })
    .eq('creator_wallet', normalized)
    .gte('created_at', todayStart)
    .lt('created_at', todayEnd)
  if (error) {
    console.error('getRaffleCreationCountForCreatorToday error:', error)
    return 0
  }
  return typeof count === 'number' ? count : 0
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
    creator_wallet: raffle.creator_wallet,
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

  // Include optional metadata and settlement fields
  insertData.rank = raffle.rank
  insertData.floor_price = raffle.floor_price
  insertData.fee_bps_applied = raffle.fee_bps_applied
  insertData.fee_tier_reason = raffle.fee_tier_reason
  insertData.platform_fee_amount = raffle.platform_fee_amount
  insertData.creator_payout_amount = raffle.creator_payout_amount
  insertData.settled_at = raffle.settled_at
  insertData.prize_deposited_at = raffle.prize_deposited_at ?? null
  insertData.cancellation_requested_at = raffle.cancellation_requested_at ?? null
  insertData.cancelled_at = raffle.cancelled_at ?? null
  insertData.cancellation_fee_amount = raffle.cancellation_fee_amount ?? null
  insertData.cancellation_fee_currency = raffle.cancellation_fee_currency ?? null
  insertData.cancellation_refund_policy = raffle.cancellation_refund_policy ?? null

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

/**
 * Promote draft raffles to live when their start_time has passed and end_time has not.
 * Call this when loading the raffles list with includeDraft so future raffles become active automatically.
 */
export async function promoteDraftRafflesToLive(): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await getSupabaseAdmin()
    .from('raffles')
    .update({ status: 'live', updated_at: now })
    .eq('status', 'draft')
    // NFT raffles start as `draft` and `is_active=false` until the prize is verified in escrow.
    // Only promote drafts to `live` when they are active; otherwise we can end up with a misleading
    // "ended" state and (worse) cron winner selection for a raffle that hasn't deposited escrow yet.
    .eq('is_active', true)
    .lte('start_time', now)
    .gt('end_time', now)

  if (error) {
    console.error('Error promoting draft raffles to live:', error)
    // Don't throw — page can still render; next load or manual fix will correct
  }
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

/**
 * Atomically acquire a short-lived winner-claim lock so only one request
 * attempts the escrow NFT transfer at a time.
 *
 * Lock rules:
 * - Only when `nft_transfer_transaction` is still null (not yet claimed).
 * - Only when the prize was not returned to the creator.
 * - If a lock is already set, only the current winner can reuse it.
 */
export async function acquireNftPrizeClaimLock(
  raffleId: string,
  walletAddress: string
): Promise<{ acquired: boolean }> {
  const wallet = walletAddress.trim()
  const lockAt = new Date().toISOString()

  // Service role client: bypasses RLS, so this is safe for server-side enforcement.
  const { data, error } = await getSupabaseAdmin()
    .from('raffles')
    .update({
      nft_claim_locked_at: lockAt,
      nft_claim_locked_wallet: wallet,
    })
    .eq('id', raffleId)
    .is('nft_transfer_transaction', null)
    .is('prize_returned_at', null)
    // True mutex: only the first in-flight request can acquire the lock.
    .is('nft_claim_locked_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('acquireNftPrizeClaimLock error:', error)
    throw new Error(`Failed to acquire NFT claim lock: ${error.message}`)
  }

  return { acquired: !!data }
}

/** Clears in-flight winner claim lock (e.g. admin retry or stuck state). */
export async function clearNftPrizeClaimLock(raffleId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('raffles')
    .update({ nft_claim_locked_at: null, nft_claim_locked_wallet: null })
    .eq('id', raffleId)
  if (error) {
    console.error('clearNftPrizeClaimLock error:', error)
    throw new Error(`Failed to clear NFT claim lock: ${error.message}`)
  }
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
      
      // Compute settlement amounts (fee + creator payout) at settlement time
      const revenue = getRaffleRevenue(entries)
      const revenueCurrency = (raffle.currency || 'SOL').toUpperCase()
      const grossRevenue =
        revenueCurrency === 'USDC'
          ? revenue.usdc
          : revenueCurrency === 'SOL'
          ? revenue.sol
          : revenue.owl

      const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
      const { feeBps, reason } = await getCreatorFeeTier(creatorWallet, { skipCache: true })
      const { platformFee, creatorPayout } = calculateSettlement(grossRevenue, feeBps)

      // Update the raffle with the winner and settlement info
      const now = new Date().toISOString()
      const { error } = await getSupabaseAdmin()
        .from('raffles')
        .update({
          winner_wallet: winnerWallet,
          winner_selected_at: now,
          status: 'completed',
          creator_wallet: creatorWallet || null,
          fee_bps_applied: feeBps,
          fee_tier_reason: reason,
          platform_fee_amount: platformFee,
          creator_payout_amount: creatorPayout,
          settled_at: now,
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
  // Compute settlement amounts for fallback path
  const revenue = getRaffleRevenue(entries)
  const revenueCurrency = (raffle.currency || 'SOL').toUpperCase()
  const grossRevenue =
    revenueCurrency === 'USDC'
      ? revenue.usdc
      : revenueCurrency === 'SOL'
      ? revenue.sol
      : revenue.owl

  const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
  const { feeBps, reason } = await getCreatorFeeTier(creatorWallet, { skipCache: true })
  const { platformFee, creatorPayout } = calculateSettlement(grossRevenue, feeBps)

  const now = new Date().toISOString()
  const { error } = await getSupabaseAdmin()
    .from('raffles')
    .update({
      winner_wallet: winnerWallet,
      winner_selected_at: now,
      status: 'completed',
      creator_wallet: creatorWallet || null,
      fee_bps_applied: feeBps,
      fee_tier_reason: reason,
      platform_fee_amount: platformFee,
      creator_payout_amount: creatorPayout,
      settled_at: now,
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
    if (endTime > now) return false
    // NFT raffles must not progress to winner selection until the prize is deposited to escrow.
    if (raffle.prize_type === 'nft' && !raffle.prize_deposited_at) return false
    return true
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
 * Check if a raffle can have a winner selected.
 *
 * Behaviour:
 * - When a minimum ticket threshold is set (min_tickets > 0), the raffle becomes
 *   eligible to draw as soon as confirmed tickets >= min_tickets.
 * - When no minimum is set, the raffle is eligible to draw as long as there is
 *   at least one confirmed ticket.
 *
 * NOTE: Callers are responsible for ensuring the raffle has actually ended
 * (end_time has passed) before calling this helper.
 */
export function canSelectWinner(raffle: Raffle, entries: Entry[]): boolean {
  const confirmedTickets = calculateTicketsSold(entries)

  // If a minimum is configured, require that threshold to be met
  if (raffle.min_tickets && raffle.min_tickets > 0) {
    return confirmedTickets >= raffle.min_tickets
  }

  // No minimum configured: need at least one confirmed ticket
  return confirmedTickets > 0
}

/**
 * Get the minimum threshold for a raffle (prefers min_tickets over min_participants if both exist)
 * This is for display purposes
 */
export function getRaffleMinimum(raffle: Raffle): number | null {
  // Default to min_tickets if both exist (as per requirements)
  return raffle.min_tickets ?? null
}
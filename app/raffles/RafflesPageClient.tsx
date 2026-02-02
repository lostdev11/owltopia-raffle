'use client'

/**
 * Client for /raffles: list + debug panel + resilient states.
 * - ?debug=1: diagnostics (wallet truncated, hostname, fetch status, error message/code, count). No secrets.
 * - Error/empty: visible card or "No active raffles yet" + refresh. No blank screen.
 * - When server returns empty, fallback: fetch from GET /api/raffles and bucket client-side so cards show.
 * - When API also fails: try direct Supabase from browser (different connection path, often works when server times out).
 * - Logging: console.log("raffles fetch", ...) only when ?debug=1.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { RafflesList } from '@/components/RafflesList'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Raffle, Entry } from '@/lib/types'

type FetchStatus = 'loading' | 'success' | 'empty' | 'error'

interface RafflesPageClientProps {
  activeRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  futureRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  pastRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  /** Server-side fetch result: success (has data), empty (0 raffles), or error */
  fetchStatus?: FetchStatus
  /** When fetch failed (e.g. RLS/403). No secrets; message + code only */
  initialError?: { message: string; code?: string }
  /** Total raffles returned by server (for debug panel) */
  rafflesTotalCount?: number
}

function bucketRaffles(raffles: Raffle[]): { active: RaffleWithEntries[]; future: RaffleWithEntries[]; past: RaffleWithEntries[] } {
  const withEntries = (r: Raffle): RaffleWithEntries => ({ raffle: r, entries: [] })
  const now = new Date()
  const nowTime = now.getTime()
  const active: RaffleWithEntries[] = []
  const future: RaffleWithEntries[] = []
  const past: RaffleWithEntries[] = []
  for (const raffle of raffles) {
    const startTime = new Date(raffle.start_time)
    const endTime = new Date(raffle.end_time)
    const startTimeMs = startTime.getTime()
    const endTimeMs = endTime.getTime()
    if (isNaN(startTimeMs) || isNaN(endTimeMs)) {
      past.push(withEntries(raffle))
      continue
    }
    if (raffle.winner_selected_at || raffle.status === 'completed') {
      past.push(withEntries(raffle))
      continue
    }
    if (raffle.status === 'ready_to_draw') {
      past.push(withEntries(raffle))
      continue
    }
    if (raffle.status === 'live' && startTimeMs > nowTime) {
      future.push(withEntries(raffle))
      continue
    }
    if (raffle.status === 'live' && startTimeMs <= nowTime && endTimeMs > nowTime) {
      active.push(withEntries(raffle))
      continue
    }
    past.push(withEntries(raffle))
  }
  return { active, future, past }
}

type RaffleWithEntries = { raffle: Raffle; entries: Entry[] }

/** Detect DB/connection or timeout errors for user-friendly messaging */
function isConnectivityError(message: string | null | undefined): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return (
    m.includes('connection') ||
    m.includes('upstream') ||
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('database operation failed after') ||
    m.includes('failed to fetch') ||
    m.includes('network') ||
    m.includes('econnrefused') ||
    m.includes('econnreset') ||
    m.includes('etimedout') ||
    m.includes('server error') ||
    m.includes('503') ||
    m.includes('502') ||
    m.includes('service unavailable') ||
    m.includes('bad gateway')
  )
}

/** True when error is 503 / Service Unavailable (Supabase project paused) */
function isSupabasePausedError(message: string | null | undefined): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return m.includes('503') || m.includes('service unavailable')
}

export function RafflesPageClient({
  activeRafflesWithEntries,
  futureRafflesWithEntries,
  pastRafflesWithEntries,
  fetchStatus = 'success',
  initialError,
  rafflesTotalCount = 0,
}: RafflesPageClientProps) {
  // Defensive: coerce null/undefined to [] so we never read .length on null (e.g. after serialization)
  const serverActive = activeRafflesWithEntries ?? []
  const serverFuture = futureRafflesWithEntries ?? []
  const serverPast = pastRafflesWithEntries ?? []

  const [clientBuckets, setClientBuckets] = useState<{
    active: RaffleWithEntries[]
    future: RaffleWithEntries[]
    past: RaffleWithEntries[]
  } | null>(null)
  const [clientFetchError, setClientFetchError] = useState<string | null>(null)
  const [clientFetchStarted, setClientFetchStarted] = useState(false)

  const searchParams = useSearchParams()
  const router = useRouter()
  const debug = searchParams.get('debug') === '1'

  const isEmptyFromServer = serverActive.length === 0 && serverFuture.length === 0 && serverPast.length === 0

  // Fallback: when server returned no raffles OR an error, fetch from API + direct Supabase in parallel
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Skip only when we already have server data (no need to fallback)
    if (!isEmptyFromServer && !initialError) return
    let cancelled = false
    setClientFetchError(null)
    setClientFetchStarted(true)

    const tryDirectSupabase = async () => {
      if (!isSupabaseConfigured() || cancelled) return
      try {
        // Direct browser→Supabase fetch; often works when server→Supabase times out
        const { data, error } = await supabase
          .from('raffles')
          .select('*')
          .in('status', ['live', 'ready_to_draw', 'completed'])
          .order('created_at', { ascending: false })
        if (cancelled) return
        if (error) throw new Error(error.message)
        const list = (data || []) as Partial<Raffle>[]
        if (list.length > 0) {
          const normalized = list.map((r: Partial<Raffle>) => ({
            ...r,
            prize_type: (r.prize_type ?? 'crypto') as 'crypto' | 'nft',
            nft_mint_address: r.nft_mint_address ?? null,
            nft_collection_name: r.nft_collection_name ?? null,
            nft_token_id: r.nft_token_id ?? null,
            nft_metadata_uri: r.nft_metadata_uri ?? null,
          })) as Raffle[]
          setClientBuckets(bucketRaffles(normalized))
          setClientFetchError(null)
        }
      } catch {
        // Ignore - will show API error or empty state
      }
    }

    // When server already failed, try direct Supabase first (browser path often works)
    if (initialError) tryDirectSupabase()

    fetch('/api/raffles')
      .then(async (res) => {
        if (cancelled) return null
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const bodyMessage = typeof data?.error === 'string' ? data.error : null
          const is503 = res.status === 503 || /503|service temporarily unavailable/i.test(bodyMessage ?? '')
          setClientFetchError(
            bodyMessage ||
              (is503
                ? 'Service temporarily unavailable. Please try again in a moment.'
                : res.status === 500
                  ? 'Server error'
                  : `HTTP ${res.status}`)
          )
          // Skip direct Supabase when API returns 503 (Supabase is down; direct call would fail too)
          if (!is503) tryDirectSupabase()
          return null
        }
        return data
      })
      .then((data) => {
        if (cancelled || data == null) return
        if (data?.error) {
          setClientFetchError(data.error)
          const is503 = /503|service temporarily unavailable/i.test(data.error)
          if (!is503) tryDirectSupabase()
          return
        }
        // Handle both raw array and wrapped { data: [...] } responses
        const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : [])
        if (list.length > 0) {
          setClientBuckets(bucketRaffles(list as Raffle[]))
        } else {
          tryDirectSupabase()
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setClientFetchError(err?.message || 'Failed to load raffles')
          tryDirectSupabase()
        }
      })
    return () => {
      cancelled = true
    }
  }, [initialError, isEmptyFromServer])

  const active = serverActive.length > 0 ? serverActive : (clientBuckets?.active ?? [])
  const future = serverFuture.length > 0 ? serverFuture : (clientBuckets?.future ?? [])
  const past = serverPast.length > 0 ? serverPast : (clientBuckets?.past ?? [])

  // Client-only logging: only when ?debug=1. No secrets (no env, no full keys).
  useEffect(() => {
    if (!debug || typeof window === 'undefined') return
    const errorCode = initialError?.code
    const errorMessage = initialError?.message
    const dataCount = active.length + future.length + past.length
    console.log('raffles fetch', { dataCount, errorCode, errorMessage, fromClient: !!clientBuckets })
  }, [debug, initialError?.code, initialError?.message, active.length, future.length, past.length, clientBuckets])

  const handleRefresh = useCallback(() => {
    setClientBuckets(null)
    setClientFetchError(null)
    setClientFetchStarted(false)
    router.refresh()
  }, [router])

  const isEmpty = active.length === 0 && future.length === 0 && past.length === 0
  // If we recovered via client fallback, show list and only show error as secondary
  const recoveredFromError = !!initialError && !!(clientBuckets && (clientBuckets.active.length + clientBuckets.future.length + clientBuckets.past.length > 0))
  const hasError = (initialError || (isEmpty && clientFetchError)) && !recoveredFromError
  const rawErrorMessage = initialError?.message ?? clientFetchError ?? 'Unknown error'
  const showConnectivityMessage = hasError && isConnectivityError(rawErrorMessage)
  const showPausedMessage = hasError && isSupabasePausedError(rawErrorMessage)

  return (
    <div className="w-full min-w-0 container mx-auto py-4 sm:py-6 md:py-8 px-3 sm:px-4">
      {/* Debug panel: ?debug=1 only. No env values, no full keys. */}
      {debug && (
        <div className="mb-6 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <h3 className="font-semibold text-amber-600 dark:text-amber-400 mb-2">Diagnostics (?debug=1)</h3>
          <ul className="space-y-1 text-muted-foreground">
            <li>wallet: — (connect wallet to see)</li>
            <li>environment: {typeof window !== 'undefined' ? window.location.hostname : '—'}</li>
            <li>fetch status: {initialError ? 'error' : fetchStatus}{clientBuckets ? ' (client fallback)' : ''}</li>
            {initialError && (
              <li>
                error: {initialError.message}
                {initialError.code ? ` (code: ${initialError.code})` : ''}
              </li>
            )}
            {clientFetchError && <li>client fallback error: {clientFetchError}</li>}
            <li>raffles count: {active.length + future.length + past.length} (server: {rafflesTotalCount})</li>
          </ul>
        </div>
      )}

      <div className="mb-6 sm:mb-8">
        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-2 bg-gradient-to-r from-white via-green-400 to-green-300 bg-clip-text text-transparent drop-shadow-lg tracking-tight">
          Owl Raffles
        </h1>
        <p className="text-base sm:text-lg font-medium tracking-wide bg-gradient-to-r from-gray-300 via-green-400 to-gray-300 bg-clip-text text-transparent">
          Trusted raffles with full transparency. Every entry verified on-chain.
        </p>
      </div>

      {/* Error state: visible card with message. 503 = Supabase paused; other connectivity = generic. */}
      {hasError && (
        <div className="mb-8 rounded-lg border border-destructive/30 bg-destructive/10 p-6">
          <h2 className="text-lg font-semibold text-destructive mb-2">Could not load raffles</h2>
          {showPausedMessage ? (
            <>
              <p className="text-destructive/90 mb-2">
                Your Supabase project is returning &quot;Service Unavailable&quot; (503). On the free tier, projects pause after inactivity.
              </p>
              <p className="text-destructive/90 mb-4">
                Go to{' '}
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium"
                >
                  Supabase Dashboard
                </a>
                , open your project, and click <strong>Restore project</strong>. Wait a minute for it to wake, then click Try again below.
              </p>
            </>
          ) : showConnectivityMessage ? (
            <p className="text-destructive/90 mb-2">
              We&apos;re experiencing brief connectivity issues. This can happen during database maintenance or if your Supabase project was paused (free tier). Check your Supabase dashboard and restore the project if needed, then try again.
            </p>
          ) : (
            <p className="text-destructive/90 mb-2">{rawErrorMessage}</p>
          )}
          {initialError?.code && !showConnectivityMessage && !showPausedMessage && (
            <p className="text-sm text-muted-foreground mb-4">Code: {initialError.code}</p>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      )}

      {/* Recovery notice when we loaded from API after server error */}
      {recoveredFromError && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          Raffles loaded. If something looks wrong, try refreshing.
        </div>
      )}

      {/* Main content: only when no error to show (list or empty state) */}
      {!hasError && (
        <>
          <div className="mb-8 sm:mb-12 w-full min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Active Raffles</h2>
            {active.length > 0 ? (
              <RafflesList
                rafflesWithEntries={active}
                title={undefined}
                section="active"
              />
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No active raffles at the moment. Check back soon!</p>
              </div>
            )}
          </div>

          <div className="mb-8 sm:mb-12">
            <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Future Raffles</h2>
            {future.length > 0 ? (
              <RafflesList
                rafflesWithEntries={future}
                title={undefined}
                section="future"
              />
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No upcoming raffles scheduled at this time</p>
              </div>
            )}
          </div>

          {past.length > 0 && (
            <div className="mb-8 sm:mb-12 w-full min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Past Raffles</h2>
              <RafflesList
                rafflesWithEntries={past}
                title={undefined}
                section="past"
              />
            </div>
          )}

          {/* Empty state: no raffles at all — show message + refresh (or loading while client fallback runs) */}
          {isEmpty && (
            <div className="text-center py-16">
              {clientFetchStarted && !clientBuckets && !clientFetchError ? (
                <p className="text-xl text-muted-foreground">Loading raffles…</p>
              ) : (
                <>
                  <p className="text-xl text-muted-foreground mb-4">No active raffles yet</p>
                  <button
                    type="button"
                    onClick={handleRefresh}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Refresh
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

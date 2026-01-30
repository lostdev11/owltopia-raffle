'use client'

/**
 * Client for /raffles: list + debug panel + resilient states.
 * - ?debug=1: diagnostics (wallet truncated, hostname, fetch status, error message/code, count). No secrets.
 * - Error/empty: visible card or "No active raffles yet" + refresh. No blank screen.
 * - When server returns empty, fallback: fetch from GET /api/raffles and bucket client-side so cards show.
 * - Logging: console.log("raffles fetch", ...) only when ?debug=1.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { RafflesList } from '@/components/RafflesList'
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
    if (raffle.winner_selected_at || endTimeMs <= nowTime || !raffle.is_active) {
      past.push(withEntries(raffle))
      continue
    }
    if (startTimeMs > nowTime) {
      future.push(withEntries(raffle))
      continue
    }
    if (startTimeMs <= nowTime && endTimeMs > nowTime && raffle.is_active) {
      active.push(withEntries(raffle))
      continue
    }
    past.push(withEntries(raffle))
  }
  return { active, future, past }
}

type RaffleWithEntries = { raffle: Raffle; entries: Entry[] }

/** Detect DB/connection or timeout errors (e.g. during Supabase maintenance) for user-friendly messaging */
function isConnectivityError(message: string | null | undefined): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return (
    m.includes('connection') ||
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('database operation failed after') ||
    m.includes('failed to fetch') ||
    m.includes('network') ||
    m.includes('econnrefused') ||
    m.includes('etimedout') ||
    m.includes('server error')
  )
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

  // Fallback: when server returned no raffles and no error, fetch from API (e.g. RLS or cache edge case)
  useEffect(() => {
    if (initialError || !isEmptyFromServer || typeof window === 'undefined') return
    let cancelled = false
    setClientFetchError(null)
    setClientFetchStarted(true)
    fetch('/api/raffles')
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setClientFetchError(res.status === 500 ? 'Server error' : `HTTP ${res.status}`)
          return res.json().catch(() => ({}))
        }
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        if (data?.error) {
          setClientFetchError(data.error)
          return
        }
        const list = Array.isArray(data) ? data : []
        if (list.length > 0) {
          setClientBuckets(bucketRaffles(list as Raffle[]))
        }
      })
      .catch((err) => {
        if (!cancelled) setClientFetchError(err?.message || 'Failed to load raffles')
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
  const hasError = initialError || (isEmpty && clientFetchError)
  const rawErrorMessage = initialError?.message ?? clientFetchError ?? 'Unknown error'
  const showConnectivityMessage = hasError && isConnectivityError(rawErrorMessage)

  return (
    <div className="container mx-auto py-4 sm:py-6 md:py-8 px-3 sm:px-4">
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

      {/* Error state: visible card with message + code (no secrets). Friendly message for connectivity/maintenance. */}
      {hasError && (
        <div className="mb-8 rounded-lg border border-destructive/30 bg-destructive/10 p-6">
          <h2 className="text-lg font-semibold text-destructive mb-2">Could not load raffles</h2>
          {showConnectivityMessage ? (
            <p className="text-destructive/90 mb-2">
              We&apos;re experiencing brief connectivity issues. This can happen during database maintenance—please try again in a moment.
            </p>
          ) : (
            <p className="text-destructive/90 mb-2">{rawErrorMessage}</p>
          )}
          {initialError?.code && !showConnectivityMessage && (
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

      {/* Main content: only when no error to show (list or empty state) */}
      {!hasError && (
        <>
          <div className="mb-8 sm:mb-12">
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
            <div className="mb-8 sm:mb-12">
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

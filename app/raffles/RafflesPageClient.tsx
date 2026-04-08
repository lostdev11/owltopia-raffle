'use client'

/**
 * Client for /raffles: list + debug panel + resilient states.
 * - ?debug=1: diagnostics (wallet truncated, hostname, fetch status, error message/code, count). No secrets.
 * - Error/empty: visible card or "No active raffles yet" + refresh. No blank screen.
 * - When server returns empty, fallback: fetch from GET /api/raffles and bucket client-side so cards show.
 * - When API also fails: try direct Supabase from browser (different connection path, often works when server times out).
 * - Logging: console.log("raffles fetch", ...) only when ?debug=1.
 * - Tab "Raffles entered": when wallet connected, users see only their own entries with date and blockchain validation.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import { useServerTime } from '@/lib/hooks/useServerTime'
import { RafflesList } from '@/components/RafflesList'
import { RaffleCard } from '@/components/RaffleCard'
import { MyEntriesList } from '@/components/MyEntriesList'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Raffle, Entry } from '@/lib/types'
import type { RaffleProfitInfo } from '@/lib/raffle-profit'
import { Eye, Shield, Megaphone, Flame, Trophy, Ticket, PlusCircle, Medal, Loader2, Crown, ShoppingCart, Gift } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnnouncementsBlock, type AnnouncementItem } from '@/components/AnnouncementsBlock'
import { MarkdownContent } from '@/components/MarkdownContent'
import { PLATFORM_NAME } from '@/lib/site-config'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { filterRafflesByPendingVisibility, isPendingNftRaffleAtTime } from '@/lib/raffles/visibility'
import { RAFFLES_PUBLIC_LIST_STATUSES_WITH_DRAFT } from '@/lib/raffles/list-query-statuses'
import { RAFFLES_PAGE_SERVER_REFRESH_MS } from '@/lib/dev-budget'
import {
  CommunityGiveawayBrowseCard,
  type CommunityGiveawayBrowseItem,
} from '@/components/CommunityGiveawayBrowseCard'

type FetchStatus = 'loading' | 'success' | 'empty' | 'error'

interface RafflesPageClientProps {
  activeRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  pausedPendingRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  futureRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  pastRafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  /** Server-side fetch result: success (has data), empty (0 raffles), or error */
  fetchStatus?: FetchStatus
  /** When fetch failed (e.g. RLS/403). No secrets; message + code only */
  initialError?: { message: string; code?: string }
  /** Total raffles returned by server (for debug panel) */
  rafflesTotalCount?: number
}

function bucketRaffles(raffles: Raffle[], now: Date): { active: RaffleWithEntries[]; pausedPending: RaffleWithEntries[]; future: RaffleWithEntries[]; past: RaffleWithEntries[] } {
  const withEntries = (r: Raffle): RaffleWithEntries => ({ raffle: r, entries: [] })
  const nowTime = now.getTime()
  const active: RaffleWithEntries[] = []
  const pausedPending: RaffleWithEntries[] = []
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
    if (isPendingNftRaffleAtTime(raffle, nowTime)) {
      pausedPending.push(withEntries(raffle))
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
    // Future: draft or live that haven't started — show for everyone
    if ((raffle.status === 'draft' || raffle.status === 'live') && startTimeMs > nowTime) {
      future.push(withEntries(raffle))
      continue
    }
    if (raffle.status === 'live' && startTimeMs <= nowTime && endTimeMs > nowTime) {
      active.push(withEntries(raffle))
      continue
    }
    past.push(withEntries(raffle))
  }
  return { active, pausedPending, future, past }
}

type RaffleWithEntries = { raffle: Raffle; entries: Entry[] }
type RaffleWithEntriesAndProfit = RaffleWithEntries & { profitInfo?: RaffleProfitInfo }

function PastRafflesCarousel({ items }: { items: RaffleWithEntries[] }) {
  const list = items ?? []
  const [index, setIndex] = useState(0)
  const [rotationVersion, setRotationVersion] = useState(0)
  const lastNavAtRef = useRef(0)
  const total = list.length

  const clampIndex = (value: number) => {
    if (total === 0) return 0
    if (value < 0) return total - 1
    if (value >= total) return 0
    return value
  }

  // Auto-advance through past raffles when there is more than one. Must run unconditionally (Rules of Hooks).
  useEffect(() => {
    if (total <= 1) return
    const id = setInterval(() => {
      setIndex((prev) => clampIndex(prev + 1))
    }, 6000)
    return () => clearInterval(id)
  }, [total, rotationVersion])

  if (total === 0) return null

  const goPrev = () => {
    const now = Date.now()
    if (now - lastNavAtRef.current < 250) return
    lastNavAtRef.current = now
    setIndex((prev) => clampIndex(prev - 1))
    setRotationVersion((v) => v + 1)
  }

  const goNext = () => {
    const now = Date.now()
    if (now - lastNavAtRef.current < 250) return
    lastNavAtRef.current = now
    setIndex((prev) => clampIndex(prev + 1))
    setRotationVersion((v) => v + 1)
  }

  const current = list[clampIndex(index)]

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center justify-between gap-3 mb-4 sm:mb-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Browse past raffles</span>
          <span className="text-xs">
            {clampIndex(index) + 1} of {total}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            className="touch-manipulation inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-base font-medium hover:bg-accent disabled:opacity-40 disabled:hover:bg-background"
            disabled={total <= 1}
            aria-label="Previous past raffle"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={goNext}
            className="touch-manipulation inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-base font-medium hover:bg-accent disabled:opacity-40 disabled:hover:bg-background"
            disabled={total <= 1}
            aria-label="Next past raffle"
          >
            ›
          </button>
        </div>
      </div>
      <div className="w-full min-w-0">
        <RaffleCard
          raffle={current.raffle}
          entries={current.entries}
          size="small"
          section="past"
          priority
        />
      </div>
    </div>
  )
}

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
    m.includes('522') ||
    m.includes('aborted') ||
    m.includes('service unavailable') ||
    m.includes('bad gateway') ||
    m.includes('unable to load raffles')
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
  pausedPendingRafflesWithEntries,
  futureRafflesWithEntries,
  pastRafflesWithEntries,
  fetchStatus = 'success',
  initialError,
  rafflesTotalCount = 0,
}: RafflesPageClientProps) {
  const featuredCardTouchRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  // Defensive: coerce null/undefined to [] so we never read .length on null (e.g. after serialization)
  const serverActive = activeRafflesWithEntries ?? []
  const serverPausedPending = pausedPendingRafflesWithEntries ?? []
  const serverFuture = futureRafflesWithEntries ?? []
  const serverPast = pastRafflesWithEntries ?? []

  const [clientBuckets, setClientBuckets] = useState<{
    active: RaffleWithEntries[]
    pausedPending: RaffleWithEntries[]
    future: RaffleWithEntries[]
    past: RaffleWithEntries[]
  } | null>(null)
  const [clientFetchError, setClientFetchError] = useState<string | null>(null)
  const [clientFetchStarted, setClientFetchStarted] = useState(false)

  const searchParams = useSearchParams()
  const router = useRouter()
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false)
  const debug = searchParams.get('debug') === '1'
  const { serverNow: serverTime, isSynced: serverTimeSynced } = useServerTime()
  const serverTimeRef = useRef(serverTime)
  serverTimeRef.current = serverTime

  // Used to gate visibility of pending NFT raffles in client-side fallback flows.
  useEffect(() => {
    if (!connected || !publicKey) {
      setViewerIsAdmin(false)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached !== null) {
      setViewerIsAdmin(cached)
      return
    }
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const isAdmin = data?.isAdmin === true
        setCachedAdmin(addr, isAdmin)
        setViewerIsAdmin(isAdmin)
      })
      .catch(() => {
        if (!cancelled) setViewerIsAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey])

  /**
   * Pending NFT raffles (draft/paused escrow) are filtered server-side using the signed session cookie.
   * Many users connect their wallet without a session (or session expired), so SSR/API hide their own drafts.
   * When a wallet is connected, re-fetch via Supabase (same source as the empty-state fallback) and re-apply
   * visibility using the adapter address so creators see their pending raffles on mobile and desktop.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!connected || !wallet || !isSupabaseConfigured()) {
      setClientBuckets(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('raffles')
          .select('*')
          .in('status', [...RAFFLES_PUBLIC_LIST_STATUSES_WITH_DRAFT])
          .order('created_at', { ascending: false })
        if (cancelled) return
        if (error) throw new Error(error.message)
        const list = (data || []) as Partial<Raffle>[]
        const normalized = list.map((r: Partial<Raffle>) => ({
          ...r,
          prize_type: (r.prize_type ?? 'crypto') as 'crypto' | 'nft',
          nft_mint_address: r.nft_mint_address ?? null,
          nft_collection_name: r.nft_collection_name ?? null,
          nft_token_id: r.nft_token_id ?? null,
          nft_metadata_uri: r.nft_metadata_uri ?? null,
        })) as Raffle[]
        const filtered = filterRafflesByPendingVisibility(normalized, wallet, viewerIsAdmin)
        if (cancelled) return
        setClientBuckets(bucketRaffles(filtered, serverTimeRef.current))
        setClientFetchError(null)
      } catch {
        // Keep server-rendered buckets; avoid blanking the list on transient errors.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connected, wallet, viewerIsAdmin])

  type Tab = 'all' | 'giveaways' | 'my-entries' | 'owl-vision' | 'announcements' | 'leaderboard'
  const [tab, setTab] = useState<Tab>('all')
  const [giveawaysList, setGiveawaysList] = useState<CommunityGiveawayBrowseItem[] | null>(null)
  const [giveawaysLoading, setGiveawaysLoading] = useState(false)
  const [giveawaysError, setGiveawaysError] = useState<string | null>(null)
  const [topProfitableActive, setTopProfitableActive] = useState<RaffleWithEntriesAndProfit[]>([])

  const [announcementsList, setAnnouncementsList] = useState<AnnouncementItem[]>([])
  const [hasNewAnnouncements, setHasNewAnnouncements] = useState(false)
  const [leaderboardData, setLeaderboardData] = useState<{
    rafflesEntered: Array<{ rank: number; wallet: string; value: number }>
    ticketsPurchased: Array<{ rank: number; wallet: string; value: number }>
    rafflesCreated: Array<{ rank: number; wallet: string; value: number }>
    rafflesWon: Array<{ rank: number; wallet: string; value: number }>
    ticketsSold: Array<{ rank: number; wallet: string; value: number }>
  } | null>(null)
  const [leaderboardPeriodLabel, setLeaderboardPeriodLabel] = useState<string | null>(null)
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [leaderboardDisplayNames, setLeaderboardDisplayNames] = useState<Record<string, string>>({})

  useEffect(() => {
    const t = searchParams.get('tab')
    if (t === 'giveaways' || t === 'giveaway') setTab('giveaways')
  }, [searchParams])

  const handleFeaturedCardTouchStart = (e: React.TouchEvent<HTMLAnchorElement>) => {
    const touch = e.touches[0]
    if (!touch) return
    featuredCardTouchRef.current = { x: touch.clientX, y: touch.clientY, moved: false }
  }

  const handleFeaturedCardTouchMove = (e: React.TouchEvent<HTMLAnchorElement>) => {
    const touch = e.touches[0]
    const start = featuredCardTouchRef.current
    if (!touch || !start) return
    const movedX = Math.abs(touch.clientX - start.x)
    const movedY = Math.abs(touch.clientY - start.y)
    if (movedX > 8 || movedY > 8) {
      featuredCardTouchRef.current = { ...start, moved: true }
    }
  }

  const handleFeaturedCardTouchEnd = (e: React.TouchEvent<HTMLAnchorElement>) => {
    if (featuredCardTouchRef.current?.moved) {
      e.preventDefault()
      e.stopPropagation()
    }
    featuredCardTouchRef.current = null
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/announcements?placement=raffles')
      .then((res) => (cancelled ? undefined : res.json()))
      .then((data) => {
        if (cancelled) return
        if (data && typeof data === 'object' && Array.isArray(data.announcements)) {
          setAnnouncementsList(data.announcements)
          setHasNewAnnouncements(Boolean(data.hasNew))
        } else {
          setAnnouncementsList(Array.isArray(data) ? data : [])
        }
      })
      .catch(() => { if (!cancelled) setAnnouncementsList([]) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (tab !== 'leaderboard') return
    setLeaderboardLoading(true)
    fetch('/api/leaderboard', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load'))))
      .then((json: Record<string, unknown>) => {
        const { period, ...rest } = json
        setLeaderboardData(
          rest as {
            rafflesEntered: Array<{ rank: number; wallet: string; value: number }>
            ticketsPurchased: Array<{ rank: number; wallet: string; value: number }>
            rafflesCreated: Array<{ rank: number; wallet: string; value: number }>
            rafflesWon: Array<{ rank: number; wallet: string; value: number }>
            ticketsSold: Array<{ rank: number; wallet: string; value: number }>
          }
        )
        setLeaderboardPeriodLabel(
          period && typeof period === 'object' && period !== null && 'label' in period && typeof (period as { label: unknown }).label === 'string'
            ? (period as { label: string }).label
            : null
        )
      })
      .catch(() => {
        setLeaderboardData(null)
        setLeaderboardPeriodLabel(null)
      })
      .finally(() => setLeaderboardLoading(false))
  }, [tab])

  // Fetch display names for wallets that appear in the in-page leaderboard
  useEffect(() => {
    if (!leaderboardData) {
      setLeaderboardDisplayNames({})
      return
    }
    const wallets = new Set<string>()
    leaderboardData.rafflesEntered.forEach((e) => wallets.add(e.wallet))
    ;(leaderboardData.ticketsPurchased ?? []).forEach((e) => wallets.add(e.wallet))
    leaderboardData.rafflesCreated.forEach((e) => wallets.add(e.wallet))
    leaderboardData.rafflesWon.forEach((e) => wallets.add(e.wallet))
    leaderboardData.ticketsSold.forEach((e) => wallets.add(e.wallet))
    const list = [...wallets].slice(0, 200)
    if (list.length === 0) {
      setLeaderboardDisplayNames({})
      return
    }
    const q = list.join(',')
    fetch(`/api/profiles?wallets=${encodeURIComponent(q)}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((map: Record<string, string>) => setLeaderboardDisplayNames(map))
      .catch(() => setLeaderboardDisplayNames({}))
  }, [leaderboardData])

  const isEmptyFromServer =
    serverActive.length === 0 &&
    serverPausedPending.length === 0 &&
    serverFuture.length === 0 &&
    serverPast.length === 0

  // Fallback: when server returned no raffles OR an error, fetch from API + direct Supabase in parallel
  // Use serverTime (always a Date; may be client time until /api/time syncs) so we don't block on sync
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Connected wallet: visibility merge effect loads the list with the adapter address.
    if (connected && wallet) return
    if (!isEmptyFromServer && !initialError) return
    let cancelled = false
    setClientFetchError(null)
    setClientFetchStarted(true)

    // Skip direct Supabase when the error suggests Supabase is down (avoids CORS noise from 522 responses)
    const isLikelySupabaseDown = (msg: string | null) =>
      !msg ||
      /503|service unavailable|rest error|522|connection|timeout|supabase|\.supabase\.co/i.test(msg)

    const tryDirectSupabase = async () => {
      if (!isSupabaseConfigured() || cancelled) return
      try {
        // Direct browser→Supabase fetch; often works when server→Supabase times out
        const { data, error } = await supabase
          .from('raffles')
          .select('*')
          .in('status', [...RAFFLES_PUBLIC_LIST_STATUSES_WITH_DRAFT])
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
            const filtered = filterRafflesByPendingVisibility(normalized, wallet || null, viewerIsAdmin)
            setClientBuckets(bucketRaffles(filtered, serverTime))
          setClientFetchError(null)
        }
      } catch {
        // Ignore - keep existing API error message (avoids CORS/network noise)
      }
    }

    // When server already failed, try direct Supabase only if error doesn't suggest Supabase is down
    if (initialError && !isLikelySupabaseDown(initialError.message)) tryDirectSupabase()

    fetch('/api/raffles')
      .then(async (res) => {
        if (cancelled) return null
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const bodyMessage = typeof data?.error === 'string' ? data.error : null
          const is503 = res.status === 503 || /503|service temporarily unavailable/i.test(bodyMessage ?? '')
          const skipDirectSupabase = is503 || isLikelySupabaseDown(bodyMessage)
          setClientFetchError(
            bodyMessage ||
              (is503
                ? 'Service temporarily unavailable. Please try again in a moment.'
                : res.status === 502
                  ? 'Raffles could not be loaded. If this continues, check that your Supabase project is running (Supabase dashboard).'
                  : res.status === 500
                    ? 'Server error'
                    : `HTTP ${res.status}`)
          )
          if (!skipDirectSupabase) tryDirectSupabase()
          return null
        }
        return data
      })
      .then((data) => {
        if (cancelled || data == null) return
        if (data?.error) {
          setClientFetchError(data.error)
          const is503 = /503|service temporarily unavailable/i.test(data.error)
          if (!is503 && !isLikelySupabaseDown(data.error)) tryDirectSupabase()
          return
        }
        // Handle both raw array and wrapped { data: [...] } responses
        const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : [])
        if (list.length > 0) {
          const filtered = filterRafflesByPendingVisibility(list as Raffle[], wallet || null, viewerIsAdmin)
          setClientBuckets(bucketRaffles(filtered, serverTime))
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
  }, [initialError, isEmptyFromServer, viewerIsAdmin, wallet, connected])

  const useWalletVisibilityBuckets = Boolean(connected && wallet && clientBuckets)
  const active = useWalletVisibilityBuckets
    ? (clientBuckets!.active)
    : serverActive.length > 0
      ? serverActive
      : (clientBuckets?.active ?? [])
  const pausedPending = useWalletVisibilityBuckets
    ? clientBuckets!.pausedPending
    : serverPausedPending.length > 0
      ? serverPausedPending
      : (clientBuckets?.pausedPending ?? [])
  const future = useWalletVisibilityBuckets
    ? clientBuckets!.future
    : serverFuture.length > 0
      ? serverFuture
      : (clientBuckets?.future ?? [])
  const past = useWalletVisibilityBuckets
    ? clientBuckets!.past
    : serverPast.length > 0
      ? serverPast
      : (clientBuckets?.past ?? [])
  const allRafflesFlat: Raffle[] = [
    ...active.map((item) => item.raffle),
    ...pausedPending.map((item) => item.raffle),
    ...future.map((item) => item.raffle),
    ...past.map((item) => item.raffle),
  ]

  // Client-only logging: only when ?debug=1. No secrets (no env, no full keys).
  useEffect(() => {
    if (!debug || typeof window === 'undefined') return
    const errorCode = initialError?.code
    const errorMessage = initialError?.message
    const dataCount = active.length + pausedPending.length + future.length + past.length
    console.log('raffles fetch', { dataCount, errorCode, errorMessage, fromClient: !!clientBuckets })
  }, [debug, initialError?.code, initialError?.message, active.length, pausedPending.length, future.length, past.length, clientBuckets])

  const handleRefresh = useCallback(() => {
    setClientBuckets(null)
    setClientFetchError(null)
    setClientFetchStarted(false)
    router.refresh()
  }, [router])

  // Periodically refresh raffle data so threshold (prize_amount / floor_price) and list stay up to date
  useEffect(() => {
    if (tab !== 'all') return
    const interval = setInterval(() => {
      router.refresh()
    }, RAFFLES_PAGE_SERVER_REFRESH_MS)
    return () => clearInterval(interval)
  }, [tab, router])

  // Refresh when user returns to the tab so threshold/raffle edits are visible
  useEffect(() => {
    if (tab !== 'all') return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const handler = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      timeoutId = setTimeout(() => {
        timeoutId = null
        try {
          router.refresh()
        } catch {
          // Ignore sync errors; Next.js internal fetch errors still log but won't crash
        }
      }, 150)
    }
    window.addEventListener('focus', handler)
    return () => {
      window.removeEventListener('focus', handler)
      if (timeoutId !== null) clearTimeout(timeoutId)
    }
  }, [tab, router])

  useEffect(() => {
    if (tab !== 'giveaways') return
    let cancelled = false
    setGiveawaysLoading(true)
    setGiveawaysError(null)
    fetch('/api/public/community-giveaways', { cache: 'no-store' })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok && typeof data?.error === 'string') {
          setGiveawaysList([])
          setGiveawaysError(data.error)
          return
        }
        const list = Array.isArray(data?.giveaways) ? data.giveaways : []
        setGiveawaysList(list as CommunityGiveawayBrowseItem[])
        setGiveawaysError(null)
      })
      .catch((err) => {
        if (!cancelled) {
          setGiveawaysList([])
          setGiveawaysError(err instanceof Error ? err.message : 'Could not load giveaways')
        }
      })
      .finally(() => {
        if (!cancelled) setGiveawaysLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab])

  const isEmpty = active.length === 0 && pausedPending.length === 0 && future.length === 0 && past.length === 0
  // If we recovered via client fallback, show list and only show error as secondary
  const recoveredFromError =
    !!initialError &&
    !!(
      clientBuckets &&
      (clientBuckets.active.length +
        clientBuckets.pausedPending.length +
        clientBuckets.future.length +
        clientBuckets.past.length >
        0)
    )
  const hasError = (initialError || (isEmpty && clientFetchError)) && !recoveredFromError
  const rawErrorMessage = initialError?.message ?? clientFetchError ?? 'Unknown error'
  const showConnectivityMessage = hasError && isConnectivityError(rawErrorMessage)
  const showPausedMessage = hasError && isSupabasePausedError(rawErrorMessage)

  return (
  <div className="w-full min-w-0 container mx-auto py-4 sm:py-6 md:py-8 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:px-4">
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
            <li>raffles count: {active.length + pausedPending.length + future.length + past.length} (server: {rafflesTotalCount})</li>
          </ul>
        </div>
      )}

      <div className="mb-6 sm:mb-8">
        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-2 bg-gradient-to-r from-white via-green-400 to-green-300 bg-clip-text text-transparent drop-shadow-lg tracking-tight">
          {PLATFORM_NAME}
        </h1>
        <p className="text-base sm:text-lg font-medium tracking-wide bg-gradient-to-r from-gray-300 via-green-400 to-gray-300 bg-clip-text text-transparent">
          Trusted raffles with full transparency. Every entry verified on-chain.
        </p>
        {tab === 'all' && topProfitableActive.length > 0 && (
          <div className="mt-4 grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {topProfitableActive.slice(0, 3).map(({ raffle, profitInfo }) => {
              const threshold = profitInfo?.threshold ?? null
              const cur = profitInfo?.thresholdCurrency ?? raffle.currency
              let revenueValue: number | null = null
              if (profitInfo) {
                if (profitInfo.thresholdCurrency === 'USDC') revenueValue = profitInfo.revenue.usdc
                else if (profitInfo.thresholdCurrency === 'SOL') revenueValue = profitInfo.revenue.sol
                else if (profitInfo.thresholdCurrency === 'OWL') revenueValue = profitInfo.revenue.owl
              }
              return (
                <Link
                  key={raffle.id}
                  href={`/raffles/${raffle.slug}`}
                  className="relative overflow-hidden rounded-xl border border-emerald-400/70 bg-gradient-to-br from-emerald-500/15 via-emerald-400/5 to-transparent shadow-[0_0_25px_rgba(16,185,129,0.7)] px-3 py-3 sm:px-4 sm:py-4 hover:border-emerald-300 hover:shadow-[0_0_30px_rgba(16,185,129,0.85)] transition-all cursor-pointer"
                  onTouchStart={handleFeaturedCardTouchStart}
                  onTouchMove={handleFeaturedCardTouchMove}
                  onTouchEnd={handleFeaturedCardTouchEnd}
                >
                  <div className="pointer-events-none absolute -inset-px bg-[radial-gradient(circle_at_0_0,rgba(74,222,128,0.35),transparent_55%),radial-gradient(circle_at_100%_0,rgba(16,185,129,0.4),transparent_50%)] opacity-70" />
                  <div className="relative flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm sm:text-base font-semibold text-emerald-50">
                        {raffle.title}
                      </p>
                      <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] sm:text-xs font-semibold text-emerald-200">
                        Over threshold
                      </span>
                    </div>
                    {revenueValue != null && (
                      <p className="text-[11px] sm:text-xs text-emerald-100/80">
                        Revenue:{' '}
                        <span className="font-semibold">
                          {revenueValue.toFixed(cur === 'USDC' ? 2 : 4)} {cur}
                        </span>{' '}
                        · {raffle.prize_type === 'nft' ? 'Floor' : 'Threshold'}:{' '}
                        <span className="font-semibold">
                          {threshold != null ? threshold.toFixed(cur === 'USDC' ? 2 : 4) : '0.0000'} {cur}
                        </span>
                      </p>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
        {/* Tabs: All raffles | Raffles entered | Owl Vision | Announcements | Leaderboard — mobile-friendly touch targets */}
        <div className="mt-4 sm:mt-6 flex flex-wrap gap-1 sm:gap-2 border-b border-border -mx-1 px-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setTab('all')}
            className={`touch-manipulation min-h-[44px] px-3 sm:px-4 py-2.5 sm:py-2 text-sm font-medium rounded-t-md transition-colors whitespace-nowrap ${
              tab === 'all'
                ? 'bg-primary/20 text-primary border-b-2 border-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All raffles
          </button>
          <button
            type="button"
            onClick={() => setTab('giveaways')}
            className={`flex items-center gap-1.5 touch-manipulation min-h-[44px] px-3 sm:px-4 py-2.5 sm:py-2 text-sm font-medium rounded-t-md transition-colors whitespace-nowrap ${
              tab === 'giveaways'
                ? 'bg-primary/20 text-primary border-b-2 border-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Gift className="h-4 w-4 shrink-0" />
            Giveaways
          </button>
          <button
            type="button"
            onClick={() => setTab('my-entries')}
            className={`touch-manipulation min-h-[44px] px-3 sm:px-4 py-2.5 sm:py-2 text-sm font-medium rounded-t-md transition-colors whitespace-nowrap ${
              tab === 'my-entries'
                ? 'bg-primary/20 text-primary border-b-2 border-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Raffles entered
          </button>
          <button
            type="button"
            onClick={() => setTab('owl-vision')}
            className={`flex items-center gap-1.5 touch-manipulation min-h-[44px] px-3 sm:px-4 py-2.5 sm:py-2 text-sm font-medium rounded-t-md transition-colors whitespace-nowrap ${
              tab === 'owl-vision'
                ? 'bg-primary/20 text-primary border-b-2 border-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Eye className="h-4 w-4 shrink-0" />
            Owl Vision
          </button>
          <button
            type="button"
            onClick={() => setTab('announcements')}
            className={`relative flex items-center gap-1.5 touch-manipulation min-h-[44px] px-3 sm:px-4 py-2.5 sm:py-2 text-sm font-medium rounded-t-md transition-colors whitespace-nowrap ${
              tab === 'announcements'
                ? 'bg-primary/20 text-primary border-b-2 border-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Megaphone className="h-4 w-4 shrink-0" />
            Announcements
            {hasNewAnnouncements && (
              <span
                className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-background"
                aria-label="New announcement"
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab('leaderboard')}
            className={`flex items-center gap-1.5 touch-manipulation min-h-[44px] px-3 sm:px-4 py-2.5 sm:py-2 text-sm font-medium rounded-t-md transition-colors whitespace-nowrap ${
              tab === 'leaderboard'
                ? 'bg-primary/20 text-primary border-b-2 border-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Trophy className="h-4 w-4 shrink-0" />
            Leaderboard
          </button>
        </div>
      </div>

      {/* Error state: only blocks the All raffles tab; other tabs (e.g. Giveaways) still load their own data. */}
      {hasError && tab === 'all' && (
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
            className="rounded-md bg-primary px-4 py-3 sm:py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 touch-manipulation min-h-[44px]"
          >
            Try again
          </button>
        </div>
      )}

      {/* Main content: All raffles tab hidden on fetch error; other tabs still render. */}
      {(!hasError || tab !== 'all') && (
        <>
          {tab === 'giveaways' ? (
            <div className="mb-8 sm:mb-12 w-full min-w-0 max-w-3xl space-y-6">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold mb-2">Community giveaways</h2>
                <p className="text-sm text-muted-foreground">
                  Free pool giveaways — join with your wallet (sign in on the giveaway page). Owl NFT holders can enter
                  holder-only pools; everyone can join open pools. OWL boosts add extra draw weight before the boost
                  deadline.
                </p>
              </div>
              {giveawaysLoading && (
                <div className="flex items-center gap-2 text-muted-foreground py-8">
                  <Loader2 className="h-6 w-6 animate-spin shrink-0" />
                  <span>Loading giveaways…</span>
                </div>
              )}
              {!giveawaysLoading && giveawaysError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                  {giveawaysError}
                </div>
              )}
              {!giveawaysLoading && !giveawaysError && giveawaysList && giveawaysList.length === 0 && (
                <p className="text-muted-foreground py-8">No public giveaways right now. Check back soon.</p>
              )}
              {!giveawaysLoading && !giveawaysError && giveawaysList && giveawaysList.length > 0 && (
                <ul className="space-y-4">
                  {giveawaysList.map((g) => (
                    <li key={g.id}>
                      <CommunityGiveawayBrowseCard g={g} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : tab === 'owl-vision' ? (
            <div className="mb-8 sm:mb-12 w-full min-w-0 max-w-3xl space-y-6">
              <Card className="border-green-500/30 bg-green-500/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Eye className="h-5 w-5 text-green-500" />
                    What is Owl Vision?
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    Owl Vision is a <strong className="text-foreground">trust score (0–100)</strong> shown on each raffle. It helps you see how transparent and fair a raffle is — before you buy a ticket.
                  </p>
                  <p>
                    We believe on-chain raffles should be verifiable. Owl Vision summarizes three things that matter for trust: verified payments, wallet diversity, and time integrity.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Verified Payments (up to 60 points)</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  What share of entries have been confirmed by on-chain verification? A high percentage means most tickets are backed by real, verified transactions.
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Wallet Diversity (up to 30 points)</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Are many different wallets participating, or is it a few wallets with lots of tickets? Higher diversity suggests a broader, more organic participation.
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Time Integrity (up to 10 points)</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Was the raffle edited after people had already entered? If not, the raffle gets full integrity points; if it was edited after entries, it gets fewer points so you&apos;re aware.
                </CardContent>
              </Card>

              <Card className="border-green-500/30 bg-green-500/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Shield className="h-4 w-4 text-green-500" />
                    How to read the score
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>
                    Hover or tap the <strong className="text-foreground">Owl Vision</strong> badge on any raffle card to see the breakdown. On a raffle&apos;s detail page, use the <strong className="text-foreground">Owl Vision</strong> tab for the full breakdown.
                  </p>
                  <p>
                    A higher score means more verified entries, better diversity, and no (or minimal) edits after entries — all signals of a trustworthy raffle.
                  </p>
                </CardContent>
              </Card>

              <p className="text-sm text-muted-foreground pt-2">
                <Link href="/how-it-works" className="text-green-500 hover:underline">How it works</Link> — full guide to raffles, winner selection, and Owl Vision.
              </p>
            </div>
          ) : tab === 'announcements' ? (
            <div className="mb-8 sm:mb-12 w-full min-w-0 max-w-3xl">
              <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2">
                <Megaphone className="h-6 w-6 text-primary" />
                Announcements
              </h2>
              {announcementsList.length > 0 ? (
                <div className="space-y-3">
                  {announcementsList.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
                    >
                      <div className="font-medium text-foreground">
                        <MarkdownContent content={a.title} compact />
                      </div>
                      {a.body && (
                        <div className="mt-1 text-sm text-muted-foreground">
                          <MarkdownContent content={a.body} compact />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No announcements at the moment. Check back later!</p>
              )}
            </div>
          ) : tab === 'leaderboard' ? (
            <div className="mb-8 sm:mb-12 w-full min-w-0 max-w-4xl">
              <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2">
                <Trophy className="h-6 w-6 text-primary shrink-0" />
                Leaderboard
              </h2>
              <p className="text-muted-foreground text-sm mb-2">
                Top 10 by raffles entered, tickets purchased, raffles created, raffles won, and tickets sold.
                {leaderboardPeriodLabel ? (
                  <>
                    {' '}
                    <span className="text-foreground font-medium">{leaderboardPeriodLabel}</span>
                    {' '}
                    (open{' '}
                    <Link href="/leaderboard" className="text-primary underline underline-offset-2">
                      Leaderboard
                    </Link>{' '}
                    for other months, year totals, or all-time).
                  </>
                ) : null}
              </p>
              {leaderboardLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8">
                  <Loader2 className="h-5 w-5 animate-spin shrink-0" />
                  Loading…
                </div>
              ) : leaderboardData ? (
                <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                  {[
                    {
                      title: 'Most raffles entered',
                      entries: leaderboardData.rafflesEntered,
                      valueLabel: 'Raffles',
                      icon: Ticket,
                    },
                    {
                      title: 'Most tickets purchased',
                      entries: leaderboardData.ticketsPurchased ?? [],
                      valueLabel: 'Tickets',
                      icon: ShoppingCart,
                    },
                    {
                      title: 'Most raffles created',
                      entries: leaderboardData.rafflesCreated,
                      valueLabel: 'Raffles',
                      icon: PlusCircle,
                    },
                    {
                      title: 'Most raffles won',
                      entries: leaderboardData.rafflesWon,
                      valueLabel: 'Wins',
                      icon: Crown,
                    },
                    {
                      title: 'Most tickets sold',
                      entries: leaderboardData.ticketsSold,
                      valueLabel: 'Tickets',
                      icon: Trophy,
                    },
                  ].map(({ title, entries, valueLabel, icon: Icon }) => (
                    <Card key={title} className="border-green-500/20 bg-black/40">
                      <CardHeader className="py-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Icon className="h-4 w-4 text-green-500 shrink-0" />
                          {title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {entries.length === 0 ? (
                          <p className="text-muted-foreground text-sm py-2">No data yet.</p>
                        ) : (
                          <table className="w-full text-sm table-fixed">
                            <colgroup>
                              <col className="w-[12%]" />
                              <col className="w-[64%]" />
                              <col className="w-[24%]" />
                            </colgroup>
                            <thead>
                              <tr className="border-b border-green-500/20">
                                <th className="text-left py-2 sm:py-1.5 font-medium">#</th>
                                <th className="text-left py-2 sm:py-1.5 font-medium">Name</th>
                                <th className="text-right py-2 sm:py-1.5 font-medium">{valueLabel}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entries.map((e) => (
                                <tr key={`${e.wallet}-${e.rank}`} className="border-b border-border/50">
                                  <td className="py-2.5 sm:py-1.5 align-middle">
                                    {e.rank <= 3 ? (
                                      <Medal
                                        className={`h-4 w-4 inline ${
                                          e.rank === 1 ? 'text-amber-400' : e.rank === 2 ? 'text-slate-300' : 'text-amber-700'
                                        }`}
                                        aria-label={`Rank ${e.rank}`}
                                      />
                                    ) : (
                                      <span className="text-muted-foreground">{e.rank}</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 sm:py-1.5 text-xs sm:text-sm align-middle truncate" title={e.wallet}>
                                    {leaderboardDisplayNames[e.wallet] ? (
                                      <span className="font-medium">{leaderboardDisplayNames[e.wallet]}</span>
                                    ) : (
                                      <span className="font-mono">
                                        {e.wallet.length <= 12 ? e.wallet : `${e.wallet.slice(0, 6)}…${e.wallet.slice(-4)}`}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 sm:py-1.5 text-right font-medium align-middle">{e.value.toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">Could not load leaderboard.{' '}
                  <Link href="/leaderboard" className="text-green-500 hover:underline touch-manipulation inline-flex items-center min-h-[44px]">
                    Open leaderboard page
                  </Link>
                </p>
              )}
            </div>
          ) : tab === 'my-entries' ? (
            <div className="mb-8 sm:mb-12 w-full min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Raffles you entered</h2>
              {connected && wallet ? (
                <MyEntriesList walletAddress={wallet} />
              ) : (
                <div className="rounded-lg border border-border bg-card/50 p-8 text-center text-muted-foreground">
                  <p className="text-lg">Connect your wallet to see raffles you’ve entered.</p>
                  <p className="mt-2 text-sm">Only you can see your own entries.</p>
                </div>
              )}
            </div>
          ) : (
            <>
          <div className="mb-8 sm:mb-12 w-full min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Active Raffles</h2>
            {active.length > 0 ? (
              <RafflesList
                rafflesWithEntries={active}
                title={undefined}
                section="active"
                serverNow={serverTime}
                onTopProfitableChange={setTopProfitableActive}
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
                serverNow={serverTime}
              />
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No upcoming raffles scheduled at this time</p>
              </div>
            )}
          </div>

          <div className="mb-8 sm:mb-12">
            <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Pending / Paused Raffles</h2>
            <p className="text-sm text-muted-foreground mb-4">
              NFT prizes must be deposited to platform escrow and verified before the raffle can go live.
            </p>
            {pausedPending.length > 0 ? (
              <RafflesList
                rafflesWithEntries={pausedPending}
                title={undefined}
                section="future"
                serverNow={serverTime}
              />
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No pending or paused raffles right now.</p>
              </div>
            )}
          </div>

          {past.length > 0 && (
            <div className="mb-8 sm:mb-12 w-full min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Past Raffles</h2>
              {past.length > 3 ? (
                <PastRafflesCarousel items={past} />
              ) : (
                <RafflesList
                  rafflesWithEntries={past}
                  title={undefined}
                  section="past"
                  serverNow={serverTime}
                />
              )}
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
                    className="rounded-md bg-primary px-4 py-3 sm:py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 touch-manipulation min-h-[44px]"
                  >
                    Refresh
                  </button>
                </>
              )}
            </div>
          )}
            </>
          )}
        </>
      )}
    </div>
  )
}

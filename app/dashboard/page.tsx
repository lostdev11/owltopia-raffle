'use client'

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  LayoutDashboard,
  Ticket,
  Coins,
  TrendingUp,
  ExternalLink,
  Loader2,
  User,
  XCircle,
  Check,
  Gift,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  MessageCircle,
  Share2,
  Wallet,
  Award,
  Landmark,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { isMobileDevice } from '@/lib/utils'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { useConnection } from '@solana/wallet-adapter-react'
import { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { getCancellationFeeSol } from '@/lib/config/raffles'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'
import { raffleRequiresCancellationFee } from '@/lib/raffles/cancellation-fee-policy'
import { raffleUsesFundsEscrow } from '@/lib/raffles/ticket-escrow-policy'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'
import type { CommunityGiveaway, NftGiveaway, Raffle as FullRaffle } from '@/lib/types'
import {
  getEmptyEngagementPayload,
  type DashboardEngagementPayload,
} from '@/lib/xp/engagement-payload'

type FeeTier = { feeBps: number; reason: string }
type Raffle = {
  id: string
  slug: string
  title: string
  status: string | null
  start_time?: string
  created_by?: string | null
  creator_wallet?: string | null
  creator_payout_amount: number | null
  platform_fee_amount?: number | null
  currency: string
  prize_currency?: string | null
  prize_amount?: number | null
  end_time: string
  prize_type?: string | null
  nft_mint_address?: string | null
  nft_transfer_transaction?: string | null
  prize_deposited_at?: string | null
  prize_returned_at?: string | null
  prize_return_tx?: string | null
  winner_wallet?: string | null
  winner_selected_at?: string | null
  cancellation_requested_at?: string | null
  cancellation_fee_paid_at?: string | null
  ticket_payments_to_funds_escrow?: boolean | null
  creator_claimed_at?: string | null
  creator_claim_tx?: string | null
  settled_at?: string | null
  fee_bps_applied?: number | null
}
type EntryWithRaffle = {
  entry: {
    id: string
    ticket_quantity: number
    amount_paid: number
    currency: string
    status: string
    created_at: string
    refunded_at?: string | null
    referrer_wallet?: string | null
    referral_code_used?: string | null
  }
  raffle: {
    id: string
    slug: string
    title: string
    end_time: string
    status: string | null
    winner_wallet: string | null
    winner_selected_at?: string | null
    ticket_payments_to_funds_escrow?: boolean | null
    prize_type?: string | null
    prize_amount?: number | null
    prize_currency?: string | null
    nft_mint_address?: string | null
    nft_transfer_transaction?: string | null
    prize_deposited_at?: string | null
    prize_returned_at?: string | null
    prize_standard?: string | null
  }
  referred_by_label?: string | null
}

function raffleEndedOrCompleted(raffle: { end_time: string; status: string | null }): boolean {
  if (raffle.status === 'completed') return true
  const endMs = new Date(raffle.end_time).getTime()
  return !Number.isNaN(endMs) && endMs <= Date.now()
}

/** Matches server rules in POST /api/raffles/[id]/claim-prize */
function needsPayCancellationBeforeClaim(raffle: Raffle): boolean {
  if (raffle.status !== 'cancelled') return false
  if (!raffle.start_time) return false
  if (!raffleRequiresCancellationFee(raffle as unknown as FullRaffle, new Date())) return false
  return !raffle.cancellation_fee_paid_at
}

/** Live / ready listing: cancellation was requested but post-start fee not recorded yet. */
function needsPayCancellationStraggler(raffle: Raffle): boolean {
  const s = (raffle.status ?? '').toLowerCase()
  if (s !== 'live' && s !== 'ready_to_draw') return false
  if (!raffle.cancellation_requested_at) return false
  if (!raffle.start_time) return false
  if (!raffleRequiresCancellationFee(raffle as unknown as FullRaffle, new Date())) return false
  return !raffle.cancellation_fee_paid_at
}

function canClaimEscrowPrize(raffle: EntryWithRaffle['raffle'], wallet: string): boolean {
  const w = wallet.trim()
  if (!w || !raffle.winner_wallet?.trim() || raffle.winner_wallet.trim() !== w) return false
  const partnerSpl = isPartnerSplPrizeRaffle(
    raffle as Pick<FullRaffle, 'prize_type' | 'prize_currency'>
  )
  const nftPrize = raffle.prize_type === 'nft' && !!raffle.nft_mint_address?.trim()
  if (!partnerSpl && !nftPrize) return false
  if (!raffle.prize_deposited_at) return false
  if (raffle.prize_returned_at) return false
  if (raffle.nft_transfer_transaction?.trim()) return false
  if (!raffleEndedOrCompleted(raffle)) return false
  return true
}

/** Creator can pull prize back from escrow after min-threshold failure or cancellation (matches claim-failed-min-prize-return API). */
function canCreatorClaimFailedMinThresholdPrize(raffle: Raffle, wallet: string): boolean {
  const w = wallet.trim()
  if (!w) return false
  const creator = (raffle.creator_wallet || raffle.created_by || '').trim()
  if (!creator || !walletsEqualSolana(creator, w)) return false
  if (raffle.status !== 'failed_refund_available' && raffle.status !== 'cancelled') return false
  if (raffle.winner_wallet?.trim() || (raffle.winner_selected_at && String(raffle.winner_selected_at).trim())) {
    return false
  }
  if (!raffle.prize_deposited_at) return false
  if (raffle.prize_returned_at) return false
  if (raffle.nft_transfer_transaction?.trim()) return false
  if (isPartnerSplPrizeRaffle(raffle as Pick<FullRaffle, 'prize_type' | 'prize_currency'>)) return true
  return raffle.prize_type === 'nft' && !!raffle.nft_mint_address?.trim()
}

function solscanTxUrl(signature: string): string {
  const dev = /devnet/i.test(resolvePublicSolanaRpcUrl())
  return `https://solscan.io/tx/${encodeURIComponent(signature)}${dev ? '?cluster=devnet' : ''}`
}

function solscanTokenUrl(mint: string): string {
  const dev = /devnet/i.test(resolvePublicSolanaRpcUrl())
  return `https://solscan.io/token/${encodeURIComponent(mint)}${dev ? '?cluster=devnet' : ''}`
}

function formatMintForDisplay(mint: string | null | undefined): string {
  const m = typeof mint === 'string' ? mint.trim() : ''
  if (!m) return '—'
  if (m.length > 12) return `${m.slice(0, 6)}…${m.slice(-6)}`
  return m
}

/** Readable status for creator list (DB uses snake_case; some states need clearer wording). */
function myRaffleStatusLabel(status: string | null): string {
  const s = status ?? 'draft'
  if (s === 'successful_pending_claims') return 'Settled — claim proceeds'
  return s.replace(/_/g, ' ')
}

type DashboardData = {
  wallet: string
  displayName: string | null
  myRaffles: Raffle[]
  myEntries: EntryWithRaffle[]
  creatorRevenue: number
  creatorRevenueByCurrency: Record<string, number>
  creatorLiveEarningsByCurrency?: Record<string, number>
  creatorAllTimeGrossByCurrency?: Record<string, number>
  claimTrackerLiveFundsEscrowSales?: {
    netByCurrency: Record<string, number>
    feeByCurrency: Record<string, number>
    grossByCurrency: Record<string, number>
    trackedRaffleIds?: string[]
  }
  creatorRefundRaffles?: Array<{
    raffleId: string
    raffleSlug: string
    raffleTitle: string
    currency: string
    totalPending: number
    /** False = legacy host payout; true = platform funds escrow (buyers claim). */
    ticketPaymentsToFundsEscrow?: boolean
    candidates: Array<{
      wallet: string
      totalAmount: number
      refundedAmount: number
      pendingAmount: number
      confirmedEntries: number
      refundedEntries: number
    }>
  }>
  offerRefundCandidates?: Array<{
    offerId: string
    raffleId: string
    raffleSlug: string
    raffleTitle: string
    amount: number
    currency: string
    status: 'declined' | 'cancelled' | 'expired'
    createdAt: string
    expiresAt: string
    fundedAt: string
  }>
  feeTier: FeeTier
  nftGiveaways?: NftGiveaway[]
  communityGiveaways?: CommunityGiveaway[]
  discord?: { linked: boolean; username: string | null }
  referral?: {
    activeCode: string
    codeKind: 'random' | 'vanity'
    canSetVanity: boolean
  } | null
  engagement?: DashboardEngagementPayload
  /** Buyout bids placed by this wallet (claim refunds here when expired/superseded). */
  buyoutOffers?: Array<{
    id: string
    raffle_id: string
    raffle_slug: string
    raffle_title: string
    currency: string
    amount: number
    status: string
    deposit_tx_signature: string | null
    refunded_at: string | null
  }>
}

type NftWinnerDashboardRow = {
  raffle: EntryWithRaffle['raffle']
  prizeState: 'claimable' | 'claimed' | 'waiting' | 'returned'
  claimedTx: string | null
}

// On mobile, wait for wallet to stabilize after nav (e.g. redirect return) before calling dashboard API.
const MOBILE_WALLET_STABILIZE_MS = 450
// On mobile, retry once after 401 (session not ready yet after wallet connect).
const MOBILE_401_RETRY_DELAY_MS = 800

const MY_ENTRIES_PAGE_SIZE = 20
/** Background refresh for claim tracker + dashboard numbers while tab is open */
const CLAIM_TRACKER_POLL_MS = 30_000

function formatRelativeUpdated(updatedAt: number): string {
  const s = Math.floor((Date.now() - updatedAt) / 1000)
  if (s < 8) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

function aggregateClaimTotalsByCurrency(
  raffles: Raffle[],
  field: 'creator_payout_amount' | 'platform_fee_amount'
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of raffles) {
    const cur = (r.currency || 'SOL').toUpperCase()
    const raw = field === 'creator_payout_amount' ? r.creator_payout_amount : r.platform_fee_amount
    const v = Number(raw ?? 0)
    if (!Number.isFinite(v) || v <= 0) continue
    out[cur] = (out[cur] ?? 0) + v
  }
  return out
}

function formatMultiCurrencyTotals(by: Record<string, number>): string {
  const keys = Object.keys(by)
  if (keys.length === 0) return '—'
  return keys
    .map((cur) => `${by[cur]!.toFixed(cur === 'USDC' ? 2 : 4)} ${cur}`)
    .join(' · ')
}

function discordOAuthReturnMessage(code: string): string {
  switch (code) {
    case 'sign_in_required':
      return 'Your site session expired or was reset. Connect your wallet, use Sign in, then try Connect Discord again.'
    case 'access_denied':
      return 'Discord connection was cancelled.'
    case 'discord_taken':
      return 'That Discord account is already linked to a different wallet.'
    case 'invalid_state':
      return 'Link expired. Use Connect Discord and try again.'
    case 'missing_params':
      return 'Discord sign-in did not finish. Try again.'
    case 'token':
    case 'profile':
      return 'Could not read your Discord account. Try again later.'
    case 'link_failed':
      return 'Could not save your Discord link. Try again.'
    case 'not_configured':
      return 'Discord linking is not enabled on this deployment yet.'
    default:
      return `Discord connection failed (${code}).`
  }
}

type RaffleEntrySummary = {
  raffle: EntryWithRaffle['raffle']
  totalTickets: number
  referredByLabels: string[]
}

type DashboardTabId = 'overview' | 'hosting' | 'winnings' | 'account'

function parseDashboardTabParam(value: string | null): DashboardTabId | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (
    raw === 'overview' ||
    raw === 'hosting' ||
    raw === 'winnings' ||
    raw === 'account'
  ) {
    return raw
  }
  return null
}

export default function DashboardPage() {
  const { publicKey, connected, signMessage } = useWallet()
  const { connection } = useConnection()
  const sendTransaction = useSendTransactionForWallet()
  const { setVisible } = useWalletModal()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [entriesFilter, setEntriesFilter] = useState<'all' | 'won'>('all')
  const [entriesPage, setEntriesPage] = useState(0)
  const [openRaffleId, setOpenRaffleId] = useState<string | null>(null)
  const [displayNameInput, setDisplayNameInput] = useState('')
  const [displayNameSaving, setDisplayNameSaving] = useState(false)
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [displayNameSaved, setDisplayNameSaved] = useState(false)
  const [escrowLinkLoadingId, setEscrowLinkLoadingId] = useState<string | null>(null)
  const [claimProceedsLoadingId, setClaimProceedsLoadingId] = useState<string | null>(null)
  const [claimPrizeLoadingId, setClaimPrizeLoadingId] = useState<string | null>(null)
  const [claimFailedMinPrizeReturnLoadingId, setClaimFailedMinPrizeReturnLoadingId] = useState<string | null>(null)
  const [payCancelFeeLoadingId, setPayCancelFeeLoadingId] = useState<string | null>(null)
  const [claimGiveawayLoadingId, setClaimGiveawayLoadingId] = useState<string | null>(null)
  const [claimCommunityGiveawayLoadingId, setClaimCommunityGiveawayLoadingId] = useState<string | null>(
    null
  )
  const [claimRefundLoadingEntryId, setClaimRefundLoadingEntryId] = useState<string | null>(null)
  const [claimOfferRefundLoadingId, setClaimOfferRefundLoadingId] = useState<string | null>(null)
  const [buyoutRefundLoadingId, setBuyoutRefundLoadingId] = useState<string | null>(null)
  const [claimActionError, setClaimActionError] = useState<string | null>(null)
  const [claimPrizeSuccessTx, setClaimPrizeSuccessTx] = useState<string | null>(null)
  const [walletReady, setWalletReady] = useState(false)
  const [claimTrackerRefreshing, setClaimTrackerRefreshing] = useState(false)
  const [dashboardUpdatedAt, setDashboardUpdatedAt] = useState<number | null>(null)
  const [relativeTimeTick, setRelativeTimeTick] = useState(0)
  const [discordLinkFlash, setDiscordLinkFlash] = useState<string | null>(null)
  const [discordUnlinking, setDiscordUnlinking] = useState(false)
  const [referralVanityInput, setReferralVanityInput] = useState('')
  const [referralVanitySaving, setReferralVanitySaving] = useState(false)
  const [referralVanityError, setReferralVanityError] = useState<string | null>(null)
  const [referralVanitySaved, setReferralVanitySaved] = useState(false)
  const [dashboardTab, setDashboardTab] = useState<DashboardTabId>('overview')
  const [liveActivityMuted, setLiveActivityMuted] = useState(false)
  const hasRetried401OnMobile = useRef(false)
  const dashboardHydratedRef = useRef(false)
  const hasDashboardDataRef = useRef(false)
  const visibilityTick = useVisibilityTick()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const applyDashboardTabToUrl = useCallback(
    (tab: DashboardTabId) => {
      const params = new URLSearchParams(searchParams.toString())
      if (tab === 'overview') {
        params.delete('tab')
      } else {
        params.set('tab', tab)
      }
      const q = params.toString()
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const setDashboardTabFromUi = useCallback(
    (tab: DashboardTabId) => {
      setDashboardTab(tab)
      applyDashboardTabToUrl(tab)
    },
    [applyDashboardTabToUrl],
  )

  useLayoutEffect(() => {
    const next = parseDashboardTabParam(searchParams.get('tab'))
    if (next) setDashboardTab(next)
  }, [searchParams])

  useEffect(() => {
    if (!claimPrizeSuccessTx) return
    const t = window.setTimeout(() => setClaimPrizeSuccessTx(null), 9000)
    return () => window.clearTimeout(t)
  }, [claimPrizeSuccessTx])

  // Use wallet address string in deps so callback identity is stable (publicKey object ref can change every render and cause infinite loop).
  const walletAddr = publicKey?.toBase58() ?? ''

  const loadDashboard = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!connected || !publicKey) {
      setData(null)
      setLoading(false)
      setNeedsSignIn(false)
      setError(null)
      setClaimTrackerRefreshing(false)
      return
    }
    if (silent) {
      setClaimTrackerRefreshing(true)
    } else {
      setLoading(true)
      setError(null)
      setNeedsSignIn(false)
    }
    const addr = publicKey.toBase58()
    let skipLoadingFalse = false
    try {
      const res = await fetch('/api/me/dashboard', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'X-Connected-Wallet': addr },
      })
      if (res.status === 401) {
        if (typeof window !== 'undefined' && isMobileDevice() && !hasRetried401OnMobile.current && !silent) {
          hasRetried401OnMobile.current = true
          skipLoadingFalse = true
          setTimeout(() => loadDashboard(), MOBILE_401_RETRY_DELAY_MS)
          return
        }
        setNeedsSignIn(true)
        setData(null)
        return
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (!silent) {
          const msg = typeof json?.error === 'string' ? json.error : 'Failed to load dashboard'
          setError(msg)
        }
        return
      }
      if (json.wallet && json.wallet !== addr) {
        setNeedsSignIn(true)
        setData(null)
        return
      }
      setData(json)
      setDashboardUpdatedAt(Date.now())
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    } finally {
      if (silent) {
        setClaimTrackerRefreshing(false)
      }
      if (!skipLoadingFalse && !silent) {
        setLoading(false)
      }
    }
  }, [connected, walletAddr])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const linked = sp.get('discord_linked')
    const err = sp.get('discord_error')
    if (!linked && !err) return

    if (linked === '1') {
      setDiscordLinkFlash(
        'Discord connected. If you win a raffle, the server webhook can mention you when you are in that Discord server.'
      )
    } else if (err) {
      setDiscordLinkFlash(discordOAuthReturnMessage(err))
    }
    window.history.replaceState({}, '', '/dashboard')
    void loadDashboard({ silent: true })
  }, [loadDashboard])

  // Reset 401 retry flag when wallet changes so a new connection gets one retry on mobile.
  useEffect(() => {
    hasRetried401OnMobile.current = false
  }, [walletAddr, connected])

  useEffect(() => {
    dashboardHydratedRef.current = false
  }, [walletAddr])

  useEffect(() => {
    hasDashboardDataRef.current = data != null
    if (data) {
      dashboardHydratedRef.current = true
    }
  }, [data])

  useEffect(() => {
    if (!data) return
    const id = setInterval(() => setRelativeTimeTick((t) => t + 1), 15_000)
    return () => clearInterval(id)
  }, [data])

  // On mobile, delay first dashboard load so wallet has time to stabilize after nav/redirect.
  // If already connected on mount (e.g. returning from wallet), don't delay so connection feels instant.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isMobileDevice()) {
      setWalletReady(true)
      return
    }
    if (connected && publicKey) {
      setWalletReady(true)
      return
    }
    const t = setTimeout(() => setWalletReady(true), MOBILE_WALLET_STABILIZE_MS)
    return () => clearTimeout(t)
  }, [connected, publicKey])

  // Load dashboard when wallet is ready; on tab focus refresh silently if we already have data (no full-page spinner).
  useEffect(() => {
    if (!walletReady && isMobileDevice()) return
    if (visibilityTick > 0 && dashboardHydratedRef.current) {
      void loadDashboard({ silent: true })
      return
    }
    void loadDashboard()
  }, [loadDashboard, walletReady, visibilityTick])

  // Live poll while signed in so claim amounts and live sales update without refreshing the page.
  useEffect(() => {
    if (!connected || !publicKey || needsSignIn) return
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      if (!hasDashboardDataRef.current) return
      void loadDashboard({ silent: true })
    }, CLAIM_TRACKER_POLL_MS)
    return () => clearInterval(id)
  }, [connected, walletAddr, needsSignIn, loadDashboard])

  // Sync display name input when dashboard data loads (must be unconditional for Rules of Hooks)
  useEffect(() => {
    if (data != null) {
      setDisplayNameInput(data.displayName ?? '')
    }
  }, [data?.displayName, data])

  // Keep wallet settings in sync with global live activity popup preference.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      setLiveActivityMuted(window.localStorage.getItem('owl:live-activity-muted') === '1')
    } catch {
      setLiveActivityMuted(false)
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'owl:live-activity-muted') return
      setLiveActivityMuted(event.newValue === '1')
    }
    const onLiveActivityChange = () => {
      try {
        setLiveActivityMuted(window.localStorage.getItem('owl:live-activity-muted') === '1')
      } catch {
        setLiveActivityMuted(false)
      }
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('owl:live-activity-muted-change', onLiveActivityChange)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('owl:live-activity-muted-change', onLiveActivityChange)
    }
  }, [])

  useEffect(() => {
    const r = data?.referral
    if (r && r.codeKind === 'vanity') {
      setReferralVanityInput(r.activeCode)
    } else {
      setReferralVanityInput('')
    }
  }, [data?.referral?.activeCode, data?.referral?.codeKind])

  const handleSignIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setSignInError('Your wallet does not support message signing.')
      return
    }
    setSignInError(null)
    setSigningIn(true)
    try {
      const walletAddr = publicKey.toBase58()
      const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
        credentials: 'include',
      })
      if (!nonceRes.ok) {
        const data = await nonceRes.json().catch(() => ({}))
        throw new Error((data as { error?: string })?.error || 'Failed to get sign-in nonce')
      }
      const { message } = (await nonceRes.json()) as { message: string }
      const messageBytes = new TextEncoder().encode(message)
      const signature = await signMessage(messageBytes)
      const signatureBase64 =
        typeof signature === 'string'
          ? btoa(signature)
          : btoa(String.fromCharCode(...new Uint8Array(signature)))

      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: walletAddr,
          message,
          signature: signatureBase64,
        }),
      })

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error((data as { error?: string })?.error || 'Sign-in verification failed')
      }

      await loadDashboard()
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }, [publicKey, signMessage, loadDashboard])

  const openEscrowCheck = useCallback(async (raffleId: string) => {
    setEscrowLinkLoadingId(raffleId)
    try {
      const res = await fetch(`/api/raffles/${raffleId}/escrow-check-url`, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && typeof (data as { url?: string }).url === 'string') {
        window.open((data as { url: string }).url, '_blank', 'noopener,noreferrer')
      } else {
        const msg = typeof (data as { error?: string }).error === 'string' ? (data as { error: string }).error : 'Could not open Solscan link.'
        alert(msg)
      }
    } finally {
      setEscrowLinkLoadingId(null)
    }
  }, [])

  const handleClaimProceeds = useCallback(
    async (raffleId: string) => {
      setClaimActionError(null)
      setClaimProceedsLoadingId(raffleId)
      try {
        const res = await fetch(`/api/raffles/${raffleId}/claim-proceeds`, {
          method: 'POST',
          credentials: 'include',
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not claim proceeds'
          )
          return
        }
        await loadDashboard({ silent: true })
      } finally {
        setClaimProceedsLoadingId(null)
      }
    },
    [loadDashboard]
  )

  const handleClaimPrize = useCallback(
    async (raffleId: string) => {
      setClaimActionError(null)
      setClaimPrizeSuccessTx(null)
      setClaimPrizeLoadingId(raffleId)
      try {
        const res = await fetch(`/api/raffles/${raffleId}/claim-prize`, {
          method: 'POST',
          credentials: 'include',
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not claim prize'
          )
          return
        }
        const txSig =
          typeof (json as { transactionSignature?: string }).transactionSignature === 'string'
            ? (json as { transactionSignature: string }).transactionSignature.trim()
            : ''
        if (txSig) {
          setClaimPrizeSuccessTx(txSig)
        }
        await loadDashboard({ silent: true })
      } finally {
        setClaimPrizeLoadingId(null)
      }
    },
    [loadDashboard]
  )

  const handleClaimFailedMinPrizeReturn = useCallback(
    async (raffleId: string) => {
      setClaimActionError(null)
      setClaimFailedMinPrizeReturnLoadingId(raffleId)
      try {
        const res = await fetch(`/api/raffles/${raffleId}/claim-failed-min-prize-return`, {
          method: 'POST',
          credentials: 'include',
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not return prize from escrow'
          )
          return
        }
        await loadDashboard({ silent: true })
      } finally {
        setClaimFailedMinPrizeReturnLoadingId(null)
      }
    },
    [loadDashboard]
  )

  const handlePayCancellationFee = useCallback(
    async (r: Raffle) => {
      if (!publicKey) {
        setClaimActionError('Connect your wallet to pay the cancellation fee.')
        return
      }
      setClaimActionError(null)
      setPayCancelFeeLoadingId(r.id)
      try {
        const treasury = getRaffleTreasuryWalletAddress()
        if (!treasury) {
          setClaimActionError('Treasury wallet is not configured (RAFFLE_RECIPIENT_WALLET).')
          return
        }
        const feeSol = getCancellationFeeSol()
        const lamports = Math.round(feeSol * LAMPORTS_PER_SOL)
        const latestBlockhash = await connection.getLatestBlockhash('confirmed')
        const tx = new Transaction()
        tx.recentBlockhash = latestBlockhash.blockhash
        tx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight
        tx.feePayer = publicKey
        tx.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(treasury),
            lamports,
          })
        )
        const sig = await sendTransaction(tx, connection, { maxRetries: 3 })
        await connection.confirmTransaction(
          {
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            signature: sig,
          },
          'confirmed'
        )
        const path =
          r.status === 'cancelled'
            ? `/api/raffles/${r.id}/pay-cancellation-fee`
            : `/api/raffles/${r.id}/request-cancellation`
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ feeTransactionSignature: sig }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not record cancellation fee'
          )
          return
        }
        await loadDashboard({ silent: true })
      } catch (e) {
        setClaimActionError(e instanceof Error ? e.message : 'Payment failed')
      } finally {
        setPayCancelFeeLoadingId(null)
      }
    },
    [connection, publicKey, sendTransaction, loadDashboard]
  )

  const handleClaimGiveaway = useCallback(
    async (giveawayId: string) => {
      if (!publicKey) return
      setClaimActionError(null)
      setClaimGiveawayLoadingId(giveawayId)
      try {
        const addr = publicKey.toBase58()
        const res = await fetch(`/api/me/nft-giveaways/${giveawayId}/claim`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Connected-Wallet': addr },
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not claim giveaway'
          )
          return
        }
        await loadDashboard({ silent: true })
      } finally {
        setClaimGiveawayLoadingId(null)
      }
    },
    [loadDashboard, publicKey]
  )

  const handleClaimCommunityGiveaway = useCallback(
    async (giveawayId: string) => {
      if (!publicKey) return
      setClaimActionError(null)
      setClaimCommunityGiveawayLoadingId(giveawayId)
      try {
        const addr = publicKey.toBase58()
        const res = await fetch(`/api/me/community-giveaways/${giveawayId}/claim`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Connected-Wallet': addr },
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not claim community giveaway'
          )
          return
        }
        await loadDashboard({ silent: true })
      } finally {
        setClaimCommunityGiveawayLoadingId(null)
      }
    },
    [loadDashboard, publicKey]
  )

  const handleClaimRefund = useCallback(
    async (entryId: string) => {
      setClaimActionError(null)
      setClaimRefundLoadingEntryId(entryId)
      try {
        const res = await fetch('/api/entries/claim-refund', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ entryId }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not claim refund'
          )
          return
        }
        await loadDashboard({ silent: true })
      } finally {
        setClaimRefundLoadingEntryId(null)
      }
    },
    [loadDashboard]
  )

  const handleClaimOfferRefund = useCallback(
    async (offerId: string) => {
      setClaimActionError(null)
      setClaimOfferRefundLoadingId(offerId)
      try {
        const res = await fetch(`/api/me/raffle-offers/${offerId}/claim-refund`, {
          method: 'POST',
          credentials: 'include',
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not claim offer refund'
          )
          return
        }
        await loadDashboard({ silent: true })
      } finally {
        setClaimOfferRefundLoadingId(null)
      }
    },
    [loadDashboard]
  )

  const handleToggleLiveActivityMuted = useCallback(() => {
    setLiveActivityMuted((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem('owl:live-activity-muted', next ? '1' : '0')
          window.dispatchEvent(new Event('owl:live-activity-muted-change'))
        } catch {
          /* private mode / storage disabled — in-memory toggle only */
        }
      }
      return next
    })
  }, [])

  const myRafflesForMemo = Array.isArray(data?.myRaffles) ? data.myRaffles : []
  const myEntriesForMemo = Array.isArray(data?.myEntries) ? data.myEntries : []
  const walletForMemo = typeof data?.wallet === 'string' ? data.wallet : ''

  const pendingCreatorFundClaims = useMemo(
    () =>
      myRafflesForMemo.filter(
        (r) =>
          r.status === 'successful_pending_claims' &&
          raffleUsesFundsEscrow(r) &&
          !r.creator_claimed_at &&
          !!r.settled_at?.trim()
      ),
    [myRafflesForMemo]
  )

  const awaitingSettlementEscrowClaims = useMemo(
    () =>
      myRafflesForMemo.filter(
        (r) =>
          r.status === 'successful_pending_claims' &&
          raffleUsesFundsEscrow(r) &&
          !r.creator_claimed_at &&
          !r.settled_at?.trim()
      ),
    [myRafflesForMemo]
  )

  const liveEscrowRaffles = useMemo(() => {
    const tracked = data?.claimTrackerLiveFundsEscrowSales?.trackedRaffleIds
    const trackedSet = Array.isArray(tracked) ? new Set(tracked) : null
    return myRafflesForMemo.filter((r) => {
      if (r.status !== 'live' && r.status !== 'ready_to_draw') return false
      if (trackedSet) return trackedSet.has(r.id)
      return raffleUsesFundsEscrow(r)
    })
  }, [myRafflesForMemo, data?.claimTrackerLiveFundsEscrowSales?.trackedRaffleIds])

  const creatorFailedMinPrizeReturnClaimable = useMemo(
    () => myRafflesForMemo.filter((r) => canCreatorClaimFailedMinThresholdPrize(r, walletForMemo)),
    [myRafflesForMemo, walletForMemo]
  )

  /** End time passed, still live/ready_to_draw, no winner — claim button cannot appear until draw runs. */
  const creatorRafflesEndedAwaitingDraw = useMemo(() => {
    const nowMs = Date.now()
    return myRafflesForMemo.filter((r) => {
      if (!raffleUsesFundsEscrow(r)) return false
      if (r.status !== 'live' && r.status !== 'ready_to_draw') return false
      const endMs = new Date(r.end_time).getTime()
      if (Number.isNaN(endMs) || endMs > nowMs) return false
      if (r.winner_wallet?.trim() || r.winner_selected_at) return false
      if (r.prize_type === 'nft' && !r.prize_deposited_at) return false
      return true
    })
  }, [myRafflesForMemo])

  const claimTrackerLiveSales = useMemo(() => {
    const s = data?.claimTrackerLiveFundsEscrowSales
    if (!s || typeof s !== 'object') {
      return { net: {}, fee: {}, gross: {} } as const
    }
    const asRec = (x: unknown) =>
      x && typeof x === 'object' ? (x as Record<string, number>) : {}
    return {
      net: asRec(s.netByCurrency),
      fee: asRec(s.feeByCurrency),
      gross: asRec(s.grossByCurrency),
    }
  }, [data?.claimTrackerLiveFundsEscrowSales])

  const claimTrackerHasLiveEscrowSales = useMemo(() => {
    const hasPositive = (o: Record<string, number>) =>
      Object.values(o).some((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
    return (
      hasPositive(claimTrackerLiveSales.net) ||
      hasPositive(claimTrackerLiveSales.fee) ||
      hasPositive(claimTrackerLiveSales.gross)
    )
  }, [claimTrackerLiveSales])

  const claimTrackerReadyNetByCurrency = useMemo(
    () => aggregateClaimTotalsByCurrency(pendingCreatorFundClaims, 'creator_payout_amount'),
    [pendingCreatorFundClaims]
  )
  const claimTrackerReadyFeeByCurrency = useMemo(
    () => aggregateClaimTotalsByCurrency(pendingCreatorFundClaims, 'platform_fee_amount'),
    [pendingCreatorFundClaims]
  )

  const claimTrackerReadyGrossByCurrency = useMemo(() => {
    const keys = new Set([
      ...Object.keys(claimTrackerReadyNetByCurrency),
      ...Object.keys(claimTrackerReadyFeeByCurrency),
    ])
    const out: Record<string, number> = {}
    for (const k of keys) {
      const t =
        (claimTrackerReadyNetByCurrency[k] ?? 0) + (claimTrackerReadyFeeByCurrency[k] ?? 0)
      if (t > 0) out[k] = t
    }
    return out
  }, [claimTrackerReadyNetByCurrency, claimTrackerReadyFeeByCurrency])

  const nftPrizeDashboardRows = useMemo(() => {
    const byId = new Map<string, NftWinnerDashboardRow>()
    for (const { raffle } of myEntriesForMemo) {
      const w = walletForMemo.trim()
      if (!raffle.winner_wallet?.trim() || raffle.winner_wallet.trim() !== w) continue
      if (raffle.prize_type !== 'nft' || !raffle.nft_mint_address?.trim()) continue
      const tx = raffle.nft_transfer_transaction?.trim() || null
      let prizeState: NftWinnerDashboardRow['prizeState']
      if (raffle.prize_returned_at) prizeState = 'returned'
      else if (tx) prizeState = 'claimed'
      else if (canClaimEscrowPrize(raffle, walletForMemo)) prizeState = 'claimable'
      else prizeState = 'waiting'
      if (!byId.has(raffle.id)) {
        byId.set(raffle.id, { raffle, prizeState, claimedTx: tx })
      }
    }
    return Array.from(byId.values())
  }, [myEntriesForMemo, walletForMemo])

  const cryptoPrizeWinRows = useMemo(() => {
    const byId = new Map<string, EntryWithRaffle['raffle']>()
    for (const { raffle } of myEntriesForMemo) {
      const w = walletForMemo.trim()
      if (!raffle.winner_wallet?.trim() || raffle.winner_wallet.trim() !== w) continue
      if (raffle.prize_type === 'nft') continue
      if (!byId.has(raffle.id)) byId.set(raffle.id, raffle)
    }
    return Array.from(byId.values())
  }, [myEntriesForMemo, walletForMemo])

  const raffleSummaries = useMemo((): RaffleEntrySummary[] => {
    const sourceEntries =
      entriesFilter === 'won'
        ? myEntriesForMemo.filter(({ raffle }) => raffle.winner_wallet === walletForMemo)
        : myEntriesForMemo
    return Object.values(
      sourceEntries.reduce<Record<string, RaffleEntrySummary>>((acc, row) => {
        const { entry, raffle, referred_by_label } = row
        const key = raffle.id
        const qty = Number(entry.ticket_quantity) || 0
        const refLabel =
          entry.referrer_wallet?.trim() && referred_by_label?.trim()
            ? referred_by_label.trim()
            : null
        const existing = acc[key]
        if (existing) {
          existing.totalTickets += qty
          if (refLabel && !existing.referredByLabels.includes(refLabel)) {
            existing.referredByLabels.push(refLabel)
          }
        } else {
          acc[key] = { raffle, totalTickets: qty, referredByLabels: refLabel ? [refLabel] : [] }
        }
        return acc
      }, {})
    )
  }, [myEntriesForMemo, entriesFilter, walletForMemo])

  const entriesListMaxPage =
    raffleSummaries.length === 0
      ? 0
      : Math.ceil(raffleSummaries.length / MY_ENTRIES_PAGE_SIZE) - 1

  useEffect(() => {
    setEntriesPage(0)
  }, [entriesFilter])

  useEffect(() => {
    setEntriesPage((p) => Math.min(p, entriesListMaxPage))
  }, [entriesListMaxPage])

  if (!connected) {
    return (
      <main className="relative mx-auto max-w-2xl px-4 py-10 safe-area-bottom">
        <div
          className="pointer-events-none absolute inset-x-0 -top-24 h-64 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.15),transparent)]"
          aria-hidden
        />
        <div className="relative space-y-6 rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LayoutDashboard className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-2 text-muted-foreground">
              Connect your wallet to see raffles you host, tickets you bought, and earnings.
            </p>
          </div>
          <Button
            type="button"
            className="min-h-[44px] touch-manipulation bg-green-600 hover:bg-green-700 text-white"
            onClick={() => setVisible(true)}
          >
            Connect wallet
          </Button>
        </div>
      </main>
    )
  }

  // Connected but publicKey not ready yet (common on mobile after redirect). Show preparing state.
  if (!publicKey) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex flex-col items-center gap-3 text-center min-h-[120px] justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">
            Preparing your dashboard…
          </p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Wallet is connecting. If this takes more than a few seconds, try going home and opening Dashboard again.
          </p>
        </div>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading your dashboard…
        </div>
      </main>
    )
  }

  if (needsSignIn) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-4">My Dashboard</h1>
        <p className="text-muted-foreground mb-6">
          Sign in with your wallet to see your raffles, entries, and revenue. This is a one-time message signature (no transaction or fee).
        </p>
        {signInError && <p className="text-destructive mb-4">{signInError}</p>}
        <Button onClick={handleSignIn} disabled={signingIn || !signMessage}>
          {signingIn ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Signing in…
            </>
          ) : (
            'Sign in with wallet'
          )}
        </Button>
        {!signMessage && (
          <p className="text-sm text-muted-foreground mt-2">
            Your connected wallet does not support message signing. Try another wallet.
          </p>
        )}
      </main>
    )
  }

  if (error) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-4">My Dashboard</h1>
        <p className="text-destructive">{error}</p>
      </main>
    )
  }

  if (!data) {
    return null
  }

  // Defensive: avoid crashes if API returns unexpected shape (e.g. partial/cached response)
  const myRaffles = myRafflesForMemo
  const myEntries = myEntriesForMemo
  const creatorRevenue = typeof data.creatorRevenue === 'number' ? data.creatorRevenue : 0
  const creatorRevenueByCurrency =
    data.creatorRevenueByCurrency && typeof data.creatorRevenueByCurrency === 'object'
      ? data.creatorRevenueByCurrency
      : {}
  const creatorLiveEarningsByCurrency =
    data.creatorLiveEarningsByCurrency && typeof data.creatorLiveEarningsByCurrency === 'object'
      ? data.creatorLiveEarningsByCurrency
      : {}
  const creatorAllTimeGrossByCurrency =
    data.creatorAllTimeGrossByCurrency && typeof data.creatorAllTimeGrossByCurrency === 'object'
      ? data.creatorAllTimeGrossByCurrency
      : {}
  const feeTier =
    data.feeTier && typeof data.feeTier.feeBps === 'number' && typeof data.feeTier.reason === 'string'
      ? data.feeTier
      : { feeBps: 600, reason: 'standard' as const }
  const wallet = walletForMemo
  const displayName = data.displayName != null ? String(data.displayName) : null
  const discord =
    data.discord &&
    typeof data.discord === 'object' &&
    typeof (data.discord as { linked?: unknown }).linked === 'boolean'
      ? (data.discord as { linked: boolean; username: string | null })
      : { linked: false as const, username: null as string | null }
  const referralRow =
    data.referral &&
    typeof data.referral.activeCode === 'string' &&
    (data.referral.codeKind === 'random' || data.referral.codeKind === 'vanity')
      ? data.referral
      : null
  const engagement: DashboardEngagementPayload =
    data.engagement &&
    typeof data.engagement.totalXp === 'number' &&
    typeof data.engagement.level === 'number' &&
    typeof data.engagement.xpIntoLevel === 'number' &&
    ('xpToNext' in data.engagement) &&
    Array.isArray(data.engagement.milestones)
      ? data.engagement
      : getEmptyEngagementPayload()
  const creatorRefundRaffles = Array.isArray(data.creatorRefundRaffles) ? data.creatorRefundRaffles : []
  const offerRefundCandidates = Array.isArray(data.offerRefundCandidates) ? data.offerRefundCandidates : []
  const legacyCreatorRefundRaffles = creatorRefundRaffles.filter((rr) => rr.ticketPaymentsToFundsEscrow === false)
  const escrowCreatorRefundRaffles = creatorRefundRaffles.filter((rr) => rr.ticketPaymentsToFundsEscrow !== false)

  const buyoutOffersAll = Array.isArray(data.buyoutOffers) ? data.buyoutOffers : []
  const buyoutRefundEligible = buyoutOffersAll.filter(
    (o) =>
      (o.status === 'expired' || o.status === 'superseded') &&
      o.deposit_tx_signature &&
      !o.refunded_at,
  )

  const refundableEntries = myEntries.filter(
    (x) =>
      (x.raffle.status === 'failed_refund_available' || x.raffle.status === 'cancelled') &&
      x.entry.status === 'confirmed' &&
      !x.entry.refunded_at &&
      raffleUsesFundsEscrow(x.raffle)
  )

  /** Same terminal status but legacy row: migration 044 set funds-escrow off when entries already existed — no on-chain claim. */
  const legacyRefundEligibleEntries = myEntries.filter(
    (x) =>
      x.raffle.status === 'failed_refund_available' &&
      x.entry.status === 'confirmed' &&
      !x.entry.refunded_at &&
      !raffleUsesFundsEscrow(x.raffle)
  )

  /** Cancelled listings that did not route ticket revenue through funds escrow still need manual treasury refunds. */
  const cancelledUnrefundedEntries = myEntries.filter(
    (x) =>
      x.raffle.status === 'cancelled' &&
      x.entry.status === 'confirmed' &&
      !x.entry.refunded_at &&
      !raffleUsesFundsEscrow(x.raffle)
  )

  /** Ended, no winner, status not advanced yet — server should move to extension or refunds on refresh. */
  const refundWaitRaffles: EntryWithRaffle['raffle'][] = []
  {
    const seen = new Set<string>()
    for (const x of myEntries) {
      const r = x.raffle
      if (x.entry.status !== 'confirmed' || x.entry.refunded_at) continue
      if (!raffleUsesFundsEscrow(r)) continue
      if ((r.winner_wallet && r.winner_wallet.trim()) || (r.winner_selected_at && String(r.winner_selected_at).trim())) continue
      if (r.status !== 'live' && r.status !== 'ready_to_draw' && r.status !== 'pending_min_not_met') {
        continue
      }
      const endMs = new Date(r.end_time).getTime()
      if (Number.isNaN(endMs) || endMs > Date.now()) continue
      if (r.prize_type === 'nft' && !r.prize_deposited_at) continue
      if (seen.has(r.id)) continue
      seen.add(r.id)
      refundWaitRaffles.push(r)
    }
  }

  const legacyRefundOwedByRaffle = (() => {
    const map = new Map<
      string,
      { raffle: EntryWithRaffle['raffle']; byCurrency: Map<string, number> }
    >()
    for (const x of legacyRefundEligibleEntries) {
      const id = x.raffle.id
      let row = map.get(id)
      if (!row) {
        row = { raffle: x.raffle, byCurrency: new Map() }
        map.set(id, row)
      }
      const c = String(x.entry.currency || 'SOL').toUpperCase()
      row.byCurrency.set(c, (row.byCurrency.get(c) ?? 0) + Number(x.entry.amount_paid ?? 0))
    }
    return Array.from(map.values()).map((row) => ({
      raffle: row.raffle,
      parts: Array.from(row.byCurrency.entries()).map(([currency, total]) => ({
        currency,
        total,
      })),
    }))
  })()

  const cancelledRefundOwedByRaffle = (() => {
    const map = new Map<
      string,
      { raffle: EntryWithRaffle['raffle']; byCurrency: Map<string, number> }
    >()
    for (const x of cancelledUnrefundedEntries) {
      const id = x.raffle.id
      let row = map.get(id)
      if (!row) {
        row = { raffle: x.raffle, byCurrency: new Map() }
        map.set(id, row)
      }
      const c = String(x.entry.currency || 'SOL').toUpperCase()
      row.byCurrency.set(c, (row.byCurrency.get(c) ?? 0) + Number(x.entry.amount_paid ?? 0))
    }
    return Array.from(map.values()).map((row) => ({
      raffle: row.raffle,
      parts: Array.from(row.byCurrency.entries()).map(([currency, total]) => ({
        currency,
        total,
      })),
    }))
  })()

  const showTicketRefundHub =
    refundableEntries.length > 0 ||
    legacyRefundEligibleEntries.length > 0 ||
    refundWaitRaffles.length > 0 ||
    cancelledUnrefundedEntries.length > 0 ||
    offerRefundCandidates.length > 0

  const entriesPageSafe = Math.min(entriesPage, entriesListMaxPage)
  const raffleSummariesPage = raffleSummaries.slice(
    entriesPageSafe * MY_ENTRIES_PAGE_SIZE,
    entriesPageSafe * MY_ENTRIES_PAGE_SIZE + MY_ENTRIES_PAGE_SIZE
  )

  const toggleRaffle = (id: string) => {
    setOpenRaffleId((prev) => (prev === id ? null : id))
  }

  const handleSaveDisplayName = async () => {
    setDisplayNameError(null)
    const name = displayNameInput.trim().slice(0, 32)
    if (!name) {
      setDisplayNameError('Enter a display name (1–32 characters)')
      return
    }
    setDisplayNameSaving(true)
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName: name }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDisplayNameError((json as { error?: string }).error || 'Failed to save')
        return
      }
      setData((prev) => (prev ? { ...prev, displayName: name } : null))
      setDisplayNameSaved(true)
      setTimeout(() => setDisplayNameSaved(false), 3000)
      void loadDashboard({ silent: true })
    } finally {
      setDisplayNameSaving(false)
    }
  }

  const handleDiscordUnlink = async () => {
    setDiscordLinkFlash(null)
    setDiscordUnlinking(true)
    try {
      const res = await fetch('/api/me/discord/unlink', {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDiscordLinkFlash(
          typeof (json as { error?: string }).error === 'string'
            ? (json as { error: string }).error
            : 'Could not unlink Discord.'
        )
        return
      }
      setData((prev) =>
        prev ? { ...prev, discord: { linked: false, username: null } } : null
      )
      void loadDashboard({ silent: true })
    } finally {
      setDiscordUnlinking(false)
    }
  }

  const handleSaveReferralVanity = async () => {
    setReferralVanityError(null)
    const slug = referralVanityInput.trim()
    if (!slug) {
      setReferralVanityError('Enter a custom code (letters, numbers, underscore, hyphen).')
      return
    }
    setReferralVanitySaving(true)
    try {
      const res = await fetch('/api/me/referral/vanity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ slug }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setReferralVanityError(
          typeof (json as { error?: string }).error === 'string'
            ? (json as { error: string }).error
            : 'Could not save referral code.'
        )
        return
      }
      const activeCode =
        typeof (json as { activeCode?: string }).activeCode === 'string'
          ? (json as { activeCode: string }).activeCode
          : slug
      setData((prev) =>
        prev
          ? {
              ...prev,
              referral: prev.referral
                ? {
                    activeCode,
                    codeKind: 'vanity',
                    canSetVanity: prev.referral.canSetVanity,
                  }
                : { activeCode, codeKind: 'vanity', canSetVanity: true },
            }
          : null
      )
      setReferralVanityInput(activeCode)
      setReferralVanitySaved(true)
      setTimeout(() => setReferralVanitySaved(false), 3000)
    } finally {
      setReferralVanitySaving(false)
    }
  }

  const shortWallet =
    wallet.length > 10 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet

  const activeProcessingMessage =
    signingIn ? 'Signing in with wallet...'
      : displayNameSaving ? 'Saving display name...'
      : discordUnlinking ? 'Disconnecting Discord...'
      : referralVanitySaving ? 'Saving referral code...'
      : claimProceedsLoadingId ? 'Claiming creator proceeds...'
      : claimPrizeLoadingId ? 'Claiming your prize...'
      : claimFailedMinPrizeReturnLoadingId ? 'Returning prize from escrow...'
      : claimGiveawayLoadingId ? 'Claiming NFT giveaway...'
      : claimCommunityGiveawayLoadingId ? 'Claiming community giveaway...'
      : claimRefundLoadingEntryId ? 'Processing your ticket refund...'
      : claimOfferRefundLoadingId ? 'Processing your offer refund...'
      : payCancelFeeLoadingId ? 'Paying cancellation fee...'
      : null

  return (
    <main className="relative mx-auto max-w-4xl px-4 py-6 sm:py-10 safe-area-bottom">
      <div
        className="pointer-events-none absolute inset-x-0 -top-24 h-72 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,hsl(var(--primary)/0.18),transparent)]"
        aria-hidden
      />
      <div className="relative space-y-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LayoutDashboard className="h-6 w-6" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Dashboard</h1>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Wallet className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                <span className="font-mono text-xs sm:text-sm">{shortWallet}</span>
                {displayName?.trim() ? (
                  <span className="truncate text-foreground">· {displayName.trim()}</span>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dashboardUpdatedAt != null && (
              <span className="text-xs text-muted-foreground tabular-nums" key={relativeTimeTick}>
                Updated {formatRelativeUpdated(dashboardUpdatedAt)}
              </span>
            )}
            {claimTrackerRefreshing && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch-manipulation min-h-[44px]"
              disabled={claimTrackerRefreshing}
              onClick={() => void loadDashboard({ silent: true })}
            >
              <RefreshCw className="h-4 w-4 sm:mr-1.5" aria-hidden />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </header>

      {activeProcessingMessage && (
        <div
          className="sticky top-2 z-20 rounded-xl border border-primary/30 bg-background/95 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/75"
          role="status"
          aria-live="polite"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            <span>{activeProcessingMessage}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your action is in progress. Keep this tab open until it completes.
          </p>
        </div>
      )}

      <Card className="mb-8 border-green-500/25 bg-green-500/[0.05] rounded-xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-5 w-5 shrink-0 text-theme-prime" aria-hidden />
            Owl Council
          </CardTitle>
          <CardDescription>
            OWL-holder governance — browse proposals, vote (weight = OWL balance), or create if you hold 10+ OWL.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Button asChild variant="outline" size="sm" className="touch-manipulation min-h-[44px]">
            <Link href="/council">Open Owl Council</Link>
          </Button>
        </CardContent>
      </Card>

      {showTicketRefundHub && (
        <Card className="mb-8 border-amber-500/50 bg-amber-500/[0.07]" role="region" aria-label="Ticket refunds and draw status">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Ticket className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              Ticket refunds and ended raffles
            </CardTitle>
            <CardDescription>
              If a raffle ended without enough tickets sold, your refund or status update appears here first — check this
              section before scrolling the rest of the dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {refundWaitRaffles.length > 0 && (
              <div className="rounded-lg border border-border/60 bg-background/80 p-3 text-sm">
                <p className="font-medium text-foreground mb-1">Draw or refund is updating</p>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  These raffles have passed their end time but are still being finalized (extension or refund state).
                  Tap refresh — opening the raffle page also updates status.
                </p>
                <ul className="space-y-2">
                  {refundWaitRaffles.map((r) => (
                    <li key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <Link href={`/raffles/${r.slug}`} className="font-medium hover:underline truncate">
                        {r.title}
                      </Link>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="touch-manipulation min-h-[44px] shrink-0"
                        onClick={() => void loadDashboard({ silent: true })}
                      >
                        <RefreshCw className="h-4 w-4 sm:mr-2" />
                        Refresh dashboard
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {refundableEntries.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <p className="font-medium text-foreground mb-1">Claim refund from escrow</p>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  These raffles can be refunded on-chain from funds escrow. Claim your ticket payment back here
                  (mobile: use Wi‑Fi or solid data if the request fails).
                </p>
                <ul className="space-y-2">
                  {refundableEntries.slice(0, 25).map(({ entry, raffle }) => (
                    <li
                      key={entry.id}
                      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-2 last:border-0 last:pb-0"
                    >
                      <Link href={`/raffles/${raffle.slug}`} className="font-medium hover:underline truncate">
                        {raffle.title}
                      </Link>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="touch-manipulation min-h-[44px] shrink-0"
                        disabled={claimRefundLoadingEntryId === entry.id}
                        onClick={() => handleClaimRefund(entry.id)}
                      >
                        {claimRefundLoadingEntryId === entry.id ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Refunding…
                          </>
                        ) : (
                          `Claim ${Number(entry.amount_paid).toFixed(entry.currency === 'USDC' ? 2 : 4)} ${entry.currency}`
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {offerRefundCandidates.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <p className="font-medium text-foreground mb-1">Claim back unaccepted offer bids</p>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  If your raffle offer was not accepted, your bid stays in escrow until you claim it back here.
                </p>
                <ul className="space-y-2">
                  {offerRefundCandidates.slice(0, 25).map((offer) => (
                    <li
                      key={offer.offerId}
                      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-2 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <Link href={`/raffles/${offer.raffleSlug}`} className="font-medium hover:underline truncate block">
                          {offer.raffleTitle}
                        </Link>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">
                          offer {offer.status}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="touch-manipulation min-h-[44px] shrink-0"
                        disabled={claimOfferRefundLoadingId === offer.offerId}
                        onClick={() => handleClaimOfferRefund(offer.offerId)}
                      >
                        {claimOfferRefundLoadingId === offer.offerId ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Refunding…
                          </>
                        ) : (
                          `Claim ${Number(offer.amount).toFixed(offer.currency === 'USDC' ? 2 : 4)} ${offer.currency}`
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {cancelledUnrefundedEntries.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <p className="font-medium text-foreground mb-1">Cancelled raffle — manual refund</p>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  These listings were cancelled, but ticket revenue for them did not use funds escrow. Refunds are
                  issued manually by the platform (treasury). If you are still waiting, contact support with the raffle link.
                </p>
                <ul className="space-y-3">
                  {cancelledRefundOwedByRaffle.map(({ raffle, parts }) => {
                    const formatted = parts
                      .map(
                        ({ currency, total }) =>
                          `${total.toFixed(currency === 'USDC' ? 2 : 4)} ${currency}`
                      )
                      .join(' · ')
                    return (
                      <li
                        key={raffle.id}
                        className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 border-b border-border/40 pb-2 last:border-0 last:pb-0"
                      >
                        <Link href={`/raffles/${raffle.slug}`} className="font-medium hover:underline truncate min-w-0">
                          {raffle.title}
                        </Link>
                        <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                          {parts.length === 1
                            ? `Amount owed: ${formatted}`
                            : `Amounts owed: ${formatted}`}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {legacyRefundEligibleEntries.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <p className="font-medium text-foreground mb-1">Refund owed (manual / legacy payout)</p>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  This listing is marked as failed (minimum not met), but ticket payments did not use the automated funds
                  escrow wallet — usually because tickets were sold before escrow payouts were enabled for that raffle.
                  The platform or host issues these refunds manually. Open the raffle for details and contact support if
                  you need help.
                </p>
                <ul className="space-y-3">
                  {legacyRefundOwedByRaffle.map(({ raffle, parts }) => {
                    const formatted = parts
                      .map(
                        ({ currency, total }) =>
                          `${total.toFixed(currency === 'USDC' ? 2 : 4)} ${currency}`
                      )
                      .join(' · ')
                    return (
                      <li
                        key={raffle.id}
                        className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 border-b border-border/40 pb-2 last:border-0 last:pb-0"
                      >
                        <Link href={`/raffles/${raffle.slug}`} className="font-medium hover:underline truncate min-w-0">
                          {raffle.title}
                        </Link>
                        <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                          {parts.length === 1
                            ? `Amount to refund: ${formatted}`
                            : `Amounts to refund: ${formatted}`}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs
        value={dashboardTab}
        onValueChange={(v) => setDashboardTabFromUi(v as DashboardTabId)}
        className="space-y-6"
      >
        <TabsList className="flex h-auto min-h-[52px] w-full flex-wrap justify-stretch gap-1 rounded-xl border border-border/50 bg-muted/40 p-1.5 touch-manipulation sm:flex-nowrap sm:overflow-x-auto">
          <TabsTrigger
            value="overview"
            className="min-h-[44px] flex-1 gap-1.5 rounded-lg px-2 text-xs font-medium sm:flex-initial sm:px-4 sm:text-sm"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="hosting"
            className="min-h-[44px] flex-1 gap-1.5 rounded-lg px-2 text-xs font-medium sm:flex-initial sm:px-4 sm:text-sm"
          >
            Hosting
            {(pendingCreatorFundClaims.length > 0 || creatorRafflesEndedAwaitingDraw.length > 0) && (
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                aria-hidden
              />
            )}
          </TabsTrigger>
          <TabsTrigger
            value="winnings"
            className="min-h-[44px] flex-1 gap-1.5 rounded-lg px-2 text-xs font-medium sm:flex-initial sm:px-4 sm:text-sm"
          >
            Wins
          </TabsTrigger>
          <TabsTrigger
            value="account"
            className="min-h-[44px] flex-1 gap-1.5 rounded-lg px-2 text-xs font-medium sm:flex-initial sm:px-4 sm:text-sm"
          >
            Wallet
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 space-y-4 focus-visible:outline-none">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="rounded-xl border-border/60 bg-card/90 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Award className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Level & XP
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-2xl font-bold tracking-tight">
                    Level {engagement.level}
                    <span className="text-base font-semibold text-muted-foreground"> / 99</span>
                  </p>
                  <p className="text-sm tabular-nums text-muted-foreground">{engagement.totalXp} XP</p>
                </div>
                {engagement.xpToNext != null && engagement.xpToNext > 0 ? (
                  <div className="space-y-1.5">
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={engagement.xpToNext}
                      aria-valuenow={engagement.xpIntoLevel}
                      aria-label="Experience toward next level"
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round((100 * engagement.xpIntoLevel) / engagement.xpToNext)
                          )}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {engagement.xpIntoLevel} / {engagement.xpToNext} XP to next level
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Max level reached.</p>
                )}
                <details className="group text-sm">
                  <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-foreground touch-manipulation min-h-[44px] sm:min-h-0 [&::-webkit-details-marker]:hidden">
                    <ChevronDown
                      className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                    Milestones ({engagement.milestones.filter((m) => m.done).length}/
                    {engagement.milestones.length})
                  </summary>
                  <ul className="scrollbar-themed mt-1 max-h-52 space-y-2 overflow-y-auto pr-1 text-xs text-muted-foreground">
                    {engagement.milestones.map((m) => (
                      <li
                        key={m.key}
                        className={`flex gap-2 rounded-md border border-border/50 p-2 ${m.done ? 'bg-muted/40' : 'bg-transparent'}`}
                      >
                        <span className="shrink-0 pt-0.5" aria-hidden>
                          {m.done ? (
                            <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                          ) : (
                            <span className="inline-block h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-foreground">{m.title}</span>
                          <span className="text-muted-foreground"> · +{m.xp} XP</span>
                          <span className="mt-0.5 block leading-snug">{m.description}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </CardContent>
            </Card>
            <Card className="rounded-xl border-border/60 bg-card/90 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Fee tier
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-2xl font-bold tracking-tight">
                  {feeTier.feeBps === 300 ? '3%' : feeTier.feeBps === 600 ? '6%' : `${(feeTier.feeBps / 100).toFixed(1)}%`}{' '}
                  <span className="text-base font-semibold text-muted-foreground">fee</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {feeTier.reason === 'holder'
                    ? 'Owltopia holder rate'
                    : feeTier.reason === 'partner_community'
                      ? displayNameInput.trim()
                        ? `Partner · ${displayNameInput.trim()}`
                        : 'Partner — set display name in Wallet tab'
                      : 'Standard rate'}
                </p>
                <details className="group text-xs text-muted-foreground">
                  <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-foreground touch-manipulation [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
                    How fees work
                  </summary>
                  <p className="mt-2 leading-relaxed pl-1">
                    New raffles use funds escrow; platform fee and your net share are sent when you claim after the draw.
                    Older raffles may use split-at-purchase.
                  </p>
                </details>
              </CardContent>
            </Card>
            <Card className="rounded-xl border-border/60 bg-card/90 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Creator revenue
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-2xl font-bold tabular-nums tracking-tight">
                  {creatorRevenue > 0
                    ? Object.entries(creatorRevenueByCurrency)
                        .map(([cur, amt]) => `${amt.toFixed(cur === 'USDC' ? 2 : 4)} ${cur}`)
                        .join(' + ') || '—'
                    : '—'}
                </p>
                {creatorRevenue > 0 ? (
                  <>
                    <p className="text-sm text-muted-foreground">After platform fee (claimed + live estimate).</p>
                    {Object.keys(creatorLiveEarningsByCurrency).length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Live:{' '}
                        {Object.entries(creatorLiveEarningsByCurrency)
                          .map(([cur, amt]) => `${amt.toFixed(cur === 'USDC' ? 2 : 4)} ${cur}`)
                          .join(' + ')}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No earnings from hosted raffles yet.</p>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-xl border-border/60 bg-card/90 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Gross sales
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-2xl font-bold tabular-nums tracking-tight">
                  {Object.keys(creatorAllTimeGrossByCurrency).length > 0
                    ? Object.entries(creatorAllTimeGrossByCurrency)
                        .map(([cur, amt]) => `${amt.toFixed(cur === 'USDC' ? 2 : 4)} ${cur}`)
                        .join(' + ')
                    : '—'}
                </p>
                <p className="text-sm text-muted-foreground">Confirmed ticket volume (before platform fee).</p>
              </CardContent>
            </Card>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Live escrow totals and claims are under{' '}
            <button
              type="button"
              className="font-medium text-primary underline-offset-4 hover:underline touch-manipulation"
              onClick={() => setDashboardTabFromUi('hosting')}
            >
              Hosting
            </button>
            . Prizes and tickets you bought are under{' '}
            <button
              type="button"
              className="font-medium text-primary underline-offset-4 hover:underline touch-manipulation"
              onClick={() => setDashboardTabFromUi('winnings')}
            >
              Wins
            </button>
            .
          </p>
        </TabsContent>

        <TabsContent value="account" className="mt-0 space-y-4 focus-visible:outline-none">
          <Card className="rounded-xl border-border/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                Display name
              </CardTitle>
              <CardDescription>
                Shown in raffle participant lists for this wallet. Leave blank to show your address.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="e.g. Crazyfox"
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value.slice(0, 32))}
                maxLength={32}
                className="max-w-md min-h-[44px] touch-manipulation"
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSaveDisplayName}
                  disabled={displayNameSaving}
                  className="min-h-[44px] touch-manipulation"
                >
                  {displayNameSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Saving…
                    </>
                  ) : (
                    'Save'
                  )}
                </Button>
                {displayNameSaved && (
                  <span
                    className="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400"
                    aria-live="polite"
                  >
                    <Check className="h-4 w-4 shrink-0" />
                    Saved
                  </span>
                )}
              </div>
            </CardContent>
            {displayNameError && <p className="text-sm text-destructive px-6 pb-4">{displayNameError}</p>}
          </Card>

          <Card className="rounded-xl border-border/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Ticket className="h-4 w-4" />
                Live activity popups
              </CardTitle>
              <CardDescription>
                Show or hide real-time ticket purchase popups across the site on this device.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground min-h-[44px] flex items-center">
                Status: <span className="ml-1 font-medium text-foreground">{liveActivityMuted ? 'Muted' : 'On'}</span>
              </p>
              <Button
                type="button"
                variant={liveActivityMuted ? 'default' : 'outline'}
                className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                onClick={handleToggleLiveActivityMuted}
              >
                {liveActivityMuted ? 'Unmute popups' : 'Mute popups'}
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-xl border-border/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="h-4 w-4" />
                Discord
              </CardTitle>
              <CardDescription>
                Link Discord for winner pings in partnered / community draws when you are in that server.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground min-h-[44px] flex flex-col justify-center">
                {discord.linked ? (
                  <>
                    <span className="text-foreground font-medium">Connected</span>
                    {discord.username ? <span className="text-xs mt-0.5">{discord.username}</span> : null}
                  </>
                ) : (
                  <span>Not linked</span>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                {discord.linked ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                    disabled={discordUnlinking}
                    onClick={() => void handleDiscordUnlink()}
                  >
                    {discordUnlinking ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Unlinking…
                      </>
                    ) : (
                      'Unlink Discord'
                    )}
                  </Button>
                ) : (
                  <Button asChild className="touch-manipulation min-h-[44px] w-full sm:w-auto">
                    <a href="/api/me/discord/link">Connect Discord</a>
                  </Button>
                )}
              </div>
            </CardContent>
            {discordLinkFlash && (
              <p className="text-sm px-6 pb-4 text-muted-foreground" role="status">
                {discordLinkFlash}
              </p>
            )}
            <div className="border-t border-border/50 px-6 pb-4">
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer py-2 font-medium text-foreground touch-manipulation">
                  Why link Discord?
                </summary>
                <p className="pb-2 text-xs leading-relaxed">
                  Owltopia webhooks and linked giveaways can @ you when you win, if you are in that Discord server.
                </p>
              </details>
            </div>
          </Card>

          {referralRow ? (
            <Card className="rounded-xl border-border/60 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Share2 className="h-4 w-4" />
                  Referral link
                </CardTitle>
                <CardDescription>Share to credit referrals on ticket purchases (cookie-based).</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:flex-wrap">
                  <code className="flex min-h-[44px] items-center rounded-lg border border-border/60 bg-muted/80 px-3 py-2.5 text-xs break-all sm:text-sm">
                    {typeof window !== 'undefined'
                      ? `${window.location.origin}/?ref=${encodeURIComponent(referralRow.activeCode)}`
                      : `/?ref=${referralRow.activeCode}`}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    className="touch-manipulation min-h-[44px] shrink-0 w-full sm:w-auto"
                    onClick={() => {
                      const href =
                        typeof window !== 'undefined'
                          ? `${window.location.origin}/?ref=${encodeURIComponent(referralRow.activeCode)}`
                          : ''
                      if (href && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(href)
                      }
                    }}
                  >
                    Copy link
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Code: <span className="font-medium text-foreground">{referralRow.activeCode}</span>
                  {referralRow.codeKind === 'vanity' ? ' · custom' : ' · auto'}
                </p>
                <details className="rounded-lg border border-border/50 bg-muted/20 text-xs">
                  <summary className="cursor-pointer p-3 font-medium text-foreground touch-manipulation">
                    Rules & custom codes
                  </summary>
                  <div className="space-y-3 border-t border-border/40 px-3 pb-3 pt-2 text-muted-foreground leading-relaxed">
                    <p>
                      Very small checkouts may not attach a referrer; volume caps apply per wallet. Selling your Owltopia
                      NFT retires a custom code and rotates a new random link.
                    </p>
                    {referralRow.canSetVanity ? (
                      <div className="space-y-2">
                        <p className="font-medium text-foreground">Custom code (holders)</p>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input
                            placeholder="e.g. mycrew"
                            value={referralVanityInput}
                            onChange={(e) => setReferralVanityInput(e.target.value.slice(0, 32))}
                            maxLength={32}
                            className="max-w-xs min-h-[44px] touch-manipulation"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                          />
                          <Button
                            type="button"
                            className="min-h-[44px] w-full touch-manipulation sm:w-auto"
                            disabled={referralVanitySaving}
                            onClick={() => void handleSaveReferralVanity()}
                          >
                            {referralVanitySaving ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Saving…
                              </>
                            ) : (
                              'Save custom code'
                            )}
                          </Button>
                        </div>
                        {referralVanitySaved && (
                          <span
                            className="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400"
                            aria-live="polite"
                          >
                            <Check className="h-4 w-4 shrink-0" />
                            Saved
                          </span>
                        )}
                        {referralVanityError && (
                          <p className="text-sm text-destructive" role="alert">
                            {referralVanityError}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                </details>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="hosting" className="mt-0 space-y-6 focus-visible:outline-none">
      <Card className="mb-0 rounded-xl border-emerald-500/30 bg-emerald-500/[0.06] shadow-sm">
        <CardHeader className="space-y-3 pb-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <CardTitle className="flex items-center gap-2.5 text-base sm:text-lg">
                <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-35" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                Live claim tracker
              </CardTitle>
              <CardDescription>
                Updates about every {Math.round(CLAIM_TRACKER_POLL_MS / 1000)}s while this tab is open, or when you use
                refresh in the page header.
              </CardDescription>
            </div>
            <details className="rounded-lg border border-border/50 bg-background/60 text-sm sm:max-w-xs">
              <summary className="cursor-pointer px-3 py-2.5 font-medium touch-manipulation">
                Escrow tips
              </summary>
              <p className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                Creator revenue and gross sales on the Overview tab use the same refresh. On mobile, use stable Wi‑Fi or
                data if totals lag.
              </p>
            </details>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-background/60 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Ready to claim (net to you)</p>
              <p className="text-lg font-semibold tabular-nums break-words">
                {formatMultiCurrencyTotals(claimTrackerReadyNetByCurrency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {pendingCreatorFundClaims.length} raffle
                {pendingCreatorFundClaims.length === 1 ? '' : 's'} settled — use{' '}
                <span className="font-medium text-foreground">Claim now</span> below when listed.
              </p>
              <p className="text-xs font-medium text-muted-foreground mt-2.5 mb-0.5">Live raffles (net in escrow)</p>
              <p className="text-base font-semibold tabular-nums break-words">
                {formatMultiCurrencyTotals(claimTrackerLiveSales.net)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Estimated from confirmed ticket sales on funds-escrow raffles still live or waiting to draw.
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/60 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Platform fee (same claim tx)</p>
              <p className="text-lg font-semibold tabular-nums break-words">
                {formatMultiCurrencyTotals(claimTrackerReadyFeeByCurrency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Goes to treasury when you claim</p>
              <p className="text-xs font-medium text-muted-foreground mt-2.5 mb-0.5">Live raffles (fee in escrow)</p>
              <p className="text-base font-semibold tabular-nums break-words">
                {formatMultiCurrencyTotals(claimTrackerLiveSales.fee)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Same fee tier as your dashboard; included when you claim after the draw.</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/60 p-3 sm:col-span-1">
              <p className="text-xs font-medium text-muted-foreground mb-1">Gross in escrow (pre-claim)</p>
              <p className="text-lg font-semibold tabular-nums break-words">
                {formatMultiCurrencyTotals(claimTrackerReadyGrossByCurrency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Net + fee for raffles ready to claim</p>
              <p className="text-xs font-medium text-muted-foreground mt-2.5 mb-0.5">Live raffles (gross in escrow)</p>
              <p className="text-base font-semibold tabular-nums break-words">
                {formatMultiCurrencyTotals(claimTrackerLiveSales.gross)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Total confirmed ticket volume still in funds escrow before the draw.</p>
            </div>
          </div>

          {pendingCreatorFundClaims.length > 0 && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.09] p-3 sm:p-4">
              <p className="text-sm font-semibold text-foreground mb-1">Claim now — ticket proceeds (funds escrow)</p>
              <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                One transaction sends your net share to this wallet and the platform fee to treasury. You can also claim
                from each raffle row under My raffles in this tab.
              </p>
              <ul className="space-y-3">
                {pendingCreatorFundClaims.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/30 pb-3 last:border-0 last:pb-0"
                  >
                    <Link href={`/raffles/${r.slug}`} className="font-medium hover:underline truncate min-w-0">
                      {r.title}
                    </Link>
                    <Button
                      type="button"
                      size="sm"
                      className="touch-manipulation min-h-[44px] shrink-0 w-full sm:w-auto"
                      disabled={claimProceedsLoadingId === r.id}
                      onClick={() => handleClaimProceeds(r.id)}
                    >
                      {claimProceedsLoadingId === r.id ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Claiming…
                        </>
                      ) : (
                        <>
                          <Coins className="h-4 w-4 mr-2" />
                          Claim funds
                        </>
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {awaitingSettlementEscrowClaims.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-2">
                Waiting for settlement ({awaitingSettlementEscrowClaims.length})
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                Winner recorded; payout lines are being finalized. Amounts appear here when ready.
              </p>
              <ul className="space-y-1.5 text-sm">
                {awaitingSettlementEscrowClaims.slice(0, 8).map((r) => (
                  <li key={r.id}>
                    <Link href={`/raffles/${r.slug}`} className="text-primary hover:underline font-medium">
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
              {awaitingSettlementEscrowClaims.length > 8 && (
                <p className="text-xs text-muted-foreground mt-2">
                  +{awaitingSettlementEscrowClaims.length - 8} more in My raffles
                </p>
              )}
            </div>
          )}

          {liveEscrowRaffles.length > 0 && (
            <div className="rounded-lg border border-dashed border-border/70 p-3">
              <p className="text-sm font-medium text-foreground">
                Ticket sales still in funds escrow ({liveEscrowRaffles.length} raffle
                {liveEscrowRaffles.length === 1 ? '' : 's'})
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Live and ready-to-draw raffles keep gross proceeds in escrow until the draw. The top row stays “—” until
                a winner is drawn; then your net and fee move to “ready to claim.” See{' '}
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-4 hover:underline touch-manipulation"
                  onClick={() => setDashboardTabFromUi('overview')}
                >
                  Overview
                </button>{' '}
                for headline revenue and gross sales as purchases confirm.
              </p>
            </div>
          )}

          {creatorRafflesEndedAwaitingDraw.length > 0 && (
            <div
              className="rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-3"
              role="status"
            >
              <p className="text-sm font-medium text-foreground">End time passed — winner draw still pending</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                Your claim button only appears <span className="font-medium text-foreground">after</span> a winner is
                chosen and settlement is recorded. Open each raffle page once to run the draw immediately, or wait for
                the automatic job (about every 15 minutes).
              </p>
              <ul className="mt-2.5 space-y-1.5 text-sm">
                {creatorRafflesEndedAwaitingDraw.slice(0, 10).map((r) => (
                  <li key={r.id}>
                    <Link href={`/raffles/${r.slug}`} className="text-primary font-medium hover:underline">
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
              {creatorRafflesEndedAwaitingDraw.length > 10 && (
                <p className="text-xs text-muted-foreground mt-2">
                  +{creatorRafflesEndedAwaitingDraw.length - 10} more in My raffles below
                </p>
              )}
            </div>
          )}

          {pendingCreatorFundClaims.length === 0 &&
            awaitingSettlementEscrowClaims.length === 0 &&
            liveEscrowRaffles.length === 0 &&
            !claimTrackerHasLiveEscrowSales && (
              <p className="text-sm text-muted-foreground">
                No active escrow claim pipeline right now. When you host funds-escrow raffles, live sales show in the
                tracker above; after a draw, ready-to-claim totals appear in the top row of each column until you claim.
              </p>
            )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border/60 shadow-sm">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              My raffles
            </CardTitle>
            <CardDescription>Raffles you created ({myRaffles.length})</CardDescription>
          </div>
          <Button asChild className="shrink-0">
            <Link href="/admin/raffles/new">Create raffle</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {claimActionError && (
            <p className="text-sm text-destructive mb-3" role="alert">
              {claimActionError}
            </p>
          )}
          {creatorFailedMinPrizeReturnClaimable.length > 0 && (
            <div
              className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-3 space-y-2"
              role="status"
            >
              <p className="text-sm font-medium text-foreground">
                Claim your prize back (cancelled or minimum not met after extension)
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                For these listings, your prize may still be in platform escrow. If the return did not finish
                automatically, use the button for each raffle (same wallet you used to create the listing; sign-in
                required). Buyers on cancelled raffles are refunded per platform policy, separately from this claim.
              </p>
              <ul className="space-y-2">
                {creatorFailedMinPrizeReturnClaimable.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-2 rounded-md border border-border/50 bg-background/60 p-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <Link href={`/raffles/${r.slug}`} className="text-sm font-medium text-primary hover:underline">
                      {r.title}
                    </Link>
                    {needsPayCancellationBeforeClaim(r) ? (
                      <Button
                        type="button"
                        size="sm"
                        className="touch-manipulation min-h-[44px] w-full shrink-0 sm:w-auto"
                        disabled={payCancelFeeLoadingId === r.id}
                        onClick={() => void handlePayCancellationFee(r)}
                      >
                        {payCancelFeeLoadingId === r.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Wallet className="h-4 w-4 sm:mr-1" />
                            <span className="sm:inline">Pay {getCancellationFeeSol()} SOL fee</span>
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="touch-manipulation min-h-[44px] w-full shrink-0 sm:w-auto"
                        disabled={claimFailedMinPrizeReturnLoadingId === r.id}
                        onClick={() => void handleClaimFailedMinPrizeReturn(r.id)}
                      >
                        {claimFailedMinPrizeReturnLoadingId === r.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Wallet className="h-4 w-4 sm:mr-1" />
                            <span className="sm:inline">
                              {isPartnerSplPrizeRaffle(r as Pick<FullRaffle, 'prize_type' | 'prize_currency'>)
                                ? 'Claim tokens from escrow'
                                : 'Claim NFT from escrow'}
                            </span>
                          </>
                        )}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {myRaffles.length === 0 ? (
            <p className="text-muted-foreground">You haven’t created any raffles yet.</p>
          ) : (
            <ul className="space-y-2">
              {myRaffles.slice(0, 20).map((r) => {
                const isOpen = openRaffleId === r.id
                const endTime = new Date(r.end_time)
                return (
                  <li
                    key={r.id}
                    className="border-b border-border/50 last:border-0"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleRaffle(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleRaffle(r.id)
                        }
                      }}
                      className="flex w-full cursor-pointer items-center justify-between gap-4 py-2 text-left"
                    >
                      <span className="flex min-w-0 flex-col">
                        <Link
                          href={`/raffles/${r.slug}`}
                          className="font-medium hover:underline truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.title}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          Ends {endTime.toLocaleString()}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 text-sm text-muted-foreground flex-wrap justify-end">
                        <span className="capitalize">{myRaffleStatusLabel(r.status)}</span>
                        {r.status === 'successful_pending_claims' &&
                          raffleUsesFundsEscrow(r) &&
                          !r.creator_claimed_at &&
                          !!r.settled_at?.trim() && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="touch-manipulation min-h-[44px] h-9"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleClaimProceeds(r.id)
                              }}
                              disabled={claimProceedsLoadingId === r.id}
                            >
                              {claimProceedsLoadingId === r.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Coins className="h-4 w-4 sm:mr-1" />
                                  <span className="hidden sm:inline">Claim funds</span>
                                </>
                              )}
                            </Button>
                          )}
                        {needsPayCancellationStraggler(r) && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="touch-manipulation min-h-[44px] h-9"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handlePayCancellationFee(r)
                            }}
                            disabled={payCancelFeeLoadingId === r.id}
                          >
                            {payCancelFeeLoadingId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Wallet className="h-4 w-4 sm:mr-1" />
                                <span className="hidden sm:inline">Pay cancel fee</span>
                              </>
                            )}
                          </Button>
                        )}
                        {canCreatorClaimFailedMinThresholdPrize(r, wallet) &&
                          !needsPayCancellationBeforeClaim(r) &&
                          !needsPayCancellationStraggler(r) && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="touch-manipulation min-h-[44px] h-9"
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleClaimFailedMinPrizeReturn(r.id)
                              }}
                              disabled={claimFailedMinPrizeReturnLoadingId === r.id}
                            >
                              {claimFailedMinPrizeReturnLoadingId === r.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Wallet className="h-4 w-4 sm:mr-1" />
                                  <span className="hidden sm:inline">
                                    {isPartnerSplPrizeRaffle(
                                      r as Pick<FullRaffle, 'prize_type' | 'prize_currency'>
                                    )
                                      ? 'Claim prize'
                                      : 'Claim NFT'}
                                  </span>
                                </>
                              )}
                            </Button>
                          )}
                        {r.creator_payout_amount != null &&
                          (r.status === 'completed' ||
                            (r.status === 'successful_pending_claims' && r.creator_claimed_at)) && (
                          <span>
                            {Number(r.creator_payout_amount).toFixed(r.currency === 'USDC' ? 2 : 4)} {r.currency}
                          </span>
                        )}
                        {r.prize_type === 'nft' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              openEscrowCheck(r.id)
                            }}
                            disabled={escrowLinkLoadingId === r.id}
                            className="text-primary hover:underline inline-flex items-center gap-1"
                            title="View NFT in escrow on Solscan"
                          >
                            {escrowLinkLoadingId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <ExternalLink className="h-4 w-4" />
                                <span className="hidden sm:inline">Solscan</span>
                              </>
                            )}
                          </button>
                        )}
                        <Link
                          href={`/raffles/${r.slug}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                        </Link>
                      </span>
                    </div>
                    <div
                      className={`overflow-hidden transition-all duration-300 ${
                        isOpen ? 'max-h-[28rem] opacity-100' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <div className="pb-3 pl-1 pr-1 text-sm text-muted-foreground space-y-1">
                        {r.status === 'successful_pending_claims' &&
                          raffleUsesFundsEscrow(r) &&
                          !r.creator_claimed_at &&
                          !!r.settled_at?.trim() && (
                            <div className="py-2">
                              <Button
                                type="button"
                                size="sm"
                                className="touch-manipulation min-h-[44px]"
                                disabled={claimProceedsLoadingId === r.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleClaimProceeds(r.id)
                                }}
                              >
                                {claimProceedsLoadingId === r.id ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Claiming…
                                  </>
                                ) : (
                                  <>
                                    <Coins className="h-4 w-4 mr-2" />
                                    Claim ticket proceeds
                                  </>
                                )}
                              </Button>
                              <p className="text-xs mt-2 text-muted-foreground">
                                Raffle has settled. Claim sends your net share to this wallet and the platform fee to
                                treasury from funds escrow. Sign in is required.
                              </p>
                            </div>
                          )}
                        {r.status === 'successful_pending_claims' &&
                          raffleUsesFundsEscrow(r) &&
                          !r.creator_claimed_at &&
                          !r.settled_at?.trim() && (
                            <p className="text-xs text-muted-foreground py-2">
                              Waiting for settlement (winner and payout amounts) before you can claim proceeds.
                            </p>
                          )}
                        <p>
                          <span className="font-medium text-foreground">Payout:</span>{' '}
                          {r.creator_payout_amount != null &&
                          (r.status === 'completed' ||
                            (r.status === 'successful_pending_claims' && r.creator_claimed_at))
                            ? `${Number(r.creator_payout_amount).toFixed(
                                r.currency === 'USDC' ? 2 : 4
                              )} ${r.currency}`
                            : r.status === 'successful_pending_claims' &&
                                !r.creator_claimed_at &&
                                r.settled_at?.trim()
                              ? `Pending claim (${Number(r.creator_payout_amount ?? 0).toFixed(
                                  r.currency === 'USDC' ? 2 : 4
                                )} ${r.currency} net after fee)`
                              : r.status === 'successful_pending_claims' && !r.creator_claimed_at
                                ? 'Waiting for settlement before claim'
                                : 'Not settled yet'}
                        </p>
                        <p>
                          <span className="font-medium text-foreground">Status:</span>{' '}
                          <span className="capitalize">{myRaffleStatusLabel(r.status)}</span>
                        </p>
                        {r.status === 'completed' && (
                          <div className="text-xs text-muted-foreground space-y-2 pt-1 border-t border-border/40 mt-2">
                            {raffleUsesFundsEscrow(r) && r.creator_claim_tx?.trim() ? (
                              <p>
                                Ticket proceeds from escrow were already sent to your creator wallet in{' '}
                                <a
                                  href={solscanTxUrl(r.creator_claim_tx.trim())}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary underline underline-offset-2 inline-flex items-center gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  this Solscan transaction
                                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                                </a>
                                . There is no second claim after the raffle shows completed.
                              </p>
                            ) : null}
                            {raffleUsesFundsEscrow(r) && !r.creator_claim_tx?.trim() ? (
                              <p>
                                This raffle is marked completed but no on-chain proceeds transaction is on file. If you
                                never completed &ldquo;Claim proceeds,&rdquo; contact support with this raffle so the team
                                can reconcile escrow and your wallet.
                              </p>
                            ) : null}
                            {!raffleUsesFundsEscrow(r) ? (
                              <p>
                                This raffle used per-purchase payment splits: your share of each ticket arrived when
                                buyers paid. There is no separate claim after the draw. The payout figure above is your
                                recorded net from those sales.
                              </p>
                            ) : null}
                            <p>
                              On the raffle page, <span className="font-medium text-foreground">Amount over threshold</span>{' '}
                              is profit above your configured prize value, NFT floor, or draw minimum—what you keep as surplus
                              once ticket revenue passes that bar. The <span className="font-medium text-foreground">Payout</span>{' '}
                              line here is your net from <span className="font-medium text-foreground">all</span> ticket
                              sales after the platform fee, not only the over-threshold portion.
                            </p>
                          </div>
                        )}
                        {(r.status === 'live' || r.status === 'ready_to_draw') && !r.cancellation_requested_at && (
                          <p>
                            <Button
                              asChild
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-amber-600 border-amber-500/50 hover:bg-amber-500/10"
                            >
                              <Link
                                href={`/raffles/${r.slug}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center"
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1" />
                                Open raffle to request cancellation
                              </Link>
                            </Button>
                            <span className="block text-xs mt-1 text-muted-foreground">
                              After the listed start time, a SOL fee may apply. You will confirm the amount in your wallet. Admin
                              will review in Owl Vision; buyers on funds-escrow raffles can claim refunds in their dashboard.
                            </span>
                          </p>
                        )}
                        {r.cancellation_requested_at && r.status !== 'cancelled' && (
                          <p className="text-amber-600 dark:text-amber-400 text-xs">
                            Cancellation requested. Waiting for admin approval in Owl Vision.
                          </p>
                        )}
                        {(r.status === 'failed_refund_available' || r.status === 'cancelled') && (
                          <div className="rounded-md border border-amber-500/35 bg-amber-500/[0.06] p-3 space-y-2 mt-2">
                            <p className="text-xs font-medium text-foreground">
                              {r.status === 'cancelled'
                                ? 'Raffle cancelled'
                                : 'Minimum tickets not met (after extension)'}
                            </p>
                            {canCreatorClaimFailedMinThresholdPrize(r, wallet) && needsPayCancellationBeforeClaim(r) ? (
                              <>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                  This listing was cancelled after it started. Pay the {getCancellationFeeSol()} SOL
                                  cancellation fee from this wallet, then you can claim your prize from escrow.
                                </p>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="touch-manipulation min-h-[44px]"
                                  disabled={payCancelFeeLoadingId === r.id}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void handlePayCancellationFee(r)
                                  }}
                                >
                                  {payCancelFeeLoadingId === r.id ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                      Paying…
                                    </>
                                  ) : (
                                    <>
                                      <Wallet className="h-4 w-4 mr-2" />
                                      Pay {getCancellationFeeSol()} SOL
                                    </>
                                  )}
                                </Button>
                              </>
                            ) : canCreatorClaimFailedMinThresholdPrize(r, wallet) ? (
                              <>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                  {r.status === 'cancelled'
                                    ? 'This listing was cancelled. If your prize is still in platform escrow, claim it back to this wallet (one on-chain transfer; sign-in required). If this fails on mobile data, try Wi‑Fi or again in a few minutes.'
                                    : 'Your prize is still in platform escrow. Claim it back to this wallet (no ticket purchase needed; one on-chain transfer). If this fails on mobile data, try Wi‑Fi or again in a few minutes.'}
                                </p>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="touch-manipulation min-h-[44px]"
                                  disabled={claimFailedMinPrizeReturnLoadingId === r.id}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void handleClaimFailedMinPrizeReturn(r.id)
                                  }}
                                >
                                  {claimFailedMinPrizeReturnLoadingId === r.id ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                      Returning…
                                    </>
                                  ) : (
                                    <>
                                      <Wallet className="h-4 w-4 mr-2" />
                                      {isPartnerSplPrizeRaffle(
                                        r as Pick<FullRaffle, 'prize_type' | 'prize_currency'>
                                      )
                                        ? 'Claim prize tokens from escrow'
                                        : 'Claim NFT back from escrow'}
                                    </>
                                  )}
                                </Button>
                              </>
                            ) : r.prize_returned_at?.trim() && r.prize_return_tx?.trim() ? (
                              <p className="text-xs text-muted-foreground">
                                Prize returned to your creator wallet.{' '}
                                <a
                                  href={solscanTxUrl(r.prize_return_tx.trim())}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary underline underline-offset-2 inline-flex items-center gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  View transaction
                                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                                </a>
                              </p>
                            ) : (r.prize_type === 'nft' ||
                                isPartnerSplPrizeRaffle(
                                  r as Pick<FullRaffle, 'prize_type' | 'prize_currency'>
                                )) &&
                              r.prize_deposited_at &&
                              !r.prize_returned_at ? (
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                The site already tried to return your prize when this raffle became refund-available.
                                If your wallet still does not show it, wait a minute, refresh this page, or use the
                                claim button if it appears above.
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                No verified escrow deposit is on file for this listing. Contact support with the
                                raffle link if you believe the prize should be in escrow.
                              </p>
                            )}
                          </div>
                        )}
                        {r.prize_type === 'nft' && (
                          <p>
                            <button
                              type="button"
                              onClick={() => openEscrowCheck(r.id)}
                              disabled={escrowLinkLoadingId === r.id}
                              className="text-primary hover:underline inline-flex items-center gap-1"
                            >
                              {escrowLinkLoadingId === r.id ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Opening…
                                </>
                              ) : (
                                <>
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  View NFT in escrow (Solscan)
                                </>
                              )}
                            </button>
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            )}
            {myRaffles.length > 20 && (
            <p className="text-sm text-muted-foreground mt-2">Showing latest 20 of {myRaffles.length}</p>
          )}
        </CardContent>
      </Card>

      {buyoutRefundEligible.length > 0 && (
        <Card className="rounded-xl border-border/60 bg-card/90 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Landmark className="h-5 w-5 shrink-0" aria-hidden />
              NFT buyout — reclaim your bid
            </CardTitle>
            <CardDescription>
              Your buyout deposit can be returned when the offer expired or the winner accepted someone else&apos;s bid.
              Uses the platform treasury wallet — ensure{' '}
              <span className="font-mono text-xs">RAFFLE_RECIPIENT_SECRET_KEY</span> is configured for automatic refunds.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {buyoutRefundEligible.map((o) => (
              <div
                key={o.id}
                className="flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link href={`/raffles/${o.raffle_slug}`} className="block truncate font-medium hover:underline">
                    {o.raffle_title}
                  </Link>
                  <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                    {o.amount} {o.currency} · {o.status}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-[44px] w-full shrink-0 touch-manipulation sm:w-auto"
                  disabled={buyoutRefundLoadingId === o.id}
                  onClick={async () => {
                    setBuyoutRefundLoadingId(o.id)
                    setClaimActionError(null)
                    try {
                      const res = await fetch(
                        `/api/raffles/${encodeURIComponent(o.raffle_id)}/buyout/offers/${encodeURIComponent(o.id)}/refund`,
                        {
                          method: 'POST',
                          credentials: 'include',
                          headers: { 'X-Connected-Wallet': walletAddr },
                        },
                      )
                      const json = await res.json().catch(() => ({}))
                      if (!res.ok) {
                        setClaimActionError(typeof json?.error === 'string' ? json.error : 'Refund failed')
                        return
                      }
                      await loadDashboard({ silent: true })
                    } catch (e) {
                      setClaimActionError(e instanceof Error ? e.message : 'Refund failed')
                    } finally {
                      setBuyoutRefundLoadingId(null)
                    }
                  }}
                >
                  {buyoutRefundLoadingId === o.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      Sending…
                    </>
                  ) : (
                    'Claim refund'
                  )}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {creatorRefundRaffles.length > 0 && (
        <Card className="rounded-xl border-amber-500/30 bg-amber-500/5 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Minimum not met — refunds (my raffles)</CardTitle>
            <CardDescription>
              Raffles that did not reach the draw threshold after the extension. New raffles collect ticket payments in
              platform funds escrow by default, so buyers can claim refunds on-chain without you paying out manually.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {legacyCreatorRefundRaffles.length > 0 && (
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.08] p-3">
                  <p className="text-sm font-medium text-foreground">Legacy refunds — host payout list</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    These raffles used the older flow where ticket payments went to you and the treasury (not the funds
                    escrow wallet). The platform may still issue some refunds from the funds escrow wallet on your behalf.
                    Before you send anything manually, confirm with support or Owl Vision so you do not double-pay. If you
                    are the one paying out,                     send{' '}
                    <span className="text-foreground font-medium">one separate transaction per line below</span> (not one
                    combined transfer for the total). You can copy the payout script into your
                    wallet app or notes.
                  </p>
                </div>
                {legacyCreatorRefundRaffles.map((rr) => {
                  const payoutScript = rr.candidates
                    .filter((c) => c.pendingAmount > 0)
                    .map(
                      (c, i) =>
                        `${i + 1}. Send ${c.pendingAmount.toFixed(rr.currency === 'USDC' ? 2 : 6)} ${rr.currency} to ${c.wallet}`
                    )
                    .join('\n')
                  return (
                    <div key={rr.raffleId} className="rounded-lg border border-border/60 bg-background/50 p-3 space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <Link href={`/raffles/${rr.raffleSlug}`} className="font-medium hover:underline truncate">
                          {rr.raffleTitle}
                        </Link>
                        <span className="text-sm font-semibold tabular-nums">
                          Total owed (sum of lines): {rr.totalPending.toFixed(rr.currency === 'USDC' ? 2 : 6)}{' '}
                          {rr.currency}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                        disabled={!payoutScript}
                        onClick={async () => {
                          if (!payoutScript) return
                          try {
                            await navigator.clipboard.writeText(payoutScript)
                          } catch {
                            // best-effort only
                          }
                        }}
                      >
                        Copy payout script
                      </Button>
                      <div className="max-h-56 overflow-auto space-y-2">
                        {rr.candidates.map((c, idx) => (
                          <div key={`${rr.raffleId}-${c.wallet}`} className="rounded border border-border/50 bg-muted/30 p-2">
                            <p className="text-xs text-muted-foreground">Buyer #{idx + 1}</p>
                            <p className="text-xs font-mono break-all">{c.wallet}</p>
                            <p className="text-sm mt-1">
                              <span className="text-muted-foreground">Amount to send: </span>
                              <span className="font-mono font-semibold">
                                {c.pendingAmount.toFixed(rr.currency === 'USDC' ? 2 : 6)} {rr.currency}
                              </span>
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {escrowCreatorRefundRaffles.length > 0 && (
              <div className="space-y-3">
                <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                  <p className="text-sm font-medium text-foreground">Funds escrow — buyers claim</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Ticket payments for these raffles sit in the platform funds escrow wallet. Buyers tap{' '}
                    <span className="text-foreground font-medium">Claim refund</span> on the raffle page (or their
                    dashboard). You do not need to send these amounts manually.
                  </p>
                </div>
                {escrowCreatorRefundRaffles.map((rr) => (
                  <div key={rr.raffleId} className="rounded-lg border border-border/60 bg-background/50 p-3 space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <Link href={`/raffles/${rr.raffleSlug}`} className="font-medium hover:underline truncate">
                        {rr.raffleTitle}
                      </Link>
                      <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                        Outstanding (escrow):{' '}
                        {rr.totalPending.toFixed(rr.currency === 'USDC' ? 2 : 6)} {rr.currency}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {rr.candidates.filter((c) => c.pendingAmount > 0).length} buyer
                      {rr.candidates.filter((c) => c.pendingAmount > 0).length !== 1 ? 's' : ''} still owed — they claim
                      from escrow.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      </TabsContent>
      <TabsContent value="winnings" className="mt-0 space-y-6 focus-visible:outline-none">
      <Card className="mb-0 rounded-xl border-green-500/25 bg-green-500/[0.04] shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Gift className="h-5 w-5 shrink-0" />
            Prizes & giveaways
          </CardTitle>
          <CardDescription>
            NFT raffle wins, team giveaways, and community pool prizes — signed-in with this wallet.
          </CardDescription>
          <details className="mt-2 rounded-lg border border-border/50 bg-background/50 text-sm">
            <summary className="cursor-pointer px-3 py-2 font-medium touch-manipulation">What you can claim here</summary>
            <p className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
              Creator ticket proceeds are claimed from the Hosting tab (live claim tracker). This tab focuses on prizes
              you won or giveaways assigned to you.
            </p>
          </details>
        </CardHeader>
        <CardContent className="space-y-6">
          {claimActionError && (
            <p className="text-sm text-destructive" role="alert">
              {claimActionError}
            </p>
          )}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Creator proceeds (your raffles)</p>
            {pendingCreatorFundClaims.length > 0 ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
                <p>
                  {pendingCreatorFundClaims.length} raffle
                  {pendingCreatorFundClaims.length === 1 ? '' : 's'} ready to claim from funds escrow. Claim from the{' '}
                  <button
                    type="button"
                    className="font-medium text-primary underline-offset-4 hover:underline touch-manipulation"
                    onClick={() => setDashboardTabFromUi('hosting')}
                  >
                    Hosting
                  </button>{' '}
                  tab → <span className="font-medium text-foreground">Live claim tracker</span> (same list as here, with
                  live totals).
                </p>
              </div>
            ) : creatorRafflesEndedAwaitingDraw.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Nothing to claim yet: these raffles are past their end time but still need a winner draw before
                  proceeds unlock. Open the raffle (or wait ~15 minutes for the automatic draw).
                </p>
                <ul className="text-sm space-y-1">
                  {creatorRafflesEndedAwaitingDraw.slice(0, 6).map((r) => (
                    <li key={r.id}>
                      <Link href={`/raffles/${r.slug}`} className="text-primary font-medium hover:underline">
                        {r.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : liveEscrowRaffles.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                You have ticket sales in funds escrow, but the raffle has not finished yet (or the winner draw has not
                run). The claim button appears here only after the end time passes and a winner is drawn.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing to claim here right now. After a raffle you created has settled (winner drawn and payout amounts
                recorded), and it used ticket payments to the funds escrow, your net proceeds will show with a claim
                button.
              </p>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Giveaway NFTs</p>
            <p className="text-xs text-muted-foreground mb-3">
              One-off drops from the team: when the prize is verified in escrow, claim here with this wallet (same as
              sign-in). The eligible wallet on the giveaway must match this signed-in wallet. On mobile, use Wi‑Fi or
              solid data and a reliable RPC if claim fails once.
            </p>
            {(Array.isArray(data.nftGiveaways) ? data.nftGiveaways : []).length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed border-border/70 p-3">
                No giveaways for this wallet yet. If you were sent a link, open{' '}
                <span className="font-medium text-foreground">/giveaway/…</span> and make sure you connect and sign in
                with the wallet the team set as eligible.
              </p>
            ) : (
              <ul className="space-y-3">
                {(Array.isArray(data.nftGiveaways) ? data.nftGiveaways : []).map((g) => {
                  const claimed = Boolean(g.claimed_at)
                  const ready = Boolean(g.prize_deposited_at) && !claimed
                  const label = g.title?.trim() || 'Giveaway NFT'
                  const mint = typeof g.nft_mint_address === 'string' ? g.nft_mint_address.trim() : ''
                  return (
                    <li
                      key={g.id}
                      className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between border-b border-border/40 pb-3 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium truncate">{label}</p>
                        <p className="text-xs text-muted-foreground break-all">
                          Asset:{' '}
                          {mint ? (
                            <a
                              href={solscanTokenUrl(mint)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              {formatMintForDisplay(mint)}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {g.prize_standard ? (
                            <span className="text-muted-foreground"> · {g.prize_standard}</span>
                          ) : null}
                        </p>
                        {!g.prize_deposited_at && (
                          <p className="text-xs text-muted-foreground">
                            Waiting for the team to confirm the deposit to escrow.
                          </p>
                        )}
                        {claimed && g.claim_tx_signature && (
                          <a
                            href={solscanTxUrl(g.claim_tx_signature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View claim transaction
                          </a>
                        )}
                        <Link
                          href={`/giveaway/${g.id}`}
                          className="text-xs text-muted-foreground hover:text-foreground hover:underline inline-block"
                        >
                          Open giveaway page (share link)
                        </Link>
                      </div>
                      <div className="shrink-0 w-full sm:w-auto">
                        {ready ? (
                          <Button
                            type="button"
                            size="sm"
                            className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                            disabled={claimGiveawayLoadingId === g.id}
                            onClick={() => handleClaimGiveaway(g.id)}
                          >
                            {claimGiveawayLoadingId === g.id ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Claiming…
                              </>
                            ) : (
                              <>
                                <Gift className="h-4 w-4 mr-2" />
                                Claim NFT
                              </>
                            )}
                          </Button>
                        ) : claimed ? (
                          <p className="text-sm text-muted-foreground py-2">Claimed</p>
                        ) : (
                          <p className="text-sm text-muted-foreground py-2">Not ready</p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Community giveaway wins</p>
            <p className="text-xs text-muted-foreground mb-3">
              Pool giveaways you won after a draw: claim sends the NFT from escrow to this wallet (same as sign-in).
            </p>
            {(Array.isArray(data.communityGiveaways) ? data.communityGiveaways : []).length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed border-border/70 p-3">
                No community giveaway wins for this wallet yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {(Array.isArray(data.communityGiveaways) ? data.communityGiveaways : []).map((g) => {
                  const claimed = Boolean(g.claimed_at)
                  const ready =
                    g.status === 'drawn' && Boolean(g.prize_deposited_at) && Boolean(g.winner_wallet) && !claimed
                  const label = g.title?.trim() || 'Community giveaway'
                  const mint = typeof g.nft_mint_address === 'string' ? g.nft_mint_address.trim() : ''
                  return (
                    <li
                      key={g.id}
                      className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between border-b border-border/40 pb-3 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium truncate">{label}</p>
                        <p className="text-xs text-muted-foreground break-all">
                          Asset:{' '}
                          {mint ? (
                            <a
                              href={solscanTokenUrl(mint)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              {formatMintForDisplay(mint)}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {g.prize_standard ? (
                            <span className="text-muted-foreground"> · {g.prize_standard}</span>
                          ) : null}
                        </p>
                        {!g.prize_deposited_at && (
                          <p className="text-xs text-muted-foreground">
                            Waiting for the team to confirm the deposit to escrow.
                          </p>
                        )}
                        {g.status === 'open' && (
                          <p className="text-xs text-muted-foreground">Draw not run yet — check back after the host draws.</p>
                        )}
                        {claimed && g.claim_tx_signature && (
                          <a
                            href={solscanTxUrl(g.claim_tx_signature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View claim transaction
                          </a>
                        )}
                        <Link
                          href={`/community-giveaway/${g.id}`}
                          className="text-xs text-muted-foreground hover:text-foreground hover:underline inline-block"
                        >
                          Open community giveaway page
                        </Link>
                      </div>
                      <div className="shrink-0 w-full sm:w-auto">
                        {ready ? (
                          <Button
                            type="button"
                            size="sm"
                            className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                            disabled={claimCommunityGiveawayLoadingId === g.id}
                            onClick={() => handleClaimCommunityGiveaway(g.id)}
                          >
                            {claimCommunityGiveawayLoadingId === g.id ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Claiming…
                              </>
                            ) : (
                              <>
                                <Gift className="h-4 w-4 mr-2" />
                                Claim NFT
                              </>
                            )}
                          </Button>
                        ) : claimed ? (
                          <p className="text-sm text-muted-foreground py-2">Claimed</p>
                        ) : (
                          <p className="text-sm text-muted-foreground py-2">Not ready</p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Raffle winners (NFT prizes)</p>
            {nftPrizeDashboardRows.length > 0 ? (
              <ul className="space-y-3">
                {nftPrizeDashboardRows.map(({ raffle, prizeState, claimedTx }) => (
                  <li
                    key={raffle.id}
                    className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between border-b border-border/40 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0 space-y-1">
                      <Link href={`/raffles/${raffle.slug}`} className="font-medium hover:underline truncate block">
                        {raffle.title}
                      </Link>
                      {prizeState === 'waiting' && (
                        <p className="text-xs text-muted-foreground">
                          Prize not ready to claim yet (waiting for verified escrow deposit or raffle to finish). Open the
                          raffle page for status.
                        </p>
                      )}
                      {prizeState === 'returned' && (
                        <p className="text-xs text-muted-foreground">
                          This prize was returned to the creator and is no longer claimable.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 shrink-0 w-full sm:w-auto sm:items-center">
                      {prizeState === 'claimable' ? (
                        <Button
                          type="button"
                          size="sm"
                          className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                          disabled={claimPrizeLoadingId === raffle.id}
                          onClick={() => handleClaimPrize(raffle.id)}
                        >
                          {claimPrizeLoadingId === raffle.id ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Claiming…
                            </>
                          ) : (
                            <>
                              <Gift className="h-4 w-4 mr-2" />
                              Claim raffle prize
                            </>
                          )}
                        </Button>
                      ) : prizeState === 'claimed' && claimedTx ? (
                        <Button type="button" variant="outline" size="sm" className="min-h-[44px] w-full sm:w-auto" asChild>
                          <a href={solscanTxUrl(claimedTx)} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-2" />
                            View prize transfer
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No NFT wins to show yet. When you win an NFT raffle and the prize is in escrow, a claim button will
                appear here.
              </p>
            )}
          </div>
          {cryptoPrizeWinRows.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-2">Raffle winners (crypto / SPL prizes)</p>
              <ul className="space-y-3">
                {cryptoPrizeWinRows.map((raffle) => (
                  <li key={raffle.id} className="rounded-lg border border-border/50 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <Link href={`/raffles/${raffle.slug}`} className="text-sm font-medium hover:underline truncate block">
                          {raffle.title}
                        </Link>
                        <span className="text-sm text-muted-foreground">
                          Prize: {Number(raffle.prize_amount ?? 0).toFixed(raffle.prize_currency === 'USDC' ? 2 : 4)}{' '}
                          {raffle.prize_currency ?? 'token'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {canClaimEscrowPrize(raffle as EntryWithRaffle['raffle'], wallet) && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="min-h-[44px] touch-manipulation"
                            disabled={claimPrizeLoadingId === raffle.id}
                            onClick={() => handleClaimPrize(raffle.id)}
                          >
                            {claimPrizeLoadingId === raffle.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Gift className="h-4 w-4 mr-1" />
                                Claim prize
                              </>
                            )}
                          </Button>
                        )}
                        {raffle.nft_transfer_transaction?.trim() && (
                          <Button type="button" variant="outline" size="sm" className="min-h-[44px]" asChild>
                            <a href={solscanTxUrl(raffle.nft_transfer_transaction.trim())} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4 mr-1" />
                              Prize tx
                            </a>
                          </Button>
                        )}
                        <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" asChild>
                          <Link href={`/raffles/${raffle.slug}`}>Open</Link>
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>


      <Card className="rounded-xl border-border/60 shadow-sm">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-5 w-5" />
              My entries
            </CardTitle>
            <CardDescription>Raffles you entered ({raffleSummaries.length})</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="entries-filter" className="text-muted-foreground whitespace-nowrap">
              Show
            </label>
            <select
              id="entries-filter"
              value={entriesFilter}
              onChange={(e) => setEntriesFilter(e.target.value as 'all' | 'won')}
              className="min-h-[44px] min-w-[10rem] touch-manipulation rounded-lg border border-border/60 bg-background px-3 py-2 text-sm shadow-sm"
            >
              <option value="all">All entries</option>
              <option value="won">Wins only</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {raffleSummaries.length === 0 ? (
            <p className="text-muted-foreground">
              {myEntries.length === 0
                ? 'You haven’t entered any raffles yet.'
                : 'No entries match this filter.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {raffleSummariesPage.map(({ raffle, totalTickets, referredByLabels }) => {
                const refLabels = referredByLabels ?? []
                const uniqueRef = [...new Set(refLabels)]
                return (
                  <li
                    key={raffle.id}
                    className="border-b border-border/50 last:border-0"
                  >
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-4 py-2 text-left"
                    >
                      <span className="flex min-w-0 flex-col">
                        <Link
                          href={`/raffles/${raffle.slug}`}
                          className="font-medium hover:underline truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {raffle.title}
                        </Link>
                        {uniqueRef.length > 0 ? (
                          <span className="text-xs text-muted-foreground font-normal mt-0.5">
                            Referred by{' '}
                            {uniqueRef.length === 1
                              ? uniqueRef[0]
                              : uniqueRef.length === 2
                                ? `${uniqueRef[0]}, ${uniqueRef[1]}`
                                : `${uniqueRef.slice(0, 2).join(', ')}…`}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex flex-col items-end gap-2 shrink-0 text-sm text-muted-foreground sm:flex-row sm:items-center">
                        <span className="flex items-center gap-2">
                          {totalTickets} ticket
                          {totalTickets !== 1 ? 's' : ''}
                          {raffle.winner_wallet === wallet && (
                            <span className="text-green-600 font-medium">You won</span>
                          )}
                        </span>
                        <span className="flex flex-wrap items-center justify-end gap-2">
                          {raffle.winner_wallet === wallet &&
                            raffle.prize_type === 'nft' &&
                            canClaimEscrowPrize(raffle as EntryWithRaffle['raffle'], wallet) && (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="touch-manipulation min-h-[44px] h-9"
                                disabled={claimPrizeLoadingId === raffle.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleClaimPrize(raffle.id)
                                }}
                              >
                                {claimPrizeLoadingId === raffle.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Gift className="h-4 w-4 mr-1" />
                                    Claim prize
                                  </>
                                )}
                              </Button>
                            )}
                          {raffle.winner_wallet === wallet &&
                            raffle.prize_type === 'nft' &&
                            raffle.nft_transfer_transaction?.trim() && (
                              <Button type="button" variant="outline" size="sm" className="h-9 min-h-[44px]" asChild>
                                <a
                                  href={solscanTxUrl(raffle.nft_transfer_transaction.trim())}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink className="h-4 w-4 mr-1" />
                                  Prize tx
                                </a>
                              </Button>
                            )}
                          <Link
                            href={`/raffles/${raffle.slug}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex"
                          >
                            <ExternalLink className="h-4 w-4 hover:text-foreground" />
                          </Link>
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {raffleSummaries.length > MY_ENTRIES_PAGE_SIZE && (
            <div className="mt-4 flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing{' '}
                {entriesPageSafe * MY_ENTRIES_PAGE_SIZE + 1}–
                {Math.min(
                  (entriesPageSafe + 1) * MY_ENTRIES_PAGE_SIZE,
                  raffleSummaries.length
                )}{' '}
                of {raffleSummaries.length}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch-manipulation min-h-[44px] flex-1 sm:flex-initial"
                  disabled={entriesPageSafe <= 0}
                  onClick={() => setEntriesPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4 shrink-0" aria-hidden />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch-manipulation min-h-[44px] flex-1 sm:flex-initial"
                  disabled={entriesPageSafe >= entriesListMaxPage}
                  onClick={() =>
                    setEntriesPage((p) => Math.min(entriesListMaxPage, p + 1))
                  }
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4 shrink-0" aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </TabsContent>
      </Tabs>
      </div>
      {claimPrizeSuccessTx && (
        <div className="fixed inset-x-0 bottom-3 z-50 px-3 safe-area-bottom pointer-events-none">
          <div className="mx-auto max-w-xl rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-3 shadow-lg pointer-events-auto">
            <div className="flex items-start gap-3">
              <Check className="mt-0.5 h-5 w-5 text-emerald-500 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">Prize claimed successfully</p>
                <p className="text-xs text-muted-foreground break-all">
                  Tx: {claimPrizeSuccessTx}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="secondary" className="min-h-[44px]" asChild>
                    <a href={solscanTxUrl(claimPrizeSuccessTx)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1" />
                      View on Solscan
                    </a>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-[44px]"
                    onClick={() => setClaimPrizeSuccessTx(null)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

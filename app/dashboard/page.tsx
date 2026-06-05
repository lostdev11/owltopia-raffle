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
import {
  canCreatorClaimPrizeBackFromEscrow,
  needsPayCancellationFeeBeforePrizeReturn,
} from '@/lib/raffles/creator-prize-return-eligibility'
import type { CommunityGiveaway, NftGiveaway, Raffle as FullRaffle, RaffleMilestone } from '@/lib/types'
import {
  formatMilestonePrize,
  milestoneWinnerModeLabel,
} from '@/lib/raffles/milestones/copy'
import type { MilestoneBonusWinRow } from '@/lib/db/raffle-milestones'
import {
  getEmptyEngagementPayload,
  type DashboardEngagementPayload,
} from '@/lib/xp/engagement-payload'
import { CreatorAnalyticsSection } from '@/components/dashboard/CreatorAnalyticsSection'
import { DashboardOverviewSection } from '@/components/dashboard/DashboardOverviewSection'
import { DashboardCollapsible } from '@/components/dashboard/DashboardCollapsible'
import { HostingClaimTracker } from '@/components/dashboard/hosting/HostingClaimTracker'
import { HostingQuickStats } from '@/components/dashboard/hosting/HostingQuickStats'
import { HostingStatusBadge } from '@/components/dashboard/hosting/HostingStatusBadge'
import { myRaffleStatusLabel } from '@/components/dashboard/hosting/helpers'
import { ReferralRewardsRedeem } from '@/components/dashboard/ReferralRewardsRedeem'
import { ReferralCodeCopyRow } from '@/components/referrals/ReferralCodeCopyRow'
import { ClaimSuccessOverlay } from '@/components/ClaimSuccessOverlay'
import { extractTransactionSignature } from '@/lib/claims/extract-transaction-signature'
import {
  getEscrowPrizeClaimSuccessCopy,
  GIVEAWAY_NFT_CLAIM_SUCCESS_DETAIL,
} from '@/lib/raffles/claim-prize-success-copy'

type FeeTier = { feeBps: number; reason: string }
type Raffle = {
  id: string
  slug: string
  title: string
  status: string | null
  start_time?: string
  /** Used with {@link hasExhaustedMinThresholdTimeExtensions} for creator prize-return eligibility when status lags. */
  time_extension_count?: number | null
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
  nft_token_id?: string | null
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

/** Live / ready listing: cancellation was requested but post-start fee not recorded yet. */
function needsPayCancellationStraggler(raffle: Raffle): boolean {
  const s = (raffle.status ?? '').toLowerCase()
  if (s !== 'live' && s !== 'ready_to_draw') return false
  if (!raffle.cancellation_requested_at) return false
  if (!raffle.start_time) return false
  if (!raffleRequiresCancellationFee(raffle as unknown as FullRaffle, new Date())) return false
  return !raffle.cancellation_fee_paid_at
}

function canClaimMilestoneBonus(milestone: RaffleMilestone): boolean {
  return milestone.status === 'awarded' && milestone.prize_type === 'crypto' && !milestone.claimed_at
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
  referralGrowth?: {
    monthlyCap: number
    monthlyUsed: number
    monthlyRemaining: number
    isHolder: boolean
    monthKey: string
    resetsAt: string
    pendingRewards: Array<{
      id: string
      reward_recipient_role: 'buyer' | 'referrer'
      referral_code: string
      issued_at: string
    }>
    eligibleRaffles: Array<{ id: string; slug: string; title: string }>
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
  milestoneBonusWins?: MilestoneBonusWinRow[]
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

type DashboardTabId = 'overview' | 'hosting' | 'analytics' | 'winnings' | 'account'

function parseDashboardTabParam(value: string | null): DashboardTabId | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (
    raw === 'overview' ||
    raw === 'hosting' ||
    raw === 'analytics' ||
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
  const [claimMilestoneLoadingId, setClaimMilestoneLoadingId] = useState<string | null>(null)
  const [claimFailedMinPrizeReturnLoadingId, setClaimFailedMinPrizeReturnLoadingId] = useState<string | null>(null)
  const [payCancelFeeLoadingId, setPayCancelFeeLoadingId] = useState<string | null>(null)
  const [claimGiveawayLoadingId, setClaimGiveawayLoadingId] = useState<string | null>(null)
  const [claimCommunityGiveawayLoadingId, setClaimCommunityGiveawayLoadingId] = useState<string | null>(
    null
  )
  const [claimRefundLoadingEntryId, setClaimRefundLoadingEntryId] = useState<string | null>(null)
  const [isClaimingAllRefunds, setIsClaimingAllRefunds] = useState(false)
  const [claimOfferRefundLoadingId, setClaimOfferRefundLoadingId] = useState<string | null>(null)
  const [isClaimingAllOfferRefunds, setIsClaimingAllOfferRefunds] = useState(false)
  const [buyoutRefundLoadingId, setBuyoutRefundLoadingId] = useState<string | null>(null)
  const [isClaimingAllBuyoutRefunds, setIsClaimingAllBuyoutRefunds] = useState(false)
  const [claimActionError, setClaimActionError] = useState<string | null>(null)
  const [claimSuccess, setClaimSuccess] = useState<{
    tx: string
    title: string
    slug: string
    winnerWallet: string
    heading: string
    message: string
    showWinnerPng?: boolean
  } | null>(null)
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
  const myEntriesDetailsRef = useRef<HTMLDetailsElement>(null)
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

  const presentClaimSuccess = useCallback(
    (params: {
      tx?: string | null
      title: string
      slug?: string
      heading: string
      message: string
      winnerWallet?: string
      showWinnerPng?: boolean
    }) => {
      setClaimSuccess({
        tx: params.tx?.trim() ?? '',
        title: params.title,
        slug: params.slug?.trim() || 'dashboard',
        winnerWallet: params.winnerWallet?.trim() || walletAddr.trim(),
        heading: params.heading,
        message: params.message,
        showWinnerPng: params.showWinnerPng ?? false,
      })
    },
    [walletAddr]
  )

  const handleClaimProceeds = useCallback(
    async (raffleId: string) => {
      const raffle =
        (Array.isArray(data?.myRaffles) ? data.myRaffles : []).find((x) => x.id === raffleId) ?? null
      setClaimActionError(null)
      setClaimSuccess(null)
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
        const alreadyClaimed = (json as { alreadyClaimed?: boolean }).alreadyClaimed === true
        presentClaimSuccess({
          tx: extractTransactionSignature(json),
          title: raffle?.title ?? 'Raffle proceeds',
          slug: raffle?.slug ?? raffleId,
          heading: alreadyClaimed ? 'Proceeds already claimed' : 'Proceeds claimed!',
          message: alreadyClaimed
            ? 'Creator proceeds were already sent to your wallet.'
            : 'Net ticket proceeds were sent to your wallet.',
        })
        await loadDashboard({ silent: true })
      } finally {
        setClaimProceedsLoadingId(null)
      }
    },
    [data?.myRaffles, loadDashboard, presentClaimSuccess]
  )

  const handleClaimPrize = useCallback(
    async (raffle: {
      id: string
      slug: string
      title: string
      winner_wallet?: string | null
      prize_type?: string | null
      prize_currency?: string | null
    }) => {
      setClaimActionError(null)
      setClaimSuccess(null)
      setClaimPrizeLoadingId(raffle.id)
      try {
        const res = await fetch(`/api/raffles/${raffle.id}/claim-prize`, {
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
        const alreadyClaimed = (json as { alreadyClaimed?: boolean }).alreadyClaimed === true
        presentClaimSuccess({
          tx: extractTransactionSignature(json),
          title: raffle.title,
          slug: raffle.slug,
          winnerWallet: raffle.winner_wallet?.trim() ?? walletAddr,
          heading: alreadyClaimed ? 'Prize already sent' : 'Prize claimed!',
          message: alreadyClaimed
            ? getEscrowPrizeClaimSuccessCopy({
                prize_type: (raffle.prize_type ?? 'nft') as 'crypto' | 'nft',
                prize_currency: raffle.prize_currency ?? null,
              }).alreadySentDetail
            : getEscrowPrizeClaimSuccessCopy({
                prize_type: (raffle.prize_type ?? 'nft') as 'crypto' | 'nft',
                prize_currency: raffle.prize_currency ?? null,
              }).sentDetail,
          showWinnerPng: true,
        })
        await loadDashboard({ silent: true })
      } finally {
        setClaimPrizeLoadingId(null)
      }
    },
    [loadDashboard, presentClaimSuccess, walletAddr]
  )

  const handleClaimMilestoneBonus = useCallback(
    async (row: MilestoneBonusWinRow) => {
      setClaimActionError(null)
      setClaimSuccess(null)
      setClaimMilestoneLoadingId(row.milestone.id)
      try {
        const res = await fetch(
          `/api/raffles/${row.raffleId}/milestones/${row.milestone.id}/claim`,
          { method: 'POST', credentials: 'include' }
        )
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not claim bonus prize'
          )
          return
        }
        presentClaimSuccess({
          tx: extractTransactionSignature(json),
          title: row.raffleTitle,
          slug: row.raffleSlug,
          heading: 'Bonus prize claimed!',
          message: `${formatMilestonePrize(row.milestone)} was sent to your wallet.`,
        })
        await loadDashboard({ silent: true })
      } finally {
        setClaimMilestoneLoadingId(null)
      }
    },
    [loadDashboard, presentClaimSuccess]
  )

  const handleClaimFailedMinPrizeReturn = useCallback(
    async (raffleId: string) => {
      const raffle =
        (Array.isArray(data?.myRaffles) ? data.myRaffles : []).find((x) => x.id === raffleId) ?? null
      setClaimActionError(null)
      setClaimSuccess(null)
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
        const alreadyReturned = (json as { alreadyReturned?: boolean }).alreadyReturned === true
        presentClaimSuccess({
          tx: extractTransactionSignature(json),
          title: raffle?.title ?? 'Raffle prize',
          slug: raffle?.slug ?? raffleId,
          heading: alreadyReturned ? 'Prize already returned' : 'Prize returned!',
          message: alreadyReturned
            ? 'Your escrowed prize was already sent back to your wallet.'
            : 'Your escrowed prize was sent back to your wallet.',
        })
        await loadDashboard({ silent: true })
      } finally {
        setClaimFailedMinPrizeReturnLoadingId(null)
      }
    },
    [data?.myRaffles, loadDashboard, presentClaimSuccess]
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
        let lastError = 'Could not record cancellation fee'
        let ok = false
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const res = await fetch(path, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ feeTransactionSignature: sig }),
            })
            const json = await res.json().catch(() => ({}))
            if (res.ok) {
              ok = true
              break
            }
            lastError =
              typeof (json as { error?: string }).error === 'string'
                ? (json as { error: string }).error
                : lastError
            if (res.status < 500 && res.status !== 429) break
          } catch (e) {
            lastError = e instanceof Error ? e.message : lastError
          }
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
          }
        }
        if (!ok) {
          setClaimActionError(lastError)
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
    async (g: NftGiveaway) => {
      if (!publicKey) return
      setClaimActionError(null)
      setClaimSuccess(null)
      setClaimGiveawayLoadingId(g.id)
      try {
        const addr = publicKey.toBase58()
        const res = await fetch(`/api/me/nft-giveaways/${g.id}/claim`, {
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
        presentClaimSuccess({
          tx: extractTransactionSignature(json),
          title: g.title?.trim() || 'Giveaway NFT',
          slug: `giveaway-${g.id}`,
          winnerWallet: (g.eligible_wallet ?? addr).trim(),
          heading: 'NFT claimed!',
          message: GIVEAWAY_NFT_CLAIM_SUCCESS_DETAIL,
          showWinnerPng: true,
        })
        await loadDashboard({ silent: true })
      } finally {
        setClaimGiveawayLoadingId(null)
      }
    },
    [loadDashboard, presentClaimSuccess, publicKey]
  )

  const handleClaimCommunityGiveaway = useCallback(
    async (g: CommunityGiveaway) => {
      if (!publicKey) return
      setClaimActionError(null)
      setClaimSuccess(null)
      setClaimCommunityGiveawayLoadingId(g.id)
      try {
        const addr = publicKey.toBase58()
        const res = await fetch(`/api/me/community-giveaways/${g.id}/claim`, {
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
        presentClaimSuccess({
          tx: extractTransactionSignature(json),
          title: g.title?.trim() || 'Community giveaway',
          slug: `community-giveaway-${g.id}`,
          winnerWallet: (g.winner_wallet ?? addr).trim(),
          heading: 'NFT claimed!',
          message: GIVEAWAY_NFT_CLAIM_SUCCESS_DETAIL,
          showWinnerPng: true,
        })
        await loadDashboard({ silent: true })
      } finally {
        setClaimCommunityGiveawayLoadingId(null)
      }
    },
    [loadDashboard, presentClaimSuccess, publicKey]
  )

  const handleClaimRefund = useCallback(
    async (entryId: string) => {
      const row = (Array.isArray(data?.myEntries) ? data.myEntries : []).find(
        (x) => x.entry.id === entryId
      )
      setClaimActionError(null)
      setClaimSuccess(null)
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
        const alreadyRefunded = (json as { alreadyRefunded?: boolean }).alreadyRefunded === true
        const amount = row ? Number(row.entry.amount_paid) : null
        const currency = row?.entry.currency
        const amountLabel =
          amount != null && currency
            ? `${amount.toFixed(currency === 'USDC' ? 2 : 4)} ${currency}`
            : 'Your ticket payment'
        presentClaimSuccess({
          tx: extractTransactionSignature(json),
          title: row?.raffle.title ?? 'Ticket refund',
          slug: row?.raffle.slug ?? 'dashboard',
          heading: alreadyRefunded ? 'Refund already sent' : 'Refund claimed!',
          message: alreadyRefunded
            ? `${amountLabel} was already returned to your wallet.`
            : `${amountLabel} was sent back to your wallet.`,
        })
        await loadDashboard({ silent: true })
      } finally {
        setClaimRefundLoadingEntryId(null)
      }
    },
    [data?.myEntries, loadDashboard, presentClaimSuccess]
  )

  const handleClaimAllRefunds = useCallback(
    async (entryIds: string[]) => {
      if (entryIds.length === 0) return
      setClaimActionError(null)
      setClaimSuccess(null)
      setIsClaimingAllRefunds(true)
      let claimed = 0
      let lastTx: string | null = null
      try {
        for (const entryId of entryIds) {
          setClaimRefundLoadingEntryId(entryId)
          const res = await fetch('/api/entries/claim-refund', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ entryId }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok) {
            const base =
              typeof (json as { error?: string }).error === 'string'
                ? (json as { error: string }).error
                : 'Could not claim refund'
            setClaimActionError(
              claimed > 0 ? `${base} (${claimed} refund${claimed === 1 ? '' : 's'} claimed before this.)` : base
            )
            return
          }
          lastTx = extractTransactionSignature(json) ?? lastTx
          claimed++
        }
        presentClaimSuccess({
          tx: lastTx,
          title: 'Ticket refunds',
          slug: 'dashboard',
          heading: 'Refunds claimed!',
          message: `${claimed} ticket refund${claimed === 1 ? '' : 's'} sent to your wallet.`,
        })
        await loadDashboard({ silent: true })
      } finally {
        setClaimRefundLoadingEntryId(null)
        setIsClaimingAllRefunds(false)
      }
    },
    [loadDashboard, presentClaimSuccess]
  )

  const handleClaimOfferRefund = useCallback(
    async (offerId: string) => {
      const offer = (Array.isArray(data?.offerRefundCandidates) ? data.offerRefundCandidates : []).find(
        (x) => x.offerId === offerId
      )
      setClaimActionError(null)
      setClaimSuccess(null)
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
        const amountLabel =
          offer != null
            ? `${Number(offer.amount).toFixed(offer.currency === 'USDC' ? 2 : 4)} ${offer.currency}`
            : 'Your bid deposit'
        presentClaimSuccess({
          tx: extractTransactionSignature(json),
          title: offer?.raffleTitle ?? 'Offer refund',
          slug: offer?.raffleSlug ?? 'dashboard',
          heading: 'Offer refund claimed!',
          message: `${amountLabel} was sent back to your wallet.`,
        })
        await loadDashboard({ silent: true })
      } finally {
        setClaimOfferRefundLoadingId(null)
      }
    },
    [data?.offerRefundCandidates, loadDashboard, presentClaimSuccess]
  )

  const handleClaimAllOfferRefunds = useCallback(
    async (offerIds: string[]) => {
      if (offerIds.length === 0) return
      setClaimActionError(null)
      setClaimSuccess(null)
      setIsClaimingAllOfferRefunds(true)
      let claimed = 0
      let lastTx: string | null = null
      try {
        for (const offerId of offerIds) {
          setClaimOfferRefundLoadingId(offerId)
          const res = await fetch(`/api/me/raffle-offers/${offerId}/claim-refund`, {
            method: 'POST',
            credentials: 'include',
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok) {
            const base =
              typeof (json as { error?: string }).error === 'string'
                ? (json as { error: string }).error
                : 'Could not claim offer refund'
            setClaimActionError(
              claimed > 0 ? `${base} (${claimed} refund${claimed === 1 ? '' : 's'} claimed before this.)` : base
            )
            return
          }
          lastTx = extractTransactionSignature(json) ?? lastTx
          claimed++
        }
        presentClaimSuccess({
          tx: lastTx,
          title: 'Offer refunds',
          slug: 'dashboard',
          heading: 'Offer refunds claimed!',
          message: `${claimed} offer bid refund${claimed === 1 ? '' : 's'} sent to your wallet.`,
        })
        await loadDashboard({ silent: true })
      } finally {
        setClaimOfferRefundLoadingId(null)
        setIsClaimingAllOfferRefunds(false)
      }
    },
    [loadDashboard, presentClaimSuccess]
  )

  const handleClaimBuyoutRefund = useCallback(
    async (offer: { id: string; raffle_id: string }) => {
      const meta = (Array.isArray(data?.buyoutOffers) ? data.buyoutOffers : []).find(
        (x) => x.id === offer.id
      )
      setClaimActionError(null)
      setClaimSuccess(null)
      setBuyoutRefundLoadingId(offer.id)
      try {
        const res = await fetch(
          `/api/raffles/${encodeURIComponent(offer.raffle_id)}/buyout/offers/${encodeURIComponent(offer.id)}/refund`,
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
        const amountLabel =
          meta != null
            ? `${Number(meta.amount).toFixed(meta.currency === 'USDC' ? 2 : 4)} ${meta.currency}`
            : 'Your buyout deposit'
        presentClaimSuccess({
          tx: extractTransactionSignature(json),
          title: meta?.raffle_title ?? 'Buyout refund',
          slug: meta?.raffle_slug ?? 'dashboard',
          heading: 'Buyout refund claimed!',
          message: `${amountLabel} was sent back to your wallet.`,
        })
        await loadDashboard({ silent: true })
      } catch (e) {
        setClaimActionError(e instanceof Error ? e.message : 'Refund failed')
      } finally {
        setBuyoutRefundLoadingId(null)
      }
    },
    [data?.buyoutOffers, loadDashboard, presentClaimSuccess, walletAddr]
  )

  const handleClaimAllBuyoutRefunds = useCallback(
    async (offers: { id: string; raffle_id: string }[]) => {
      if (offers.length === 0) return
      setClaimActionError(null)
      setClaimSuccess(null)
      setIsClaimingAllBuyoutRefunds(true)
      let claimed = 0
      let lastTx: string | null = null
      try {
        for (const offer of offers) {
          setBuyoutRefundLoadingId(offer.id)
          const res = await fetch(
            `/api/raffles/${encodeURIComponent(offer.raffle_id)}/buyout/offers/${encodeURIComponent(offer.id)}/refund`,
            {
              method: 'POST',
              credentials: 'include',
              headers: { 'X-Connected-Wallet': walletAddr },
            },
          )
          const json = await res.json().catch(() => ({}))
          if (!res.ok) {
            const base = typeof json?.error === 'string' ? json.error : 'Refund failed'
            setClaimActionError(
              claimed > 0 ? `${base} (${claimed} refund${claimed === 1 ? '' : 's'} claimed before this.)` : base
            )
            return
          }
          lastTx = extractTransactionSignature(json) ?? lastTx
          claimed++
        }
        presentClaimSuccess({
          tx: lastTx,
          title: 'Buyout refunds',
          slug: 'dashboard',
          heading: 'Buyout refunds claimed!',
          message: `${claimed} buyout deposit refund${claimed === 1 ? '' : 's'} sent to your wallet.`,
        })
        await loadDashboard({ silent: true })
      } catch (e) {
        setClaimActionError(e instanceof Error ? e.message : 'Refund failed')
      } finally {
        setBuyoutRefundLoadingId(null)
        setIsClaimingAllBuyoutRefunds(false)
      }
    },
    [loadDashboard, presentClaimSuccess, walletAddr]
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
    () => myRafflesForMemo.filter((r) => canCreatorClaimPrizeBackFromEscrow(r, walletForMemo)),
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

  const milestoneBonusWinRows = useMemo(
    () => (Array.isArray(data?.milestoneBonusWins) ? data.milestoneBonusWins : []),
    [data?.milestoneBonusWins]
  )

  const raffleSummaries = useMemo((): RaffleEntrySummary[] => {
    const sourceEntries =
      entriesFilter === 'won'
        ? myEntriesForMemo.filter(({ raffle }) => raffle.winner_wallet === walletForMemo)
        : myEntriesForMemo
    return Object.values(
      sourceEntries.reduce<Record<string, RaffleEntrySummary>>((acc, row) => {
        const { entry, raffle, referred_by_label } = row
        // Failed checkouts become `rejected` but used to be summed here → inflated "tickets" vs on-chain reality.
        if (entry.status === 'rejected') return acc
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

  const winsSectionDefaults = useMemo(() => {
    const giveaways = Array.isArray(data?.nftGiveaways) ? data.nftGiveaways : []
    const community = Array.isArray(data?.communityGiveaways) ? data.communityGiveaways : []
    const giveawayReady = giveaways.filter((g) => Boolean(g.prize_deposited_at) && !g.claimed_at).length
    const communityReady = community.filter(
      (g) =>
        g.status === 'drawn' &&
        Boolean(g.prize_deposited_at) &&
        Boolean(g.winner_wallet) &&
        !g.claimed_at
    ).length
    const nftClaimable = nftPrizeDashboardRows.filter((r) => r.prizeState === 'claimable').length
    const cryptoClaimable = cryptoPrizeWinRows.filter((r) =>
      canClaimEscrowPrize(r as EntryWithRaffle['raffle'], walletForMemo)
    ).length
    const milestoneClaimable = milestoneBonusWinRows.filter((r) =>
      canClaimMilestoneBonus(r.milestone)
    ).length

    return {
      creatorProceeds: pendingCreatorFundClaims.length > 0,
      giveaways: giveawayReady > 0,
      community: communityReady > 0,
      nftWins: nftClaimable > 0,
      cryptoWins: cryptoClaimable > 0,
      milestoneWins: milestoneClaimable > 0,
      myEntries: entriesFilter === 'won' || raffleSummaries.length <= 6,
      counts: {
        giveaways: giveaways.length,
        giveawayReady,
        community: community.length,
        communityReady,
        nftWins: nftPrizeDashboardRows.length,
        nftClaimable,
        cryptoWins: cryptoPrizeWinRows.length,
        cryptoClaimable,
        milestoneWins: milestoneBonusWinRows.length,
        milestoneClaimable,
      },
    }
  }, [
    data,
    nftPrizeDashboardRows,
    cryptoPrizeWinRows,
    milestoneBonusWinRows,
    pendingCreatorFundClaims.length,
    walletForMemo,
    entriesFilter,
    raffleSummaries.length,
  ])

  const overviewStats = useMemo(() => {
    let ticketsEntered = 0
    const enteredRaffles = new Set<string>()
    const winRaffles = new Set<string>()
    for (const { entry, raffle } of myEntriesForMemo) {
      if (entry.status === 'rejected') continue
      enteredRaffles.add(raffle.id)
      ticketsEntered += Number(entry.ticket_quantity) || 0
      if (raffle.winner_wallet?.trim() === walletForMemo.trim()) winRaffles.add(raffle.id)
    }
    const giveaways = Array.isArray(data?.nftGiveaways) ? data.nftGiveaways : []
    const community = Array.isArray(data?.communityGiveaways) ? data.communityGiveaways : []
    const giveawayReady = giveaways.filter((g) => Boolean(g.prize_deposited_at) && !g.claimed_at).length
    const communityReady = community.filter(
      (g) =>
        g.status === 'drawn' &&
        Boolean(g.prize_deposited_at) &&
        Boolean(g.winner_wallet) &&
        !g.claimed_at
    ).length
    const nftClaimable = nftPrizeDashboardRows.filter((r) => r.prizeState === 'claimable').length
    const cryptoClaimable = cryptoPrizeWinRows.filter((r) =>
      canClaimEscrowPrize(r as EntryWithRaffle['raffle'], walletForMemo)
    ).length
    const milestoneClaimable = milestoneBonusWinRows.filter((r) =>
      canClaimMilestoneBonus(r.milestone)
    ).length
    return {
      rafflesEntered: enteredRaffles.size,
      ticketsEntered,
      wins: winRaffles.size + milestoneBonusWinRows.length,
      hostedRaffles: myRafflesForMemo.length,
      pendingClaims: pendingCreatorFundClaims.length,
      prizesToClaim: giveawayReady + communityReady + nftClaimable + cryptoClaimable + milestoneClaimable,
    }
  }, [
    myEntriesForMemo,
    walletForMemo,
    myRafflesForMemo.length,
    pendingCreatorFundClaims.length,
    data,
    nftPrizeDashboardRows,
    cryptoPrizeWinRows,
    milestoneBonusWinRows,
  ])

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

  useLayoutEffect(() => {
    if (winsSectionDefaults.myEntries && myEntriesDetailsRef.current) {
      myEntriesDetailsRef.current.open = true
    }
  }, [winsSectionDefaults.myEntries])

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
      (x.raffle.status === 'failed_refund_available' ||
        x.raffle.status === 'pending_min_not_met' ||
        x.raffle.status === 'cancelled') &&
      x.entry.status === 'confirmed' &&
      !x.entry.refunded_at &&
      raffleUsesFundsEscrow(x.raffle)
  )

  /** Same terminal status but legacy row: migration 044 set funds-escrow off when entries already existed — no on-chain claim. */
  const legacyRefundEligibleEntries = myEntries.filter(
    (x) =>
      (x.raffle.status === 'failed_refund_available' ||
        x.raffle.status === 'pending_min_not_met') &&
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
      : isClaimingAllRefunds ? 'Claiming all ticket refunds...'
      : claimRefundLoadingEntryId ? 'Processing your ticket refund...'
      : isClaimingAllOfferRefunds ? 'Claiming all offer refunds...'
      : claimOfferRefundLoadingId ? 'Processing your offer refund...'
      : isClaimingAllBuyoutRefunds ? 'Claiming all buyout refunds...'
      : buyoutRefundLoadingId ? 'Processing buyout refund...'
      : payCancelFeeLoadingId ? 'Paying cancellation fee...'
      : null

  return (
    <main
      className={`relative mx-auto px-4 py-6 sm:py-10 safe-area-bottom ${dashboardTab === 'analytics' || dashboardTab === 'overview' ? 'max-w-6xl' : 'max-w-4xl'}`}
    >
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
        <Card
          id="ticket-refunds"
          className="mb-8 scroll-mt-28 border-amber-500/50 bg-amber-500/[0.07]"
          role="region"
          aria-label="Ticket refunds and draw status"
        >
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
                {refundableEntries.length > 1 && (
                  <div className="mb-3 flex justify-end">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="touch-manipulation min-h-[44px]"
                      disabled={claimRefundLoadingEntryId !== null || isClaimingAllRefunds}
                      onClick={() =>
                        void handleClaimAllRefunds(
                          refundableEntries.slice(0, 25).map((x) => x.entry.id)
                        )
                      }
                    >
                      {isClaimingAllRefunds ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Claiming all…
                        </>
                      ) : (
                        `Claim all (${Math.min(refundableEntries.length, 25)})`
                      )}
                    </Button>
                  </div>
                )}
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
                        disabled={claimRefundLoadingEntryId !== null}
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
                {offerRefundCandidates.length > 1 && (
                  <div className="mb-3 flex justify-end">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="touch-manipulation min-h-[44px]"
                      disabled={claimOfferRefundLoadingId !== null || isClaimingAllOfferRefunds}
                      onClick={() =>
                        void handleClaimAllOfferRefunds(
                          offerRefundCandidates.slice(0, 25).map((o) => o.offerId)
                        )
                      }
                    >
                      {isClaimingAllOfferRefunds ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Claiming all…
                        </>
                      ) : (
                        `Claim all (${Math.min(offerRefundCandidates.length, 25)})`
                      )}
                    </Button>
                  </div>
                )}
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
                        disabled={claimOfferRefundLoadingId !== null}
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
            value="analytics"
            className="min-h-[44px] flex-1 gap-1.5 rounded-lg px-2 text-xs font-medium sm:flex-initial sm:px-4 sm:text-sm"
          >
            Analytics
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

        <TabsContent value="overview" className="mt-0 focus-visible:outline-none">
          <DashboardOverviewSection
            engagement={engagement}
            feeTier={feeTier}
            partnerDisplayName={displayNameInput.trim() || displayName}
            creatorRevenueByCurrency={creatorRevenueByCurrency}
            creatorLiveEarningsByCurrency={creatorLiveEarningsByCurrency}
            creatorAllTimeGrossByCurrency={creatorAllTimeGrossByCurrency}
            stats={overviewStats}
            onNavigateTab={setDashboardTabFromUi}
          />
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
            <Card className="rounded-xl border-emerald-500/25 bg-emerald-500/[0.04] shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Share2 className="h-4 w-4 text-emerald-500" />
                  Your referral code
                </CardTitle>
                <CardDescription>
                  Copy your code and add it to any eligible raffle link as{' '}
                  <span className="font-mono">?ref={referralRow.activeCode}</span> (SOL/USDC tickets only).
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <ReferralCodeCopyRow code={referralRow.activeCode} copyLabel="Copy code" />

                {data?.referralGrowth ? (
                  <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-3">
                    <p className="text-sm font-medium text-foreground">
                      Referrals this month: {data.referralGrowth.monthlyUsed} / {data.referralGrowth.monthlyCap}{' '}
                      used
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {data.referralGrowth.monthlyRemaining > 0
                        ? `${data.referralGrowth.monthlyRemaining} referral reward${data.referralGrowth.monthlyRemaining === 1 ? '' : 's'} left`
                        : 'No referral rewards left this month'}{' '}
                      · Resets {new Date(data.referralGrowth.resetsAt).toLocaleDateString()}
                      {data.referralGrowth.isHolder ? ' · Owltopia holder' : ''}
                    </p>
                  </div>
                ) : null}

                {data?.referralGrowth?.pendingRewards?.length && publicKey ? (
                  <ReferralRewardsRedeem
                    pendingRewards={data.referralGrowth.pendingRewards}
                    eligibleRaffles={data.referralGrowth.eligibleRaffles}
                    walletAddress={publicKey.toBase58()}
                    onRedeemed={() => void loadDashboard()}
                  />
                ) : null}

                <p className="text-xs text-muted-foreground">
                  {referralRow.codeKind === 'vanity' ? 'Custom code' : 'Auto-generated code'}
                  {' · '}
                  Use on raffle pages from the share card, or append{' '}
                  <span className="font-mono">?ref={referralRow.activeCode}</span> to the URL.
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

        <TabsContent value="analytics" className="mt-0 space-y-6 focus-visible:outline-none">
          <CreatorAnalyticsSection />
        </TabsContent>

        <TabsContent value="hosting" className="mt-0 space-y-6 focus-visible:outline-none">
          <HostingQuickStats
            hostedCount={myRaffles.length}
            readyToClaimCount={pendingCreatorFundClaims.length}
            awaitingDrawCount={creatorRafflesEndedAwaitingDraw.length}
          />
          <HostingClaimTracker
            pollIntervalMs={CLAIM_TRACKER_POLL_MS}
            readyNet={claimTrackerReadyNetByCurrency}
            readyFee={claimTrackerReadyFeeByCurrency}
            readyGross={claimTrackerReadyGrossByCurrency}
            liveSales={claimTrackerLiveSales}
            pendingClaims={pendingCreatorFundClaims}
            awaitingSettlement={awaitingSettlementEscrowClaims}
            liveEscrowCount={liveEscrowRaffles.length}
            endedAwaitingDraw={creatorRafflesEndedAwaitingDraw}
            hasLiveEscrowSales={claimTrackerHasLiveEscrowSales}
            claimProceedsLoadingId={claimProceedsLoadingId}
            onClaimProceeds={handleClaimProceeds}
            onGoOverview={() => setDashboardTabFromUi('overview')}
          />

      <Card className="rounded-xl border-border/60 shadow-sm overflow-hidden">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 bg-muted/20">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <TrendingUp className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              My raffles
            </CardTitle>
            <CardDescription className="mt-1">
              Manage listings, claims, and refunds ({myRaffles.length})
            </CardDescription>
          </div>
          <Button asChild className="shrink-0 min-h-[44px] w-full touch-manipulation sm:w-auto">
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
              className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/[0.07] p-3 sm:p-4 space-y-2"
              role="status"
            >
              <p className="text-sm font-semibold text-foreground">
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
                    {needsPayCancellationFeeBeforePrizeReturn(r) ? (
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
            <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
              You haven&apos;t created any raffles yet.{' '}
              <Link href="/admin/raffles/new" className="font-medium text-primary hover:underline">
                Create your first raffle
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {myRaffles.slice(0, 20).map((r) => {
                const isOpen = openRaffleId === r.id
                const endTime = new Date(r.end_time)
                const payoutPreview =
                  r.creator_payout_amount != null &&
                  (r.status === 'completed' ||
                    (r.status === 'successful_pending_claims' && r.creator_claimed_at))
                    ? `${Number(r.creator_payout_amount).toFixed(r.currency === 'USDC' ? 2 : 4)} ${r.currency}`
                    : null
                return (
                  <li
                    key={r.id}
                    className={`rounded-xl border bg-card/80 transition-colors ${
                      isOpen ? 'border-primary/30 shadow-sm' : 'border-border/60'
                    }`}
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
                      className="flex w-full cursor-pointer flex-col gap-3 p-3 text-left touch-manipulation sm:flex-row sm:items-center sm:justify-between sm:p-4"
                    >
                      <span className="flex min-w-0 flex-1 items-start gap-2">
                        <ChevronDown
                          className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                            isOpen ? 'rotate-180' : ''
                          }`}
                          aria-hidden
                        />
                        <span className="flex min-w-0 flex-col gap-1">
                          <Link
                            href={`/raffles/${r.slug}`}
                            className="font-medium text-foreground hover:underline truncate"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.title}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            Ends {endTime.toLocaleString()}
                            {payoutPreview ? (
                              <span className="text-foreground/80">
                                {' '}
                                · <span className="tabular-nums font-medium">{payoutPreview}</span>
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 flex-wrap justify-end pl-6 sm:pl-0">
                        <HostingStatusBadge status={r.status} />
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
                        {canCreatorClaimPrizeBackFromEscrow(r, wallet) &&
                          !needsPayCancellationFeeBeforePrizeReturn(r) &&
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
                        isOpen ? 'max-h-[32rem] opacity-100' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <div className="border-t border-border/40 px-3 pb-4 pt-3 text-sm text-muted-foreground space-y-1 sm:px-4">
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
                        {refundableEntries.filter((x) => x.raffle.id === r.id).length > 0 && (
                          <div
                            className="rounded-md border border-primary/30 bg-primary/[0.06] p-3 space-y-2 mt-2"
                            role="region"
                            aria-label="Claim ticket refunds for this raffle"
                          >
                            <p className="text-xs font-medium text-foreground">
                              Your ticket refunds (this wallet)
                            </p>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              You bought tickets on this listing. Claim each confirmed payment back from funds escrow —
                              same as{' '}
                              <a href="#ticket-refunds" className="text-primary underline font-medium">
                                Ticket refunds at the top of the dashboard
                              </a>{' '}
                              or the raffle page Overview while connected.
                            </p>
                            {refundableEntries.filter((x) => x.raffle.id === r.id).length > 1 && (
                              <div className="flex justify-end pt-1">
                                <Button
                                  type="button"
                                  variant="default"
                                  size="sm"
                                  className="touch-manipulation min-h-[44px]"
                                  disabled={claimRefundLoadingEntryId !== null || isClaimingAllRefunds}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void handleClaimAllRefunds(
                                      refundableEntries
                                        .filter((x) => x.raffle.id === r.id)
                                        .map((x) => x.entry.id)
                                    )
                                  }}
                                >
                                  {isClaimingAllRefunds ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                      Claiming all…
                                    </>
                                  ) : (
                                    `Claim all (${refundableEntries.filter((x) => x.raffle.id === r.id).length})`
                                  )}
                                </Button>
                              </div>
                            )}
                            <ul className="space-y-2 pt-1">
                              {refundableEntries
                                .filter((x) => x.raffle.id === r.id)
                                .map(({ entry, raffle }) => (
                                  <li
                                    key={entry.id}
                                    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-2 last:border-0 last:pb-0"
                                  >
                                    <span className="text-xs text-muted-foreground">
                                      {entry.ticket_quantity === 1
                                        ? '1 ticket purchase'
                                        : `${entry.ticket_quantity} ticket purchases`}
                                    </span>
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      className="touch-manipulation min-h-[44px] shrink-0 w-full sm:w-auto"
                                      disabled={claimRefundLoadingEntryId !== null}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        void handleClaimRefund(entry.id)
                                      }}
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
                        {legacyRefundOwedByRaffle.some((row) => row.raffle.id === r.id) && (
                          <div className="rounded-md border border-amber-500/35 bg-amber-500/[0.06] p-3 mt-2 text-xs text-muted-foreground leading-relaxed">
                            <p className="font-medium text-foreground mb-1">Buyers on legacy payout (including you)</p>
                            <p>
                              This raffle did not use funds escrow for tickets. Refunds are manual — see{' '}
                              <a href="#ticket-refunds" className="text-primary underline font-medium">
                                Ticket refunds
                              </a>{' '}
                              at the top of this page for amounts and next steps.
                            </p>
                          </div>
                        )}
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
                            {canCreatorClaimPrizeBackFromEscrow(r, wallet) && needsPayCancellationFeeBeforePrizeReturn(r) ? (
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
                            ) : canCreatorClaimPrizeBackFromEscrow(r, wallet) ? (
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
              Refunds are sent from funds escrow. Older bids that went to the fee treasury need a manual refund from
              platform admin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {buyoutRefundEligible.length > 1 && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="touch-manipulation min-h-[44px]"
                  disabled={buyoutRefundLoadingId !== null || isClaimingAllBuyoutRefunds}
                  onClick={() => void handleClaimAllBuyoutRefunds(buyoutRefundEligible)}
                >
                  {isClaimingAllBuyoutRefunds ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      Claiming all…
                    </>
                  ) : (
                    `Claim all (${buyoutRefundEligible.length})`
                  )}
                </Button>
              </div>
            )}
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
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/80 break-all" title="Offer ID">
                    {o.id}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-[44px] w-full shrink-0 touch-manipulation sm:w-auto"
                  disabled={buyoutRefundLoadingId !== null}
                  onClick={() => void handleClaimBuyoutRefund(o)}
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
                    <div className="pt-1">
                      <Button asChild size="sm" variant="outline" className="touch-manipulation min-h-[44px] w-full sm:w-auto">
                        <Link href={`/raffles/${rr.raffleSlug}`}>Open raffle</Link>
                      </Button>
                    </div>
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
        <CardContent className="space-y-3">
          {claimActionError && (
            <p className="text-sm text-destructive" role="alert">
              {claimActionError}
            </p>
          )}
          <DashboardCollapsible
            title="Creator proceeds (your raffles)"
            defaultOpen={winsSectionDefaults.creatorProceeds}
            description="Ticket sales you host are claimed from the Hosting tab. This section is a quick pointer only."
          >
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
          </DashboardCollapsible>
          <DashboardCollapsible
            title="Giveaway NFTs"
            count={winsSectionDefaults.counts.giveaways}
            readyLabel={
              winsSectionDefaults.counts.giveawayReady > 0
                ? `${winsSectionDefaults.counts.giveawayReady} ready`
                : null
            }
            defaultOpen={winsSectionDefaults.giveaways}
            description="One-off drops from the team. On mobile, use Wi‑Fi or solid data and a reliable RPC if claim fails once."
          >
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
                            onClick={() => handleClaimGiveaway(g)}
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
          </DashboardCollapsible>
          <DashboardCollapsible
            title="Community giveaway wins"
            count={winsSectionDefaults.counts.community}
            readyLabel={
              winsSectionDefaults.counts.communityReady > 0
                ? `${winsSectionDefaults.counts.communityReady} ready`
                : null
            }
            defaultOpen={winsSectionDefaults.community}
            description="Pool giveaways you won after a draw — claim sends the NFT from escrow to this wallet."
          >
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
                            onClick={() => handleClaimCommunityGiveaway(g)}
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
          </DashboardCollapsible>
          {milestoneBonusWinRows.length > 0 && (
            <DashboardCollapsible
              title="Bonus milestone prizes (top buyer, etc.)"
              count={winsSectionDefaults.counts.milestoneWins}
              readyLabel={
                winsSectionDefaults.counts.milestoneClaimable > 0
                  ? `${winsSectionDefaults.counts.milestoneClaimable} to claim`
                  : null
              }
              defaultOpen={winsSectionDefaults.milestoneWins}
            >
              <p className="text-xs text-muted-foreground mb-3">
                Side prizes from raffles you entered — separate from the main raffle winner. Top-buyer bonuses appear
                here even if you did not win the main prize.
              </p>
              <ul className="space-y-3">
                {milestoneBonusWinRows.map((row) => {
                  const claimable = canClaimMilestoneBonus(row.milestone)
                  const claimed = Boolean(row.milestone.claimed_at && row.milestone.claim_tx)
                  return (
                    <li key={row.milestone.id} className="rounded-lg border border-border/50 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <Link
                            href={`/raffles/${row.raffleSlug}`}
                            className="text-sm font-medium hover:underline truncate block"
                          >
                            {row.raffleTitle}
                          </Link>
                          <span className="text-sm text-muted-foreground block">
                            Bonus: {formatMilestonePrize(row.milestone)} ·{' '}
                            {milestoneWinnerModeLabel(row.milestone.winner_mode)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {claimable && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="min-h-[44px] touch-manipulation"
                              disabled={claimMilestoneLoadingId === row.milestone.id}
                              onClick={() => handleClaimMilestoneBonus(row)}
                            >
                              {claimMilestoneLoadingId === row.milestone.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Gift className="h-4 w-4 mr-1" />
                                  Claim bonus
                                </>
                              )}
                            </Button>
                          )}
                          {claimed && row.milestone.claim_tx?.trim() && (
                            <Button type="button" variant="outline" size="sm" className="min-h-[44px]" asChild>
                              <a
                                href={solscanTxUrl(row.milestone.claim_tx.trim())}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-4 w-4 mr-1" />
                                Bonus tx
                              </a>
                            </Button>
                          )}
                          <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" asChild>
                            <Link href={`/raffles/${row.raffleSlug}`}>Open raffle</Link>
                          </Button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </DashboardCollapsible>
          )}
          <DashboardCollapsible
            title="Raffle winners (NFT prizes)"
            count={winsSectionDefaults.counts.nftWins}
            readyLabel={
              winsSectionDefaults.counts.nftClaimable > 0
                ? `${winsSectionDefaults.counts.nftClaimable} to claim`
                : null
            }
            defaultOpen={winsSectionDefaults.nftWins}
          >
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
                          onClick={() => handleClaimPrize(raffle)}
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
          </DashboardCollapsible>
          {cryptoPrizeWinRows.length > 0 && (
            <DashboardCollapsible
              title="Raffle winners (crypto / SPL prizes)"
              count={winsSectionDefaults.counts.cryptoWins}
              readyLabel={
                winsSectionDefaults.counts.cryptoClaimable > 0
                  ? `${winsSectionDefaults.counts.cryptoClaimable} to claim`
                  : null
              }
              defaultOpen={winsSectionDefaults.cryptoWins}
            >
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
                            onClick={() => handleClaimPrize(raffle)}
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
            </DashboardCollapsible>
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
        <CardContent className="p-0">
          <details ref={myEntriesDetailsRef} className="group border-t border-border/40">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-3 touch-manipulation min-h-[44px] [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden
                />
                Entry list
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {raffleSummaries.length} raffle{raffleSummaries.length === 1 ? '' : 's'}
              </span>
            </summary>
            <div className="space-y-0 px-6 pb-6 pt-2">
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
                                  handleClaimPrize(raffle)
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
            </div>
          </details>
        </CardContent>
      </Card>
      </TabsContent>
      </Tabs>
      </div>
      <ClaimSuccessOverlay
        open={claimSuccess !== null}
        heading={claimSuccess?.heading}
        message={claimSuccess?.message ?? ''}
        transactionSignature={claimSuccess?.tx ?? ''}
        solscanUrl={solscanTxUrl}
        winnerPng={
          claimSuccess?.showWinnerPng
            ? {
                title: claimSuccess.title,
                slug: claimSuccess.slug,
                winnerWallet: claimSuccess.winnerWallet,
              }
            : undefined
        }
        onClose={() => setClaimSuccess(null)}
      />
    </main>
  )
}

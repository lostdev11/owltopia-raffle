'use client'

import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { OwlVisionBadge } from '@/components/OwlVisionBadge'
import { RaffleDeadlineExtensionBadge } from '@/components/RaffleDeadlineExtensionBadge'
import { HootBoostMeter } from '@/components/HootBoostMeter'
import {
  ReferralComplimentaryHint,
  clearReferralComplimentarySessionCache,
} from '@/components/ReferralComplimentaryHint'
import { NftFloorCheckLinks } from '@/components/NftFloorCheckLinks'
import { ParticipantsModal } from '@/components/ParticipantsModal'
import { WinnerModal } from '@/components/WinnerModal'
import { CurrencyIcon } from '@/components/CurrencyIcon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import type { Raffle, Entry, OwlVisionScore, PrizeStandard, RaffleOffer } from '@/lib/types'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { isRaffleEligibleToDraw, calculateTicketsSold, getRaffleMinimum } from '@/lib/db/raffles'
import { getRaffleProfitInfo, normalizeRaffleTicketCurrency, revenueInCurrency } from '@/lib/raffle-profit'
import {
  raffleUsesFundsEscrow,
  hasExhaustedMinThresholdTimeExtensions,
  raffleAllowsAdminFundsEscrowRefund,
} from '@/lib/raffles/ticket-escrow-policy'
import {
  getThemeAccentBorderStyle,
  getThemeAccentClasses,
  getThemeAccentColor,
  getThemeAccentRgbChannels,
} from '@/lib/theme-accent'
import { getCachedAdmin, getCachedAdminRole, setCachedAdmin, type AdminRole } from '@/lib/admin-check-cache'
import { AdminManualRefundRecorder } from '@/components/AdminManualRefundRecorder'
import { isOwlEnabled } from '@/lib/tokens'
import { isSolanaRpcRateLimitError } from '@/lib/solana-rpc-rate-limit'
import { formatDistance } from 'date-fns'
import { formatDateTimeWithTimezone, formatDateTimeLocal } from '@/lib/utils'
import { getRaffleDisplayImageUrl, getRaffleImageFallbackRawUrl } from '@/lib/raffle-display-image-url'
import Image from 'next/image'
import {
  Users,
  Trophy,
  ArrowLeft,
  Edit,
  Grid3x3,
  LayoutGrid,
  Square,
  Send,
  Eye,
  Share2,
  BadgeCheck,
  ExternalLink,
  XCircle,
  Loader2,
  Coins,
  CheckCircle,
  Ticket,
  RefreshCw,
} from 'lucide-react'
import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getMint,
  getAccount,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { HOLDER_LOOKUP_MAX_ATTEMPTS } from '@/lib/solana/holder-lookup-retries'
import { getFungibleHolderInWallet, getNftHolderInWallet } from '@/lib/solana/wallet-tokens'
import { transferMplCoreToEscrow } from '@/lib/solana/mpl-core-transfer'
import {
  isMplCoreNoApprovalsError,
  mplCoreNoApprovalsEscrowMessage,
} from '@/lib/solana/mpl-core-transfer-errors'
import { transferCompressedNftToEscrow } from '@/lib/solana/cnft-transfer'
import { transferTokenMetadataNftToEscrow } from '@/lib/solana/token-metadata-transfer'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import {
  logEscrowDepositAbort,
  logEscrowDepositError,
  logEscrowDepositPath,
  logEscrowDepositSigned,
  logEscrowDepositStart,
  logEscrowDepositVerify,
  type EscrowDepositPath,
} from '@/lib/solana/escrow-deposit-log'
import {
  verifyPrizeDepositWithRetries,
  isEscrowSplPrizeFrozenVerifyError,
  normalizeDepositTxSignatureInput,
  VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS,
  type FrozenEscrowDiagnostics,
} from '@/lib/raffles/verify-prize-deposit-client'
import { useRealtimeEntries } from '@/lib/hooks/useRealtimeEntries'
import { RAFFLE_DETAIL_ENTRIES_POLL_MS } from '@/lib/dev-budget'
import { useServerTime } from '@/lib/hooks/useServerTime'
import { LinkifiedText } from '@/components/LinkifiedText'
import { RaffleDescriptionText } from '@/components/RaffleDescriptionText'
import { RafflePromoPngButton } from '@/components/RafflePromoPngButton'
import {
  RaffleOverThresholdPngButton,
  buildOverThresholdFlexMetaLines,
} from '@/components/RaffleOverThresholdPngButton'
import { fireGreenConfetti, preloadConfetti } from '@/lib/confetti'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { getPartnerPrizeMintForCurrency, isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { humanPartnerPrizeToRawUnits } from '@/lib/partner-prize-amount'

function solscanClusterQuery(): string {
  return /devnet/i.test(resolvePublicSolanaRpcUrl()) ? '?cluster=devnet' : ''
}

function solscanTransactionUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}${solscanClusterQuery()}`
}

function solscanAccountUrl(address: string): string {
  return `https://solscan.io/account/${encodeURIComponent(address.trim())}${solscanClusterQuery()}`
}

function solscanTokenUrl(mint: string): string {
  return `https://solscan.io/token/${encodeURIComponent(mint.trim())}${solscanClusterQuery()}`
}

function formatOfferAmount(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return `0 ${currency}`
  if (currency === 'USDC') return `${amount.toFixed(2)} ${currency}`
  return `${amount.toFixed(4)} ${currency}`
}

interface RaffleDetailClientProps {
  raffle: Raffle
  entries: Entry[]
  owlVisionScore: OwlVisionScore
}

export function RaffleDetailClient({
  raffle,
  entries: initialEntries,
  owlVisionScore,
}: RaffleDetailClientProps) {
  const router = useRouter()
  const walletCtx = useWallet()
  const { publicKey, connected, wallet, signMessage } = walletCtx
  const sendTransaction = useSendTransactionForWallet()
  // Umi walletAdapterIdentity expects the actual WalletAdapter (with publicKey), not the Wallet metadata wrapper
  const walletAdapter = wallet?.adapter ?? null
  const { connection } = useConnection()
  const [ticketQuantity, setTicketQuantity] = useState(1)
  const [shareCopied, setShareCopied] = useState(false)
  const [depositEscrowLoading, setDepositEscrowLoading] = useState(false)
  const [depositEscrowError, setDepositEscrowError] = useState<string | null>(null)
  /** Populated when verify fails with frozen escrow SPL account; cleared when error is not that case. */
  const [depositEscrowFrozenDiagnostics, setDepositEscrowFrozenDiagnostics] =
    useState<FrozenEscrowDiagnostics | null>(null)
  /** In-app transfer flow: wallet → optional chain confirm → server verify (shown in modal + button label). */
  const [depositEscrowProgressOpen, setDepositEscrowProgressOpen] = useState(false)
  const [depositEscrowProgressStep, setDepositEscrowProgressStep] = useState<
    'idle' | 'wallet' | 'chain' | 'verify' | 'sign_in'
  >('idle')
  const [depositVerifyAttemptLabel, setDepositVerifyAttemptLabel] = useState({ current: 0, max: 0 })
  const [depositEscrowSuccess, setDepositEscrowSuccess] = useState(false)
  /** Set after wallet confirms on-chain; lets users open Solscan before server verify catches up. */
  const [depositLastTxSignature, setDepositLastTxSignature] = useState<string | null>(null)
  const [showManualEscrowFallback, setShowManualEscrowFallback] = useState(false)
  const [manualDepositTx, setManualDepositTx] = useState('')
  const [depositVerifyLoading, setDepositVerifyLoading] = useState(false)
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null)
  /** Explorer links: prize mint (identity) vs escrow token account (SPL custody), or single URL for Core. */
  const [escrowExplorer, setEscrowExplorer] = useState<{
    prizeMintUrl: string
    custodyUrl: string
  } | null>(null)
  const [showEscrowConfirmDialog, setShowEscrowConfirmDialog] = useState(false)
  const [ticketQuantityDisplay, setTicketQuantityDisplay] = useState('1')
  const [showParticipants, setShowParticipants] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'owl-vision'>('overview')
  
  // Calculate purchase amount automatically based on ticket price and quantity
  const purchaseAmount = raffle.ticket_price * ticketQuantity
  const [showWinner, setShowWinner] = useState(false)
  const [showEnterRaffleDialog, setShowEnterRaffleDialog] = useState(false)
  const [showNftTransferDialog, setShowNftTransferDialog] = useState(false)
  const [nftTransferSignature, setNftTransferSignature] = useState('')
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferSuccess, setTransferSuccess] = useState(false)
  const [showReturnPrizeDialog, setShowReturnPrizeDialog] = useState(false)
  const [returnPrizeReason, setReturnPrizeReason] = useState<string>('cancelled')
  const [returnPrizeLoading, setReturnPrizeLoading] = useState(false)
  const [returnPrizeError, setReturnPrizeError] = useState<string | null>(null)
  const [returnPrizeSuccess, setReturnPrizeSuccess] = useState(false)
  const [claimPrizeLoading, setClaimPrizeLoading] = useState(false)
  const [claimPrizeError, setClaimPrizeError] = useState<string | null>(null)
  /** Full-screen claim flow: loading spinner then success + Solscan link */
  const [claimPrizePhase, setClaimPrizePhase] = useState<'idle' | 'loading' | 'success'>('idle')
  const [claimPrizeTxSignature, setClaimPrizeTxSignature] = useState<string | null>(null)
  const [claimPrizeAlreadyClaimed, setClaimPrizeAlreadyClaimed] = useState(false)
  const [claimProceedsLoading, setClaimProceedsLoading] = useState(false)
  const [claimProceedsError, setClaimProceedsError] = useState<string | null>(null)
  const [claimRefundLoadingEntryId, setClaimRefundLoadingEntryId] = useState<string | null>(null)
  const [claimRefundError, setClaimRefundError] = useState<string | null>(null)
  const [raffleOffers, setRaffleOffers] = useState<RaffleOffer[]>([])
  const [offersLoading, setOffersLoading] = useState(false)
  const [offersError, setOffersError] = useState<string | null>(null)
  const [newOfferAmount, setNewOfferAmount] = useState('')
  const [submitOfferLoading, setSubmitOfferLoading] = useState(false)
  const [acceptOfferIdLoading, setAcceptOfferIdLoading] = useState<string | null>(null)
  const [offerWindowEndsAt, setOfferWindowEndsAt] = useState<string | null>(null)
  const [refundTerminalLoading, setRefundTerminalLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [requestCancelLoading, setRequestCancelLoading] = useState(false)
  const walletAddress = publicKey?.toBase58() ?? ''
  const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
  const isCreator = connected && walletAddress && creatorWallet === walletAddress
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && walletAddress ? getCachedAdmin(walletAddress) : null
  )
  const [adminRole, setAdminRole] = useState<AdminRole | null>(() =>
    typeof window !== 'undefined' && walletAddress ? getCachedAdminRole(walletAddress) : null
  )
  const [creatorDisplayName, setCreatorDisplayName] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<'small' | 'medium' | 'large'>('medium')
  type HeroImgPhase =
    | 'primary'
    | 'fallback'
    | 'mint_loading'
    | 'mint'
    | 'admin'
    | 'admin_raw'
    | 'dead'
  const [heroImgPhase, setHeroImgPhase] = useState<HeroImgPhase>('primary')
  const [mintHeroSrc, setMintHeroSrc] = useState<string | null>(null)
  const mobileLinkTouchRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const displayImageUrl = getRaffleDisplayImageUrl(raffle.image_url)
  const displayAdminDisp = useMemo(
    () => getRaffleDisplayImageUrl(raffle.image_fallback_url),
    [raffle.image_fallback_url]
  )
  const adminHeroRaw = useMemo(
    () => getRaffleImageFallbackRawUrl(displayAdminDisp, raffle.image_fallback_url),
    [displayAdminDisp, raffle.image_fallback_url]
  )
  const fallbackRawUrl = useMemo(
    () => getRaffleImageFallbackRawUrl(displayImageUrl, raffle.image_url),
    [displayImageUrl, raffle.image_url]
  )
  const canMintImageFallback =
    raffle.prize_type === 'nft' && !!(raffle.nft_mint_address && raffle.nft_mint_address.trim())
  const hasHeroImageSection =
    !!(displayImageUrl ?? raffle.image_url) || !!displayAdminDisp || canMintImageFallback

  useEffect(() => {
    setMintHeroSrc(null)
    if (raffle.image_url?.trim()) {
      setHeroImgPhase('primary')
    } else if (displayAdminDisp) {
      setHeroImgPhase('admin')
    } else if (canMintImageFallback) {
      setHeroImgPhase('mint_loading')
    } else {
      setHeroImgPhase('dead')
    }
  }, [raffle.id, raffle.image_url, raffle.image_fallback_url, displayAdminDisp, canMintImageFallback])

  useEffect(() => {
    if (!depositEscrowError || !isEscrowSplPrizeFrozenVerifyError(depositEscrowError)) {
      setDepositEscrowFrozenDiagnostics(null)
    }
  }, [depositEscrowError])

  useEffect(() => {
    if (heroImgPhase !== 'mint_loading') return
    const mint = raffle.nft_mint_address?.trim()
    if (!mint) {
      setHeroImgPhase(displayAdminDisp ? 'admin' : 'dead')
      return
    }
    let cancelled = false
    fetch(`/api/nft/metadata-image?mint=${encodeURIComponent(mint)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { image?: string | null } | null) => {
        if (cancelled) return
        const raw = typeof data?.image === 'string' ? data.image.trim() : ''
        if (!raw) {
          setHeroImgPhase(displayAdminDisp ? 'admin' : 'dead')
          return
        }
        const proxied = getRaffleDisplayImageUrl(raw) ?? raw
        setMintHeroSrc(proxied)
        setHeroImgPhase('mint')
      })
      .catch(() => {
        if (!cancelled) setHeroImgPhase(displayAdminDisp ? 'admin' : 'dead')
      })
    return () => {
      cancelled = true
    }
  }, [heroImgPhase, raffle.nft_mint_address, displayAdminDisp])

  const heroImageSrc =
    heroImgPhase === 'fallback' && fallbackRawUrl
      ? fallbackRawUrl
      : heroImgPhase === 'mint' && mintHeroSrc
        ? mintHeroSrc
        : heroImgPhase === 'admin_raw'
          ? (adminHeroRaw ?? displayAdminDisp ?? '')
          : heroImgPhase === 'admin'
            ? (displayAdminDisp ?? '')
            : displayImageUrl ?? raffle.image_url ?? ''
  const heroImageDead = heroImgPhase === 'dead'
  const heroImageMintLoading = heroImgPhase === 'mint_loading'
  const { serverNow: serverTime } = useServerTime()
  const startTimeMs = new Date(raffle.start_time).getTime()
  const endTimeMs = new Date(raffle.end_time).getTime()
  const nowMs = serverTime.getTime()
  const isFuture = startTimeMs > nowMs
  const isActive = startTimeMs <= nowMs && endTimeMs > nowMs && raffle.is_active
  const purchasesBlocked = !!(raffle as { purchases_blocked_at?: string | null }).purchases_blocked_at
  // Pending escrow deposit should be based on escrow verification state, not solely on `raffle.status`,
  // since status can drift (e.g. restore/maintenance) while `is_active` remains false.
  const isPendingDraft =
    !raffle.prize_deposited_at &&
    !raffle.is_active &&
    ((raffle.prize_type === 'nft' && !!(raffle.nft_mint_address && raffle.nft_mint_address.trim())) ||
      isPartnerSplPrizeRaffle(raffle))
  // Delay "entered" card styling to avoid flash when wallet/entries resolve on open (mobile)
  const [showEnteredStyle, setShowEnteredStyle] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShowEnteredStyle(true), 200)
    return () => clearTimeout(t)
  }, [])
  const baseBorderStyle = getThemeAccentBorderStyle(raffle.theme_accent)
  const borderStyle = isPendingDraft
    ? { borderColor: '#f59e0b', boxShadow: '0 0 20px rgba(245, 158, 11, 0.45)' }
    : isFuture
    ? { borderColor: '#ef4444', boxShadow: '0 0 20px rgba(239, 68, 68, 0.5)' }
    : !isActive
      ? { borderColor: '#3b82f6', boxShadow: '0 0 20px rgba(59, 130, 246, 0.5)' }
      : baseBorderStyle
  const themeColor = isPendingDraft ? '#f59e0b' : (isFuture ? '#ef4444' : (!isActive ? '#3b82f6' : getThemeAccentColor(raffle.theme_accent)))
  const isEndingSoon =
    isActive && endTimeMs - nowMs <= 60 * 60 * 1000 && new Date(raffle.end_time) > serverTime
  const statusPillLabel = isPendingDraft ? 'Pending' : (isFuture ? 'Upcoming' : isActive ? (isEndingSoon ? 'Ending soon' : 'Live now') : 'Ended')
  const statusBadgeClass = isPendingDraft
    ? 'bg-amber-500 hover:bg-amber-600 text-white'
    : (isFuture ? 'bg-red-500 hover:bg-red-600 text-white' : (isActive ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'))
  const timeToEndLabel = isFuture
    ? `Starts ${formatDateTimeLocal(raffle.start_time)}`
    : isActive
      ? (new Date(raffle.end_time) <= serverTime
          ? `Ended ${formatDistance(new Date(raffle.end_time), serverTime, { addSuffix: true })}`
          : `Ends in ${formatDistance(new Date(raffle.end_time), serverTime)}`)
      : isPendingDraft
        ? 'Pending escrow deposit'
      : `Ended ${formatDateTimeLocal(raffle.end_time)}`

  const handleMobileLinkTouchStart = (e: React.TouchEvent<HTMLAnchorElement>) => {
    const touch = e.touches[0]
    if (!touch) return
    mobileLinkTouchRef.current = { x: touch.clientX, y: touch.clientY, moved: false }
  }

  const handleMobileLinkTouchMove = (e: React.TouchEvent<HTMLAnchorElement>) => {
    const touch = e.touches[0]
    const start = mobileLinkTouchRef.current
    if (!touch || !start) return
    const movedX = Math.abs(touch.clientX - start.x)
    const movedY = Math.abs(touch.clientY - start.y)
    if (movedX > 8 || movedY > 8) {
      mobileLinkTouchRef.current = { ...start, moved: true }
    }
  }

  const handleMobileLinkTouchEnd = (e: React.TouchEvent<HTMLAnchorElement>) => {
    if (mobileLinkTouchRef.current?.moved) {
      // Prevent accidental open when user stops scrolling on a link.
      e.preventDefault()
      e.stopPropagation()
    }
    mobileLinkTouchRef.current = null
  }

  // Keep entry rows fresh while sales are open, and after end for refund/min-threshold flows (refunded_at, etc.).
  // `isActive` alone is false once the raffle ends, which previously froze SSR entry data and stranded buyers on
  // "Refund owed (legacy listing)" after platform payouts until a manual refresh.
  const shouldSyncRaffleEntries =
    isActive ||
    raffle.status === 'failed_refund_available' ||
    raffle.status === 'pending_min_not_met' ||
    raffle.status === 'cancelled'

  const { entries, refetch: fetchEntries, isUsingRealtime } = useRealtimeEntries({
    raffleId: raffle.id,
    enabled: shouldSyncRaffleEntries,
    pollingInterval: RAFFLE_DETAIL_ENTRIES_POLL_MS,
    initialEntries, // Initialize with server-side entries
  })

  const profitInfoForSocialFlex = useMemo(() => getRaffleProfitInfo(raffle, entries), [raffle, entries])

  // Refresh entries when wallet connection status changes
  // This ensures user tickets are recalculated when user connects/disconnects
  useEffect(() => {
    fetchEntries()
  }, [connected, publicKey, fetchEntries])

  // Calculate owlVisionScore based on current entries
  // Fallback to initial score if entries are not yet loaded
  const currentOwlVisionScore = entries.length > 0 
    ? calculateOwlVisionScore(raffle, entries)
    : owlVisionScore

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setAdminRole(null)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached !== null) {
      setIsAdmin(cached)
      setAdminRole(getCachedAdminRole(addr))
      return
    }
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role: AdminRole | null = admin && data?.role === 'full' ? 'full' : null
        setCachedAdmin(addr, admin, role)
        setIsAdmin(admin)
        setAdminRole(role)
      })
      .catch(() => {
        if (!cancelled) {
          setIsAdmin(false)
          setAdminRole(null)
        }
      })
    return () => { cancelled = true }
  }, [connected, publicKey])

  useEffect(() => {
    if (!creatorWallet) {
      setCreatorDisplayName(null)
      return
    }
    fetch(`/api/profiles?wallets=${encodeURIComponent(creatorWallet)}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((map: Record<string, string>) => {
        const name = map?.[creatorWallet]
        setCreatorDisplayName(typeof name === 'string' && name.trim() ? name.trim() : null)
      })
      .catch(() => {
        setCreatorDisplayName(null)
      })
  }, [creatorWallet])

  // Fetch prize escrow address when an NFT or partner SPL (e.g. USDC) prize raffle needs a deposit.
  // Partner crypto raffles use the same escrow config endpoint; previously only NFT ran this effect,
  // so `escrowAddress` stayed null and creators saw endless "Preparing…" with no Verify button.
  useEffect(() => {
    if (raffle.prize_deposited_at) return

    const isNftNeedingEscrow =
      raffle.prize_type === 'nft' && Boolean(raffle.nft_mint_address?.trim())
    const isPartnerNeedingEscrow = isPartnerSplPrizeRaffle(raffle)
    if (!isNftNeedingEscrow && !isPartnerNeedingEscrow) return

    let cancelled = false
    fetch('/api/config/prize-escrow', { credentials: 'include' })
      .then(async (r) => {
        if (cancelled) return
        if (r.ok) {
          const data = (await r.json().catch(() => ({}))) as { address?: string }
          if (data?.address) setEscrowAddress(data.address)
          return
        }
        const data = (await r.json().catch(() => ({}))) as { error?: string }
        const msg =
          typeof data?.error === 'string' && data.error.trim()
            ? data.error.trim()
            : 'Prize escrow is not configured.'
        setEscrowAddress(null)
        setDepositEscrowError(msg)
      })
      .catch((e) => {
        if (cancelled) return
        setEscrowAddress(null)
        setDepositEscrowError(e instanceof Error ? e.message : 'Failed to load prize escrow address.')
      })
    return () => { cancelled = true }
  }, [raffle.prize_type, raffle.prize_currency, raffle.prize_deposited_at, raffle.nft_mint_address])

  // Fetch block explorer URL to check NFT in escrow (only once prize is deposited)
  useEffect(() => {
    if (
      raffle.prize_type !== 'nft' ||
      !raffle.nft_mint_address ||
      !raffle.prize_deposited_at
    )
      return
    let cancelled = false
    fetch(`/api/raffles/${raffle.id}/escrow-check-url`)
      .then((r) => (cancelled ? undefined : r.ok ? r.json() : undefined))
      .then((data: { url?: string; prizeMintUrl?: string; custodyUrl?: string } | undefined) => {
        if (cancelled || !data?.url || !raffle.nft_mint_address) return
        const mint = raffle.nft_mint_address.trim()
        const cluster = /devnet/i.test(resolvePublicSolanaRpcUrl()) ? '?cluster=devnet' : ''
        const fallbackUrl =
          raffle.prize_standard === 'mpl_core' || raffle.prize_standard === 'compressed'
            ? `https://solscan.io/account/${mint}${cluster}`
            : `https://solscan.io/token/${mint}${cluster}`
        const prizeMintUrl = data.prizeMintUrl ?? fallbackUrl
        const custodyUrl = data.custodyUrl ?? data.url
        setEscrowExplorer({ prizeMintUrl, custodyUrl })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [raffle.id, raffle.prize_type, raffle.nft_mint_address, raffle.prize_deposited_at])

  useEffect(() => {
    if (raffle.prize_deposited_at) {
      setDepositLastTxSignature(null)
      setDepositEscrowSuccess(false)
    }
  }, [raffle.prize_deposited_at])

  // Real-time updates are now handled by useRealtimeEntries hook
  // No need for separate polling logic - it's built into the hook

  // Calculate total tickets sold (from confirmed entries only)
  const totalTicketsSold = calculateTicketsSold(entries)
  
  // Calculate minimum eligibility
  const minTickets = getRaffleMinimum(raffle)
  const isEligibleToDraw = minTickets ? isRaffleEligibleToDraw(raffle, entries) : true

  // Calculate available tickets
  const availableTickets = raffle.max_tickets 
    ? raffle.max_tickets - totalTicketsSold 
    : null

  // Calculate user's tickets (from confirmed entries only)
  const userTickets = connected && publicKey
    ? entries
        .filter(e => e.status === 'confirmed' && e.wallet_address === publicKey.toBase58())
        .reduce((sum, entry) => sum + Number(entry.ticket_quantity ?? 0), 0)
    : 0

  // Pending entries for this wallet that have a tx signature (confirming on-chain)
  const userPendingTickets = connected && publicKey
    ? entries
        .filter(
          e =>
            e.status === 'pending' &&
            e.wallet_address === publicKey.toBase58() &&
            e.transaction_signature
        )
        .reduce((sum, entry) => sum + Number(entry.ticket_quantity ?? 0), 0)
    : 0

  /** Large headline count: include pending so users do not see "0 tickets" while Solana verification runs. */
  const userTicketsHeadline =
    userPendingTickets > 0 ? userTickets + userPendingTickets : userTickets

  const showCreatorRefundCandidates =
    isCreator &&
    (raffle.status === 'failed_refund_available' || raffle.status === 'pending_min_not_met')

  const creatorRefundCandidates = useMemo(() => {
    if (!showCreatorRefundCandidates) return []
    const byWallet = new Map<
      string,
      { wallet: string; totalAmount: number; refundedAmount: number; confirmedEntries: number; refundedEntries: number }
    >()
    for (const entry of entries) {
      if (entry.status !== 'confirmed') continue
      const wallet = (entry.wallet_address || '').trim()
      if (!wallet) continue
      const amount = Number(entry.amount_paid ?? 0)
      const isRefunded = !!entry.refunded_at
      const row = byWallet.get(wallet) ?? {
        wallet,
        totalAmount: 0,
        refundedAmount: 0,
        confirmedEntries: 0,
        refundedEntries: 0,
      }
      row.totalAmount += Number.isFinite(amount) ? amount : 0
      row.confirmedEntries += 1
      if (isRefunded) {
        row.refundedAmount += Number.isFinite(amount) ? amount : 0
        row.refundedEntries += 1
      }
      byWallet.set(wallet, row)
    }
    return Array.from(byWallet.values()).sort((a, b) => b.totalAmount - a.totalAmount)
  }, [entries, showCreatorRefundCandidates])

  const creatorRefundTotalPending = useMemo(() => {
    return creatorRefundCandidates.reduce((sum, row) => {
      const pending = Math.max(0, row.totalAmount - row.refundedAmount)
      return sum + pending
    }, 0)
  }, [creatorRefundCandidates])

  const creatorRefundCsv = useMemo(() => {
    if (creatorRefundCandidates.length === 0) return ''
    const lines = creatorRefundCandidates.map((row) => {
      const pending = Math.max(0, row.totalAmount - row.refundedAmount)
      return `${row.wallet},${pending.toFixed(raffle.currency === 'USDC' ? 2 : 6)},${raffle.currency}`
    })
    return `wallet,amount_to_refund,currency\n${lines.join('\n')}`
  }, [creatorRefundCandidates, raffle.currency])

  const creatorRefundPayoutScript = useMemo(() => {
    if (creatorRefundCandidates.length === 0) return ''
    return creatorRefundCandidates
      .map((row, i) => {
        const pending = Math.max(0, row.totalAmount - row.refundedAmount)
        const amount = pending.toFixed(raffle.currency === 'USDC' ? 2 : 6)
        return `${i + 1}. Send ${amount} ${raffle.currency} to ${row.wallet}`
      })
      .join('\n')
  }, [creatorRefundCandidates, raffle.currency])

  /** Buyer self-claim from funds escrow (same rules as dashboard). */
  const buyerRefundableEntries = useMemo(() => {
    if (!connected || !publicKey || raffle.status !== 'failed_refund_available') return []
    if (!raffleUsesFundsEscrow(raffle)) return []
    const w = publicKey.toBase58()
    return entries.filter(
      (e) => e.status === 'confirmed' && e.wallet_address === w && !e.refunded_at
    )
  }, [connected, publicKey, raffle, entries])

  const buyerLegacyRefundEntries = useMemo(() => {
    if (!connected || !publicKey || raffle.status !== 'failed_refund_available') return []
    if (raffleUsesFundsEscrow(raffle)) return []
    const w = publicKey.toBase58()
    return entries.filter((e) => e.status === 'confirmed' && e.wallet_address === w && !e.refunded_at)
  }, [connected, publicKey, raffle, entries])

  const buyerLegacyRefundEligible = buyerLegacyRefundEntries.length > 0

  /** Cancelled raffles use `cancelled` status + manual treasury refunds — not `failed_refund_available`, so buyers need explicit copy here and on the dashboard. */
  const buyerCancelledRefundEntries = useMemo(() => {
    if (!connected || !publicKey || raffle.status !== 'cancelled') return []
    const w = publicKey.toBase58()
    return entries.filter(
      (e) => e.status === 'confirmed' && e.wallet_address === w && !e.refunded_at
    )
  }, [connected, publicKey, raffle.status, entries])

  const buyerCancelledRefundEligible = buyerCancelledRefundEntries.length > 0

  const buyerCancelledRefundByCurrency = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of buyerCancelledRefundEntries) {
      const c = String(e.currency ?? raffle.currency ?? 'SOL').toUpperCase()
      map.set(c, (map.get(c) ?? 0) + Number(e.amount_paid ?? 0))
    }
    return Array.from(map.entries()).map(([currency, total]) => ({ currency, total }))
  }, [buyerCancelledRefundEntries, raffle.currency])

  const buyerLegacyRefundByCurrency = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of buyerLegacyRefundEntries) {
      const c = String(e.currency ?? raffle.currency ?? 'SOL').toUpperCase()
      map.set(c, (map.get(c) ?? 0) + Number(e.amount_paid ?? 0))
    }
    return Array.from(map.entries()).map(([currency, total]) => ({ currency, total }))
  }, [buyerLegacyRefundEntries, raffle.currency])

  /** Ended, no winner, min threshold not met after max extension — matches server finalize rules. */
  const minThresholdRefundRules = useMemo(() => {
    const timeEnded = !isFuture && !isPendingDraft && !isActive
    const noWinner =
      !(raffle.winner_wallet ?? '').trim() && !(raffle.winner_selected_at ?? '').trim()
    const minSet = minTickets != null && minTickets > 0
    const belowMin = minSet && !isEligibleToDraw
    const exhausted = hasExhaustedMinThresholdTimeExtensions(raffle)
    return timeEnded && noWinner && minSet && belowMin && exhausted
  }, [isFuture, isPendingDraft, isActive, raffle, minTickets, isEligibleToDraw])

  const raffleHasUnrefundedConfirmedSales = useMemo(
    () => entries.some((e) => e.status === 'confirmed' && !e.refunded_at),
    [entries]
  )

  const statusAllowsTerminalFinalize =
    raffle.status === 'live' ||
    raffle.status === 'ready_to_draw' ||
    raffle.status === 'pending_min_not_met'

  const showRefundTerminalButton =
    minThresholdRefundRules && statusAllowsTerminalFinalize && raffleHasUnrefundedConfirmedSales

  // Determine max tickets user can purchase in one transaction
  const maxPurchaseQuantity = availableTickets !== null 
    ? Math.max(0, availableTickets) 
    : 100 // Default max if no limit set

  const handlePurchase = async () => {
    if (!connected || !publicKey) {
      setError('Please connect your wallet first')
      return
    }

    // OWL: block checkout with friendly message if mint not configured
    if (raffle.currency === 'OWL' && !isOwlEnabled()) {
      setError('OWL entry is not enabled yet — mint address pending.')
      return
    }

    setIsProcessing(true)
    setError(null)
    setSuccess(false)

    try {
      // Step 1: Create entry and get payment details
      // Add retry logic and timeout for mobile connections
      let createResponse: Response | null = null
      let fetchRetries = 3
      let fetchError: Error | null = null
      
      while (fetchRetries > 0) {
        try {
          // Create AbortController for timeout (30 seconds for mobile)
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 30000)
          createResponse = await fetch('/api/entries/create', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
              raffleId: raffle.id,
              walletAddress: publicKey.toBase58(),
              ticketQuantity,
              amountPaid: purchaseAmount,
            }),
            signal: controller.signal,
          })
          
          clearTimeout(timeoutId)
          
          // If we get a response (even if not ok), break retry loop
          break
        } catch (fetchErr: any) {
          fetchRetries--
          fetchError = fetchErr
          
          // Check if it's a network/fetch error
          const errorMessage = fetchErr?.message || ''
          const errorName = fetchErr?.name || ''
          const isFetchError = 
            errorMessage.includes('failed to fetch') ||
            errorMessage.includes('Failed to fetch') ||
            errorMessage.includes('NetworkError') ||
            errorMessage.includes('Network request failed') ||
            errorName === 'TypeError' ||
            errorName === 'AbortError' ||
            errorMessage.includes('timeout') ||
            errorMessage.includes('CORS') ||
            errorMessage.includes('network')
          
          if (fetchRetries === 0) {
            if (isFetchError || errorName === 'AbortError') {
              throw new Error(
                'Network connection failed. Please check your internet connection and try again. ' +
                'On mobile, try switching between WiFi and mobile data.'
              )
            }
            throw fetchErr
          }
          
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 2000 * (3 - fetchRetries)))
        }
      }

      if (!createResponse) {
        throw fetchError || new Error('Failed to create entry: Network error')
      }

      if (!createResponse.ok) {
        // Safe parse for desktop and mobile: proxy/502 often return HTML; avoid JSON parse errors
        let errorMessage = 'Failed to create entry. Please try again.'
        try {
          const contentType = createResponse.headers.get('content-type') || ''
          if (contentType.includes('application/json')) {
            const errorData = await createResponse.json()
            if (typeof errorData?.error === 'string') errorMessage = errorData.error
          }
        } catch {
          // Non-JSON or empty body (common on 502/timeout on any device)
        }
        throw new Error(errorMessage)
      }

      let entryId: string
      let paymentDetails: {
        recipient: string
        amount: number
        currency: string
        usdcMint: string
        owlMint: string | null
        tokenDecimals: number
        split?: { recipient: string; amount: number }[]
      }
      try {
        const data = await createResponse.json()
        if (data?.complimentary === true && data?.complimentaryToken && data?.entryId && publicKey) {
          const confRes = await fetch('/api/entries/confirm-complimentary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              entryId: data.entryId,
              token: data.complimentaryToken,
              walletAddress: publicKey.toBase58(),
            }),
          })
          if (!confRes.ok) {
            let msg = 'Could not activate your free referral ticket. Try again in a moment.'
            try {
              const j = await confRes.json()
              if (typeof j?.error === 'string') msg = j.error
            } catch {
              /* ignore */
            }
            throw new Error(msg)
          }
          clearReferralComplimentarySessionCache()
          setSuccess(true)
          requestAnimationFrame(() => fireGreenConfetti())
          router.refresh()
          setTimeout(() => {
            setSuccess(false)
            setTicketQuantity(1)
            setTicketQuantityDisplay('1')
          }, 2000)
          return
        }
        entryId = data?.entryId
        paymentDetails = data?.paymentDetails
      } catch {
        throw new Error('Invalid response from server. Please try again.')
      }
      if (!entryId || !paymentDetails) {
        throw new Error('Invalid create response')
      }
      
      // Log payment details for debugging
      console.log(`Payment details: amount=${paymentDetails.amount}, currency=${paymentDetails.currency}, ticketQuantity=${ticketQuantity}`)

      // Step 2: Build transaction
      // Get recent blockhash first (needed for transaction)
      let latestBlockhash: { blockhash: string; lastValidBlockHeight: number } | null = null
      let retries = 3
      while (retries > 0) {
        try {
          // Try getLatestBlockhash first (newer API)
          try {
            const result = await connection.getLatestBlockhash('confirmed')
            latestBlockhash = result
            break
          } catch (latestError: any) {
            // If getLatestBlockhash doesn't exist or isn't supported, try getRecentBlockhash (older API)
            const errorMsg = latestError?.message || ''
            if (errorMsg.includes('does not exist') || errorMsg.includes('not available') || latestError?.code === -32601) {
              // Fallback to getRecentBlockhash for older RPC endpoints
              // Try to get lastValidBlockHeight separately using getSlot for mobile wallet compatibility
              try {
                const recentResult = await connection.getRecentBlockhash('confirmed')
                const slot = await connection.getSlot('confirmed')
                latestBlockhash = {
                  blockhash: recentResult.blockhash,
                  lastValidBlockHeight: slot, // Use current slot as approximate lastValidBlockHeight
                }
              } catch (fallbackError) {
                // If we can't get slot, still try with 0 (wallet will handle it)
                const recentResult = await connection.getRecentBlockhash('confirmed')
                latestBlockhash = {
                  blockhash: recentResult.blockhash,
                  lastValidBlockHeight: 0,
                }
              }
              break
            } else {
              // Re-throw if it's a different error
              throw latestError
            }
          }
        } catch (rpcError: any) {
          retries--
          const errorMessage = rpcError?.message || ''
          const errorCode = rpcError?.code || rpcError?.error?.code
          const errorStr = JSON.stringify(rpcError)
          const errorName = rpcError?.name || ''
          
          // Check for network/fetch errors (common on mobile)
          const isFetchError = 
            errorMessage.includes('failed to fetch') ||
            errorMessage.includes('Failed to fetch') ||
            errorMessage.includes('NetworkError') ||
            errorMessage.includes('Network request failed') ||
            errorName === 'TypeError' ||
            (errorName === 'TypeError' && errorMessage.includes('fetch')) ||
            errorMessage.includes('CORS') ||
            errorMessage.includes('network')
          
          // Check for retryable errors: 403/429 (RPC quota), -32429, 19, 500, network issues
          if (isFetchError ||
              errorMessage.includes('403') || 
              errorMessage.includes('Access forbidden') ||
              isSolanaRpcRateLimitError(rpcError) ||
              errorCode === 19 ||
              errorMessage.includes('Temporary internal error') ||
              errorMessage.includes('500') ||
              errorStr.includes('"code":19') ||
              errorMessage.includes('Network') ||
              errorMessage.includes('timeout')) {
            if (retries === 0) {
              if (isFetchError) {
                throw new Error(
                  'Network connection failed. This may be a network issue or CORS restriction on mobile. ' +
                  'Please check your internet connection and try again. ' +
                  'If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                  'to a private RPC endpoint (Helius, Alchemy, or another private RPC) that supports mobile access.'
                )
              } else if (
                errorMessage.includes('403') ||
                errorMessage.includes('Access forbidden') ||
                isSolanaRpcRateLimitError(rpcError)
              ) {
                throw new Error(
                  'RPC endpoint is rate-limited or over quota (balances and purchases need a reliable RPC). ' +
                  'Please set NEXT_PUBLIC_SOLANA_RPC_URL in your .env.local file to a private RPC endpoint ' +
                  '(e.g., Helius, Alchemy, or another private RPC). Public RPC endpoints are rate-limited.'
                )
              } else {
                throw new Error(
                  'Failed to get blockhash after retries. This may be a temporary RPC issue. ' +
                  'Please try again in a moment. If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                  'to a private RPC endpoint (Helius, Alchemy, or another private RPC).'
                )
              }
            }
            // Exponential backoff: wait longer for each retry (longer delays for fetch errors)
            const backoffDelay = isFetchError ? 2000 * (3 - retries) : 1000 * (3 - retries)
            await new Promise(resolve => setTimeout(resolve, backoffDelay))
          } else {
            // Non-retryable error, throw immediately
            throw rpcError
          }
        }
      }
      
      if (!latestBlockhash) {
        throw new Error('Failed to get recent blockhash after retries')
      }

      // Construct transaction with proper blockhash and lastValidBlockHeight for mobile wallet compatibility
      // Setting lastValidBlockHeight is critical for Android mobile wallets (MWA)
      const transaction = new Transaction()
      transaction.recentBlockhash = latestBlockhash.blockhash
      if (latestBlockhash.lastValidBlockHeight) {
        transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight
      }
      transaction.feePayer = publicKey
      
      // Split at purchase: two recipients (creator + treasury) or single recipient
      const payments: { recipient: string; amount: number }[] =
        paymentDetails.split?.length === 2
          ? paymentDetails.split
          : [{ recipient: paymentDetails.recipient, amount: paymentDetails.amount }]

      if (raffle.currency === 'SOL') {
        for (const p of payments) {
          const lamports = Math.round(p.amount * LAMPORTS_PER_SOL)
          transaction.add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: new PublicKey(p.recipient),
              lamports,
            })
          )
        }
      } else if (raffle.currency === 'USDC') {
        // USDC (SPL Token) transfer
        const usdcMint = new PublicKey(paymentDetails.usdcMint)
        
        // Get mint info with retry logic for RPC errors
        let mintInfo
        let mintRetries = 3
        while (mintRetries > 0) {
          try {
            mintInfo = await getMint(connection, usdcMint)
            break
          } catch (rpcError: any) {
            mintRetries--
            const errorMessage = rpcError?.message || ''
            const errorCode = rpcError?.code || rpcError?.error?.code
            const errorName = rpcError?.name || ''
            
            // Check for network/fetch errors (common on mobile)
            const isFetchError = 
              errorMessage.includes('failed to fetch') ||
              errorMessage.includes('Failed to fetch') ||
              errorMessage.includes('NetworkError') ||
              errorMessage.includes('Network request failed') ||
              errorName === 'TypeError' ||
              (errorName === 'TypeError' && errorMessage.includes('fetch')) ||
              errorMessage.includes('CORS') ||
              errorMessage.includes('network')
            
            // Check if it's a retryable error (code 19 = temporary internal error, or network issues)
            if (isFetchError ||
                errorCode === 19 || 
                errorMessage.includes('Temporary internal error') ||
                errorMessage.includes('500') ||
                errorMessage.includes('Network') ||
                errorMessage.includes('timeout')) {
              if (mintRetries === 0) {
                if (isFetchError) {
                  throw new Error(
                    'Network connection failed while fetching USDC mint information. This may be a network issue or CORS restriction on mobile. ' +
                    'Please check your internet connection and try again. ' +
                    'If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                    'to a private RPC endpoint (Helius, Alchemy, or another private RPC) that supports mobile access.'
                  )
                } else {
                  throw new Error(
                    'Failed to fetch USDC mint information after retries. This may be a temporary RPC issue. ' +
                    'Please try again in a moment. If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                    'to a private RPC endpoint (Helius, Alchemy, or another private RPC).'
                  )
                }
              }
              // Exponential backoff: wait longer for each retry (longer delays for fetch errors)
              const backoffDelay = isFetchError ? 2000 * (3 - mintRetries) : 1000 * (3 - mintRetries)
              await new Promise(resolve => setTimeout(resolve, backoffDelay))
            } else {
              // Non-retryable error, throw immediately
              throw rpcError
            }
          }
        }
        
        if (!mintInfo) {
          throw new Error('Failed to get USDC mint information')
        }
        
        const decimals = mintInfo.decimals
        const senderTokenAddress = await getAssociatedTokenAddress(usdcMint, publicKey)

        for (const p of payments) {
          const recipientPubkey = new PublicKey(p.recipient)
          const amount = BigInt(Math.round(p.amount * Math.pow(10, decimals)))
          const recipientTokenAddress = await getAssociatedTokenAddress(usdcMint, recipientPubkey)

          let accountExists = false
          let accountRetries = 3
          while (accountRetries > 0 && !accountExists) {
            try {
              await getAccount(connection, recipientTokenAddress)
              accountExists = true
            } catch (error: any) {
              const errorMessage = error?.message || ''
              const errorCode = error?.code || error?.error?.code
              const errorName = error?.name || ''
              if (errorMessage.includes('TokenAccountNotFoundError') || errorMessage.includes('could not find account')) {
                accountExists = false
                break
              }
              const isFetchError = errorMessage.includes('failed to fetch') || errorMessage.includes('Failed to fetch') || errorName === 'TypeError' || errorMessage.includes('network')
              if (isFetchError || errorCode === 19 || errorMessage.includes('Temporary internal error') || errorMessage.includes('500') || errorMessage.includes('timeout')) {
                accountRetries--
                if (accountRetries === 0) { accountExists = false; break }
                await new Promise(resolve => setTimeout(resolve, isFetchError ? 2000 * (3 - accountRetries) : 1000 * (3 - accountRetries)))
              } else { accountExists = false; break }
            }
          }
          if (!accountExists) {
            transaction.add(
              createAssociatedTokenAccountInstruction(publicKey, recipientTokenAddress, recipientPubkey, usdcMint)
            )
          }
          transaction.add(
            createTransferInstruction(senderTokenAddress, recipientTokenAddress, publicKey, amount, [])
          )
        }
      } else if (raffle.currency === 'OWL') {
        // OWL (SPL Token) transfer
        if (!paymentDetails.owlMint) {
          throw new Error('OWL mint address not configured in payment details')
        }
        const owlMint = new PublicKey(paymentDetails.owlMint)
        
        // Get mint info with retry logic for RPC errors
        let mintInfo
        let mintRetries = 3
        while (mintRetries > 0) {
          try {
            mintInfo = await getMint(connection, owlMint)
            break
          } catch (rpcError: any) {
            mintRetries--
            const errorMessage = rpcError?.message || ''
            const errorCode = rpcError?.code || rpcError?.error?.code
            const errorName = rpcError?.name || ''
            
            const isFetchError = 
              errorMessage.includes('failed to fetch') ||
              errorMessage.includes('Failed to fetch') ||
              errorMessage.includes('NetworkError') ||
              errorMessage.includes('Network request failed') ||
              errorName === 'TypeError' ||
              (errorName === 'TypeError' && errorMessage.includes('fetch')) ||
              errorMessage.includes('CORS') ||
              errorMessage.includes('network')
            
            if (isFetchError ||
                errorCode === 19 || 
                errorMessage.includes('Temporary internal error') ||
                errorMessage.includes('500') ||
                errorMessage.includes('Network') ||
                errorMessage.includes('timeout')) {
              if (mintRetries === 0) {
                if (isFetchError) {
                  throw new Error(
                    'Network connection failed while fetching OWL mint information. This may be a network issue or CORS restriction on mobile. ' +
                    'Please check your internet connection and try again. ' +
                    'If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                    'to a private RPC endpoint (Helius, Alchemy, or another private RPC) that supports mobile access.'
                  )
                } else {
                  throw new Error(
                    'Failed to fetch OWL mint information after retries. This may be a temporary RPC issue. ' +
                    'Please try again in a moment. If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                    'to a private RPC endpoint (Helius, Alchemy, or another private RPC).'
                  )
                }
              }
              const backoffDelay = isFetchError ? 2000 * (3 - mintRetries) : 1000 * (3 - mintRetries)
              await new Promise(resolve => setTimeout(resolve, backoffDelay))
            } else {
              throw rpcError
            }
          }
        }
        
        if (!mintInfo) {
          throw new Error('Failed to get OWL mint information')
        }
        
        const decimals = mintInfo.decimals
        const senderTokenAddress = await getAssociatedTokenAddress(owlMint, publicKey)

        for (const p of payments) {
          const recipientPubkey = new PublicKey(p.recipient)
          const amount = BigInt(Math.round(p.amount * Math.pow(10, decimals)))
          const recipientTokenAddress = await getAssociatedTokenAddress(owlMint, recipientPubkey)

          let accountExists = false
          let accountRetries = 3
          while (accountRetries > 0 && !accountExists) {
            try {
              await getAccount(connection, recipientTokenAddress)
              accountExists = true
            } catch (error: any) {
              const errorMessage = error?.message || ''
              const errorCode = error?.code || error?.error?.code
              const errorName = error?.name || ''
              if (errorMessage.includes('TokenAccountNotFoundError') || errorMessage.includes('could not find account')) {
                accountExists = false
                break
              }
              const isFetchError = errorMessage.includes('failed to fetch') || errorMessage.includes('Failed to fetch') || errorName === 'TypeError' || errorMessage.includes('network')
              if (isFetchError || errorCode === 19 || errorMessage.includes('Temporary internal error') || errorMessage.includes('500') || errorMessage.includes('timeout')) {
                accountRetries--
                if (accountRetries === 0) { accountExists = false; break }
                await new Promise(resolve => setTimeout(resolve, isFetchError ? 2000 * (3 - accountRetries) : 1000 * (3 - accountRetries)))
              } else { accountExists = false; break }
            }
          }
          if (!accountExists) {
            transaction.add(
              createAssociatedTokenAccountInstruction(publicKey, recipientTokenAddress, recipientPubkey, owlMint)
            )
          }
          transaction.add(
            createTransferInstruction(senderTokenAddress, recipientTokenAddress, publicKey, amount, [])
          )
        }
      } else {
        throw new Error(`Unsupported currency: ${raffle.currency}`)
      }


      // Step 3: Send transaction for signing
      // Use sendOptions to ensure proper transaction handling
      // For Android mobile wallets, ensure transaction is properly constructed
      let signature: string
      try {
        // Validate transaction before sending (especially important for mobile wallets)
        if (transaction.instructions.length === 0) {
          throw new Error('Transaction has no instructions. Please try again.')
        }
        
        // Ensure blockhash is still valid (especially important for slower mobile connections)
        if (!transaction.recentBlockhash) {
          throw new Error('Transaction blockhash is missing. Please try again.')
        }
        
        signature = await sendTransaction(transaction, connection, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        })
      } catch (walletError: any) {
        // Provide more helpful error messages for wallet errors
        const errorMessage = walletError?.message || walletError?.toString() || 'Unknown error'
        const errorCode = walletError?.code
        const errorName = walletError?.name || ''
        
        // User cancelled in wallet — don't log as error, show friendly message only
        const isUserRejection =
          errorCode === 4001 ||
          errorMessage.includes('User rejected') ||
          errorMessage.includes('rejected the request') ||
          errorMessage.includes('rejected')
        if (isUserRejection) {
          throw new Error('Transaction was cancelled. Please try again if you want to continue.')
        }
        
        console.error('Wallet error details:', walletError)
        
        // Check if this is an Android/mobile device
        const isMobile = typeof window !== 'undefined' && /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
          navigator.userAgent || navigator.vendor || (window as any).opera || ''
        )
        const isAndroid = typeof window !== 'undefined' && /android/i.test(
          navigator.userAgent || navigator.vendor || (window as any).opera || ''
        )
        if (errorMessage.includes('insufficient funds') || errorMessage.includes('Insufficient')) {
          throw new Error('Insufficient funds in your wallet. Please ensure you have enough SOL/USDC to cover the transaction and fees.')
        }
        // Android/Mobile-specific errors
        if (isAndroid && (errorMessage.includes('blockhash') || errorMessage.includes('Blockhash') || errorMessage.includes('expired'))) {
          throw new Error('Transaction blockhash expired. This can happen on slower connections. Please try again - the transaction will use a fresh blockhash.')
        }
        if (isMobile && (errorMessage.includes('invalid') || errorMessage.includes('Invalid') || errorMessage.includes('serialize'))) {
          throw new Error('Transaction validation failed. Please try: 1) Refreshing the page, 2) Reconnecting your wallet, 3) Ensuring your wallet app is up to date.')
        }
        // Solflare-specific: give clearer guidance (connection/signing issues common with extension)
        if (errorMessage.toLowerCase().includes('solflare')) {
          throw new Error('Solflare wallet error. Please try: 1) Refreshing the page and reconnecting Solflare, 2) Updating the Solflare extension to the latest version, 3) Using Solflare in a different browser if the issue persists.')
        }
        if (errorMessage.includes('Something went wrong') || errorMessage.includes('wallet')) {
          throw new Error('Wallet extension error. Please try: 1) Refreshing the page, 2) Reconnecting your wallet, 3) Ensuring your wallet extension is up to date.')
        }
        if (errorMessage.includes('Network') || errorMessage.includes('connection')) {
          throw new Error('Network error. Please check your internet connection and try again.')
        }
        if (isMobile && errorMessage.includes('timeout')) {
          throw new Error('Transaction timeout. This can happen on slower mobile connections. Please try again.')
        }
        // Re-throw with original message for other errors
        throw new Error(`Transaction failed: ${errorMessage}. Please try again.`)
      }

      // Step 4: Wait for confirmation using polling (avoids WebSocket subscription issues)
      // Poll for transaction confirmation instead of using confirmTransaction which uses subscriptions
      const maxAttempts = 30 // 30 seconds max wait time
      let attempts = 0
      let confirmed = false
      
      while (attempts < maxAttempts && !confirmed) {
        try {
          const status = await connection.getSignatureStatus(signature)
          if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
            confirmed = true
            break
          }
          if (status?.value?.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`)
          }
        } catch (error) {
          // Ignore errors during polling, just retry
        }
        await new Promise(resolve => setTimeout(resolve, 1000)) // Wait 1 second between attempts
        attempts++
      }
      
      if (!confirmed) {
        throw new Error('Transaction confirmation timeout. Please check your wallet or transaction explorer.')
      }

      // At this point the on-chain transaction is confirmed. Hide the entry form
      // and keep only the processing dialog visible while we verify and sync tickets.
      setShowEnterRaffleDialog(false)

      // Celebrate as soon as the transaction is confirmed (before verify) so OWL and others get confetti even if server verification is delayed or fails
      setSuccess(true)
      requestAnimationFrame(() => fireGreenConfetti())

      // Step 5: Verify entry with transaction signature
      const verifyResponse = await fetch('/api/entries/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entryId,
          transactionSignature: signature,
        }),
      })

      // Handle "verification pending" responses explicitly (202 Accepted).
      // Note: fetch treats 202 as ok, so we must branch on status before checking response.ok.
      if (verifyResponse.status === 202) {
        let errorData: { error?: string; details?: string; message?: string } = {}
        try {
          const contentType = verifyResponse.headers.get('content-type') || ''
          if (contentType.includes('application/json')) {
            errorData = await verifyResponse.json()
          }
        } catch {
          // Non-JSON or empty body
        }

        // Transaction signature saved; verification will retry automatically (confetti already fired on tx confirm)
        setSuccess(true)
        setError(null)
        console.log('Verification pending:', errorData.message || errorData.details)

        router.refresh()
        await new Promise(resolve => setTimeout(resolve, 1000))
        fetchEntries()

        // Schedule refetches so when backend confirms (RPC delay), "Your Tickets" updates without manual refresh
        const refetchDelays = [2000, 5000, 10000, 20000]
        refetchDelays.forEach((ms) => {
          setTimeout(() => fetchEntries(), ms)
        })

        // Retry verify a few times so server can confirm once RPC has the tx (common on mobile)
        const verifyRetryDelays = [5000, 15000]
        verifyRetryDelays.forEach((ms) => {
          setTimeout(async () => {
            try {
              const retryRes = await fetch('/api/entries/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entryId, transactionSignature: signature }),
              })
              if (retryRes.ok) {
                router.refresh()
                fetchEntries()
              }
            } catch {
              // ignore
            }
          }, ms)
        })

        return
      }

      if (!verifyResponse.ok) {
        // Safe parse for desktop and mobile: avoid JSON errors on 502/non-JSON bodies
        let errorData: { error?: string; details?: string; message?: string } = {}
        try {
          const contentType = verifyResponse.headers.get('content-type') || ''
          if (contentType.includes('application/json')) {
            errorData = await verifyResponse.json()
          }
        } catch {
          // Non-JSON or empty body
        }

        // Permanent failure
        const errorMessage = errorData.details && errorData.error
          ? `${errorData.error}: ${errorData.details}`
          : (errorData.error || 'Failed to verify transaction. Please try again.')
        console.error('Verification error details:', errorData)
        throw new Error(errorMessage)
      }

      setSuccess(true)
      // Immediately refresh server-side data to ensure consistency
      router.refresh()
      
      // If using realtime, it will automatically update. Otherwise, trigger a fetch.
      // Wait a moment for the database commit, then fetch once
      await new Promise(resolve => setTimeout(resolve, 1000))
      fetchEntries()
      
      // If not using realtime, do one more fetch after a short delay to catch the update
      if (!isUsingRealtime) {
        await new Promise(resolve => setTimeout(resolve, 1500))
        fetchEntries()
      }
      
      // Dialog has already been closed once the transaction confirmed.
    } catch (err) {
      console.error('Purchase error:', err)
      setSuccess(false)

      // Provide helpful error messages for common RPC errors
      let errorMessage = 'Failed to purchase tickets'
      let isUnconfirmedPayment = false
      if (err instanceof Error) {
        const errMsg = err.message || ''
        const errorStr = err.toString()

        if (errMsg.includes('403') || errMsg.includes('Access forbidden')) {
          errorMessage = errMsg
        } else if (errMsg.includes('RPC endpoint') || errMsg.includes('RPC')) {
          errorMessage = errMsg
        } else if (errMsg.includes('Temporary internal error') || errorStr.includes('code":19') || errorStr.includes('"code":19')) {
          errorMessage = 'Temporary RPC error. Please try again in a moment. If this persists, the RPC endpoint may be experiencing issues. Consider setting NEXT_PUBLIC_SOLANA_RPC_URL to a private endpoint.'
        } else if (errMsg.includes('500') || errorStr.includes('"code":19')) {
          errorMessage = 'RPC server error. Please try again in a few moments.'
        } else if (errMsg.includes('Network') || errMsg.includes('timeout')) {
          errorMessage = 'Network error. Please check your connection and try again.'
        } else if (errMsg === 'server error' || errMsg.includes('Failed to verify')) {
          errorMessage = 'Your payment was sent, but we couldn\'t confirm it right away. Refresh the page in a moment — your ticket should appear. If it doesn\'t, try again or contact support with your transaction signature.'
          isUnconfirmedPayment = true
        } else {
          errorMessage = errMsg
        }
      }

      setError(errorMessage)

      // Payment was sent but verification failed (e.g. mobile/RPC delay): refresh and poll so ticket can appear without manual refresh
      if (isUnconfirmedPayment) {
        router.refresh()
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
        delay(1500).then(() => fetchEntries())
        delay(4000).then(() => fetchEntries())
        delay(8000).then(() => fetchEntries())
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const handleQuantityChange = (value: string) => {
    // Allow empty string for erasing
    setTicketQuantityDisplay(value)
    if (value === '') {
      return // Allow empty display temporarily
    }
    const numValue = parseInt(value)
    if (isNaN(numValue)) {
      return // Don't update if not a valid number
    }
    const clampedValue = Math.max(1, Math.min(numValue, maxPurchaseQuantity))
    setTicketQuantity(clampedValue)
    // Sync display value with clamped value if it was changed
    if (clampedValue !== numValue) {
      setTicketQuantityDisplay(clampedValue.toString())
    }
  }

  const handleQuantityBlur = () => {
    // When input loses focus, ensure it has a valid value
    if (ticketQuantityDisplay === '' || isNaN(parseInt(ticketQuantityDisplay))) {
      setTicketQuantityDisplay('1')
      setTicketQuantity(1)
    } else {
      const numValue = parseInt(ticketQuantityDisplay)
      const clampedValue = Math.max(1, Math.min(numValue, maxPurchaseQuantity))
      setTicketQuantity(clampedValue)
      setTicketQuantityDisplay(clampedValue.toString())
    }
  }

  const handleOpenEnterRaffleDialog = () => {
    preloadConfetti()
    setTicketQuantity(1)
    setTicketQuantityDisplay('1')
    setError(null)
    setSuccess(false)
    setShowEnterRaffleDialog(true)
  }

  const handleOpenNftTransferDialog = () => {
    setNftTransferSignature('')
    setTransferError(null)
    setTransferSuccess(false)
    setShowNftTransferDialog(true)
  }

  const handleSubmitNftTransfer = async () => {
    if (!connected || !publicKey) {
      setTransferError('Please connect your wallet first')
      return
    }

    if (!nftTransferSignature.trim()) {
      setTransferError('Please enter a transaction signature')
      return
    }

    setIsSubmittingTransfer(true)
    setTransferError(null)
    setTransferSuccess(false)

    try {
      const response = await fetch(`/api/raffles/${raffle.id}/nft-transfer`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction_signature: nftTransferSignature.trim(),
          wallet_address: publicKey.toBase58(),
        }),
      })

      if (!response.ok) {
        let msg = 'Failed to record NFT transfer transaction.'
        try {
          const contentType = response.headers.get('content-type') || ''
          if (contentType.includes('application/json')) {
            const errorData = await response.json()
            if (typeof errorData?.error === 'string') msg = errorData.error
          }
        } catch {
          // keep default msg
        }
        throw new Error(msg)
      }

      setTransferSuccess(true)
      
      // Refresh the page to show the updated transaction signature
      setTimeout(() => {
        router.refresh()
        setShowNftTransferDialog(false)
      }, 1500)
    } catch (err) {
      console.error('Error submitting NFT transfer:', err)
      setTransferError(err instanceof Error ? err.message : 'Failed to record NFT transfer transaction')
    } finally {
      setIsSubmittingTransfer(false)
    }
  }

  const handleClaimPrize = async () => {
    if (!connected || !publicKey) {
      setClaimPrizeError('Please connect your wallet first.')
      return
    }
    setClaimPrizeLoading(true)
    setClaimPrizeError(null)
    setClaimPrizePhase('loading')
    setClaimPrizeTxSignature(null)
    setClaimPrizeAlreadyClaimed(false)

    const signInForClaim = async (): Promise<boolean> => {
      if (!publicKey || !signMessage) {
        setClaimPrizeError('Sign in required. Connect your wallet and sign the message.')
        return false
      }
      try {
        const walletAddr = publicKey.toBase58()
        const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
          credentials: 'include',
        })
        if (!nonceRes.ok) {
          const data = await nonceRes.json().catch(() => ({}))
          const msg = typeof data?.error === 'string' ? data.error : 'Failed to get sign-in nonce'
          setClaimPrizeError(msg)
          return false
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
          const msg =
            typeof data?.error === 'string' ? data.error : 'Sign-in verification failed'
          setClaimPrizeError(msg)
          return false
        }
        return true
      } catch (e) {
        setClaimPrizeError(e instanceof Error ? e.message : 'Sign-in failed')
        return false
      }
    }

    try {
      let response = await fetch(`/api/raffles/${raffle.id}/claim-prize`, {
        method: 'POST',
        credentials: 'include',
      })
      if (response.status === 401) {
        const signedIn = await signInForClaim()
        if (!signedIn) {
          setClaimPrizePhase('idle')
          setClaimPrizeLoading(false)
          return
        }
        response = await fetch(`/api/raffles/${raffle.id}/claim-prize`, {
          method: 'POST',
          credentials: 'include',
        })
      }
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const msg = typeof data?.error === 'string' ? data.error : 'Failed to claim prize'
        throw new Error(msg)
      }
      const signature =
        typeof data?.transactionSignature === 'string' ? data.transactionSignature : null
      if (!signature) {
        throw new Error('Missing transaction signature from server')
      }
      setClaimPrizeTxSignature(signature)
      setClaimPrizeAlreadyClaimed(data?.alreadyClaimed === true)
      setClaimPrizePhase('success')
    } catch (err) {
      setClaimPrizePhase('idle')
      setClaimPrizeTxSignature(null)
      setClaimPrizeError(err instanceof Error ? err.message : 'Failed to claim prize')
    } finally {
      setClaimPrizeLoading(false)
    }
  }

  const closeClaimPrizeSuccess = () => {
    setClaimPrizePhase('idle')
    setClaimPrizeTxSignature(null)
    setClaimPrizeAlreadyClaimed(false)
    router.refresh()
  }

  const handleClaimTicketRefund = useCallback(
    async (entryId: string) => {
      if (!connected || !publicKey) {
        setClaimRefundError('Please connect your wallet first.')
        return
      }
      setClaimRefundLoadingEntryId(entryId)
      setClaimRefundError(null)

      const signInForRefund = async (): Promise<boolean> => {
        if (!publicKey || !signMessage) {
          setClaimRefundError('Sign in required. Connect your wallet and sign the message.')
          return false
        }
        try {
          const walletAddr = publicKey.toBase58()
          const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
            credentials: 'include',
          })
          if (!nonceRes.ok) {
            const data = await nonceRes.json().catch(() => ({}))
            setClaimRefundError(
              typeof data?.error === 'string' ? data.error : 'Failed to get sign-in nonce'
            )
            return false
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
            setClaimRefundError(
              typeof data?.error === 'string' ? data.error : 'Sign-in verification failed'
            )
            return false
          }
          return true
        } catch (e) {
          setClaimRefundError(e instanceof Error ? e.message : 'Sign-in failed')
          return false
        }
      }

      try {
        let res = await fetch('/api/entries/claim-refund', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ entryId }),
        })
        if (res.status === 401) {
          const ok = await signInForRefund()
          if (!ok) return
          res = await fetch('/api/entries/claim-refund', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ entryId }),
          })
        }
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          const msg =
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not claim refund'
          throw new Error(msg)
        }
        router.refresh()
      } catch (e) {
        setClaimRefundError(e instanceof Error ? e.message : 'Could not claim refund')
      } finally {
        setClaimRefundLoadingEntryId(null)
      }
    },
    [connected, publicKey, signMessage, router]
  )

  const handleEnsureRefundTerminal = useCallback(async () => {
    setRefundTerminalLoading(true)
    setClaimRefundError(null)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/ensure-min-threshold-terminal`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg =
          typeof (json as { error?: string }).error === 'string'
            ? (json as { error: string }).error
            : 'Could not enable refunds'
        throw new Error(msg)
      }
      router.refresh()
    } catch (e) {
      setClaimRefundError(e instanceof Error ? e.message : 'Could not enable refunds')
    } finally {
      setRefundTerminalLoading(false)
    }
  }, [raffle.id, router])

  const showDepositEscrow =
    !raffle.prize_deposited_at &&
    (isCreator || isAdmin) &&
    ((raffle.prize_type === 'nft' && !!raffle.nft_mint_address?.trim()) || isPartnerSplPrizeRaffle(raffle))

  const handleTransferNftToEscrow = useCallback(async () => {
    if (!publicKey || !escrowAddress) return
    if (!isPartnerSplPrizeRaffle(raffle) && !raffle.nft_mint_address?.trim()) return

    const partnerRaffle = isPartnerSplPrizeRaffle(raffle)
    const partnerPrizeMint = partnerRaffle ? getPartnerPrizeMintForCurrency(raffle.prize_currency) : null
    const transferAssetId = partnerRaffle
      ? partnerPrizeMint || ''
      : typeof raffle.nft_token_id === 'string' && raffle.nft_token_id.trim()
        ? raffle.nft_token_id.trim()
        : (raffle.nft_mint_address as string)
    const depositLogCtx = {
      raffleId: raffle.id,
      raffleSlug: raffle.slug,
      nftMint: partnerRaffle ? partnerPrizeMint || '' : (raffle.nft_mint_address as string),
      transferAssetId,
      escrowAddress,
      fromWallet: publicKey.toBase58(),
    }
    logEscrowDepositStart({
      ...depositLogCtx,
      dbPrizeStandard: raffle.prize_standard,
      displayLabel: raffle.title,
    })
    setShowEscrowConfirmDialog(false)
    setDepositEscrowError(null)
    setDepositEscrowFrozenDiagnostics(null)
    setShowManualEscrowFallback(false)
    setDepositEscrowSuccess(false)
    setDepositLastTxSignature(null)
    setDepositEscrowProgressOpen(true)
    setDepositEscrowProgressStep('wallet')
    setDepositVerifyAttemptLabel({ current: 0, max: VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS })
    setDepositEscrowLoading(true)

    const signInForSession = async (): Promise<boolean> => {
      if (!publicKey || !signMessage) {
        setDepositEscrowError('Sign in required. Connect your wallet and sign in.')
        return false
      }
      try {
        const walletAddr = publicKey.toBase58()
        const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
          credentials: 'include',
        })
        if (!nonceRes.ok) {
          const data = await nonceRes.json().catch(() => ({}))
          const msg = typeof data?.error === 'string' ? data.error : 'Failed to get sign-in nonce'
          setDepositEscrowError(msg)
          return false
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
          const msg =
            typeof data?.error === 'string' ? data.error : 'Sign-in verification failed'
          setDepositEscrowError(msg)
          return false
        }
        return true
      } catch (e) {
        setDepositEscrowError(e instanceof Error ? e.message : 'Sign-in failed')
        return false
      }
    }

    const runVerifyWithOptionalSignIn = async (depositTx?: string | null): Promise<boolean> => {
      const attemptOpts = {
        onAttempt: (current: number, max: number) => {
          setDepositEscrowProgressStep('verify')
          setDepositVerifyAttemptLabel({ current, max })
        },
      }
      try {
        let result = await verifyPrizeDepositWithRetries(raffle.id, { depositTx, ...attemptOpts })
        if (!result.ok && result.status === 401) {
          setDepositEscrowProgressStep('sign_in')
          const signedIn = await signInForSession()
          if (!signedIn) return false
          setDepositEscrowProgressStep('verify')
          result = await verifyPrizeDepositWithRetries(raffle.id, { depositTx, ...attemptOpts })
        }
        if (!result.ok) {
          setDepositEscrowError(result.error)
          setDepositEscrowFrozenDiagnostics(result.frozenEscrowDiagnostics ?? null)
          return false
        }
        return true
      } catch (e) {
        setDepositEscrowError(e instanceof Error ? e.message : 'Verification failed')
        return false
      }
    }

    const finalizeAfterTransfer = async (depositTx?: string): Promise<boolean> => {
      if (depositTx?.trim()) {
        setDepositLastTxSignature(depositTx.trim())
      }
      setDepositEscrowProgressStep('verify')
      const verified = await runVerifyWithOptionalSignIn(depositTx)
      logEscrowDepositVerify(
        depositLogCtx,
        verified,
        verified ? undefined : 'Server verify did not confirm escrow yet (see UI message)'
      )
      if (verified) {
        setDepositEscrowSuccess(true)
        setDepositEscrowError(null)
        setDepositEscrowFrozenDiagnostics(null)
        setShowManualEscrowFallback(false)
        router.refresh()
      } else {
        setDepositEscrowSuccess(false)
      }
      return verified
    }

    /** Same UX for every path: show “confirming on-chain”, wait for RPC, then server verify. */
    const afterWalletSignature = async (sig: string, logSignedPath: EscrowDepositPath) => {
      setDepositEscrowProgressStep('chain')
      await confirmSignatureSuccessOnChain(connection, sig)
      logEscrowDepositSigned(depositLogCtx, logSignedPath, sig)
      await finalizeAfterTransfer(sig)
    }

    try {
      try {
      if (partnerRaffle) {
        const prizeCur = String(raffle.prize_currency || '').trim().toUpperCase()
        const mintStr = getPartnerPrizeMintForCurrency(raffle.prize_currency)
        const rawNeed = humanPartnerPrizeToRawUnits(raffle.prize_currency, raffle.prize_amount)
        if (rawNeed == null || !mintStr) {
          setDepositEscrowError(`This raffle has an invalid ${prizeCur || 'token'} prize amount.`)
          return
        }
        const mintPk = new PublicKey(mintStr)
        const escrowPubkey = new PublicKey(escrowAddress)
        logEscrowDepositPath(depositLogCtx, 'spl_transfer', { note: `partner_${prizeCur}` })
        let resolvedHolder = await getFungibleHolderInWallet(
          connection,
          mintPk,
          publicKey,
          rawNeed,
          'processed'
        )
        for (
          let attempt = 0;
          attempt < HOLDER_LOOKUP_MAX_ATTEMPTS - 1 && !resolvedHolder;
          attempt++
        ) {
          await new Promise((r) => setTimeout(r, 700))
          resolvedHolder = await getFungibleHolderInWallet(
            connection,
            mintPk,
            publicKey,
            rawNeed,
            'processed'
          )
        }
        if (!resolvedHolder) {
          setDepositEscrowError(
            `Your wallet does not show enough ${prizeCur} for this prize yet, or the token account is delegated. Top up ${prizeCur} or fix the account and try again.`
          )
          setShowManualEscrowFallback(true)
          return
        }
        const { tokenProgram, tokenAccount: sourceTokenAccount } = resolvedHolder
        const escrowAta = await getAssociatedTokenAddress(
          mintPk,
          escrowPubkey,
          false,
          tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
        const tx = new Transaction()
        try {
          await getAccount(connection, escrowAta, 'confirmed', tokenProgram)
        } catch {
          tx.add(
            createAssociatedTokenAccountInstruction(
              publicKey,
              escrowAta,
              escrowPubkey,
              mintPk,
              tokenProgram,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          )
        }
        tx.add(
          createTransferInstruction(
            sourceTokenAccount,
            escrowAta,
            publicKey,
            rawNeed,
            [],
            tokenProgram
          )
        )
        if (!connected) {
          setDepositEscrowError('Connect a wallet that can sign token transfers.')
          return
        }
        const sig = await sendTransaction(tx, connection)
        await afterWalletSignature(sig, 'spl_transfer')
        return
      }

      const mint = new PublicKey(raffle.nft_mint_address as string)
      const escrowPubkey = new PublicKey(escrowAddress)
      // Prefer DB value; otherwise default to SPL/Token-2022 path first and fall back to Mpl Core.
      const standard: PrizeStandard = raffle.prize_standard ?? 'spl'

      const mintShort =
        transferAssetId.length > 16
          ? `${transferAssetId.slice(0, 4)}…${transferAssetId.slice(-4)}`
          : transferAssetId
      if (standard === 'mpl_core') {
        if (!walletAdapter) {
          logEscrowDepositAbort(depositLogCtx, 'wallet_adapter_not_ready', { path: 'mpl_core' })
          setDepositEscrowError('Wallet adapter not ready for Core transfer. Refresh and try again.')
          return
        }
        logEscrowDepositPath(depositLogCtx, 'mpl_core')
        const sig = await transferMplCoreToEscrow({
          connection,
          wallet: walletAdapter,
          assetId: transferAssetId,
          escrowAddress,
        })
        await afterWalletSignature(sig, 'mpl_core')
        return
      }

      if (standard === 'compressed') {
        if (!walletAdapter) {
          logEscrowDepositAbort(depositLogCtx, 'wallet_adapter_not_ready', { path: 'compressed' })
          setDepositEscrowError(
            'Wallet adapter not ready for compressed NFT transfer. Refresh and try again.'
          )
          return
        }
        logEscrowDepositPath(depositLogCtx, 'compressed')
        const sig = await transferCompressedNftToEscrow({
          connection,
          wallet: walletAdapter,
          assetId: transferAssetId,
          escrowAddress,
        })
        await afterWalletSignature(sig, 'compressed')
        return
      }

      // SPL / Token‑2022 path (existing behavior)
      let holder = await getNftHolderInWallet(connection, mint, publicKey)
      for (
        let attempt = 0;
        attempt < HOLDER_LOOKUP_MAX_ATTEMPTS - 1 && !holder;
        attempt++
      ) {
        await new Promise((r) => setTimeout(r, 800))
        holder = await getNftHolderInWallet(connection, mint, publicKey)
      }
      if (!holder) {
        let transferFallbackDetails: string | null = null
        // Auto-fallbacks: try compressed NFT transfer first, then Mpl Core transfer.
        // This keeps "transfer to escrow" wallet-sign flow working across common NFT standards.
        if (raffle.prize_standard !== 'mpl_core' && walletAdapter) {
          try {
            logEscrowDepositPath(depositLogCtx, 'fallback_compressed', {
              note: 'No SPL token account found; trying compressed transfer',
            })
            const sig = await transferCompressedNftToEscrow({
              connection,
              wallet: walletAdapter,
              assetId: transferAssetId,
              escrowAddress,
            })
            await afterWalletSignature(sig, 'fallback_compressed')
            return
          } catch (e) {
            // Not a compressed NFT (or proof/build failed); continue to Core fallback.
            transferFallbackDetails = e instanceof Error ? e.message : String(e)
            logEscrowDepositAbort(depositLogCtx, 'fallback_compressed_failed', {
              detail: transferFallbackDetails,
            })
          }
          try {
            logEscrowDepositPath(depositLogCtx, 'fallback_mpl_core', {
              note: 'Trying Metaplex Core transfer after compressed failed or N/A',
            })
            const sig = await transferMplCoreToEscrow({
              connection,
              wallet: walletAdapter,
              assetId: transferAssetId,
              escrowAddress,
            })
            await afterWalletSignature(sig, 'fallback_mpl_core')
            return
          } catch (e) {
            // Fall through to the detailed not-found guidance below.
            transferFallbackDetails = e instanceof Error ? e.message : String(e)
            logEscrowDepositAbort(depositLogCtx, 'fallback_mpl_core_failed', {
              detail: transferFallbackDetails,
            })
          }
        }
        const detailsSuffix = transferFallbackDetails
          ? ` Details: ${transferFallbackDetails}`
          : ''
        logEscrowDepositAbort(depositLogCtx, 'no_auto_transfer_path', {
          mintShort,
          details: detailsSuffix || undefined,
        })
        if (
          transferFallbackDetails &&
          isMplCoreNoApprovalsError(transferFallbackDetails)
        ) {
          setDepositEscrowError(
            mplCoreNoApprovalsEscrowMessage(mintShort, { fullAssetId: transferAssetId })
          )
          setShowManualEscrowFallback(false)
        } else {
          setDepositEscrowError(
            `We could not build an automatic transfer transaction for this NFT in-app (mint: ${mintShort}). You can still deposit it now: send the NFT directly to the escrow wallet in your wallet app, then tap Verify deposit below. Supported in-app auto transfer standards: SPL Token, Token-2022, Mpl Core, and compressed NFTs.${detailsSuffix}`
          )
          setShowManualEscrowFallback(true)
        }
        return
      }
      if ('delegated' in holder && holder.delegated) {
        logEscrowDepositAbort(depositLogCtx, 'nft_delegated_or_staked')
        setDepositEscrowError(
          'This NFT is currently staked or delegated. You can unstake and retry in-app, or send it manually to escrow from your wallet app, then tap Verify deposit.'
        )
        setShowManualEscrowFallback(true)
        return
      }
      if (!('tokenProgram' in holder) || !('tokenAccount' in holder)) {
        logEscrowDepositAbort(depositLogCtx, 'holder_data_incomplete')
        setDepositEscrowError('NFT holder data incomplete. Try again.')
        return
      }
      const { tokenProgram, tokenAccount: sourceTokenAccount } = holder

      // Try Token Metadata transfer first for Tokenkeg NFTs. This handles many pNFT/token-metadata
      // assets that can fail plain SPL transfer simulation in some wallets.
      if (walletAdapter && tokenProgram.equals(TOKEN_PROGRAM_ID)) {
        try {
          logEscrowDepositPath(depositLogCtx, 'token_metadata', {
            tokenProgram: tokenProgram.toBase58(),
            sourceTokenAccount: sourceTokenAccount.toBase58(),
          })
          const sig = await transferTokenMetadataNftToEscrow({
            connection,
            wallet: walletAdapter,
            mintAddress: raffle.nft_mint_address as string,
            escrowAddress,
          })
          await afterWalletSignature(sig, 'token_metadata')
          return
        } catch (tmErr) {
          logEscrowDepositAbort(depositLogCtx, 'token_metadata_failed_trying_spl', {
            detail: tmErr instanceof Error ? tmErr.message : String(tmErr),
          })
        }
      }

      const escrowAta = await getAssociatedTokenAddress(
        mint,
        escrowPubkey,
        false,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const tx = new Transaction()
      try {
        await getAccount(connection, escrowAta, 'confirmed', tokenProgram)
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            escrowAta,
            escrowPubkey,
            mint,
            tokenProgram,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        )
      }
      tx.add(
        createTransferInstruction(
          sourceTokenAccount,
          escrowAta,
          publicKey,
          1n,
          [],
          tokenProgram
        )
      )
      logEscrowDepositPath(depositLogCtx, 'spl_transfer', {
        tokenProgram: tokenProgram.toBase58(),
        sourceTokenAccount: sourceTokenAccount.toBase58(),
        escrowAta: escrowAta.toBase58(),
      })
      const sig = await sendTransaction(tx, connection)
      await afterWalletSignature(sig, 'spl_transfer')
      } catch (e) {
        logEscrowDepositError(depositLogCtx, e)
        const baseMessage = e instanceof Error ? e.message : 'Transfer failed'
        const short =
          transferAssetId.length > 16
            ? `${transferAssetId.slice(0, 4)}…${transferAssetId.slice(-4)}`
            : transferAssetId
        if (isMplCoreNoApprovalsError(baseMessage)) {
          setDepositEscrowError(
            mplCoreNoApprovalsEscrowMessage(short, { fullAssetId: transferAssetId })
          )
          setShowManualEscrowFallback(false)
        } else {
          setDepositEscrowError(baseMessage)
          setShowManualEscrowFallback(true)
        }
      }
    } finally {
      setDepositEscrowLoading(false)
      setDepositEscrowProgressOpen(false)
      setDepositEscrowProgressStep('idle')
      setDepositVerifyAttemptLabel({ current: 0, max: VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS })
    }
  }, [
    publicKey,
    signMessage,
    escrowAddress,
    raffle.id,
    raffle.slug,
    raffle.title,
    raffle.nft_mint_address,
    raffle.nft_token_id,
    raffle.prize_type,
    raffle.prize_currency,
    raffle.prize_amount,
    raffle.prize_standard,
    connection,
    connected,
    sendTransaction,
    router,
    walletAdapter,
  ])

  const handleVerifyPrizeDeposit = useCallback(async () => {
    const depositTxFromUi =
      manualDepositTx.trim() || (depositLastTxSignature?.trim() ?? '')
    if (
      isPartnerSplPrizeRaffle(raffle) &&
      !normalizeDepositTxSignatureInput(depositTxFromUi)
    ) {
      setDepositEscrowError(
        'Paste the Solana transaction signature (or a Solscan /tx/… link) for the transfer that sent the prize to escrow, then tap Verify deposit. If you used Transfer to escrow here, tap Verify again — we also try your last on-chain transfer from this page.'
      )
      setShowManualEscrowFallback(true)
      return
    }

    setDepositEscrowError(null)
    setDepositEscrowFrozenDiagnostics(null)
    setDepositVerifyLoading(true)
    setDepositEscrowProgressOpen(true)
    setDepositEscrowProgressStep('verify')
    setDepositVerifyAttemptLabel({ current: 0, max: VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS })
    const manualTx = depositTxFromUi
    try {
      const signInForSession = async (): Promise<boolean> => {
        if (!publicKey || !signMessage) {
          setDepositEscrowError('Sign in required. Connect your wallet and sign in.')
          return false
        }
        try {
          const walletAddr = publicKey.toBase58()
          const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
            credentials: 'include',
          })
          if (!nonceRes.ok) {
            const data = await nonceRes.json().catch(() => ({}))
            const msg = typeof data?.error === 'string' ? data.error : 'Failed to get sign-in nonce'
            setDepositEscrowError(msg)
            return false
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
            const msg =
              typeof data?.error === 'string' ? data.error : 'Sign-in verification failed'
            setDepositEscrowError(msg)
            return false
          }
          return true
        } catch (e) {
          setDepositEscrowError(e instanceof Error ? e.message : 'Sign-in failed')
          return false
        }
      }

      const attemptOpts = {
        onAttempt: (current: number, max: number) => {
          setDepositVerifyAttemptLabel({ current, max })
        },
      }
      let result = await verifyPrizeDepositWithRetries(raffle.id, {
        depositTx: manualTx || undefined,
        ...attemptOpts,
      })
      if (!result.ok && result.status === 401) {
        setDepositEscrowProgressStep('sign_in')
        const signedIn = await signInForSession()
        if (!signedIn) return
        setDepositEscrowProgressStep('verify')
        result = await verifyPrizeDepositWithRetries(raffle.id, {
          depositTx: manualTx || undefined,
          ...attemptOpts,
        })
      }
      if (!result.ok) {
        setDepositEscrowError(result.error)
        setDepositEscrowFrozenDiagnostics(result.frozenEscrowDiagnostics ?? null)
        setShowManualEscrowFallback(true)
        return
      }
      setDepositEscrowSuccess(true)
      setDepositEscrowError(null)
      setDepositEscrowFrozenDiagnostics(null)
      if (manualTx) {
        setDepositLastTxSignature(manualTx)
      }
      setManualDepositTx('')
      router.refresh()
    } catch (e) {
      setDepositEscrowError(e instanceof Error ? e.message : 'Verification failed')
      setShowManualEscrowFallback(true)
    } finally {
      setDepositVerifyLoading(false)
      setDepositEscrowProgressOpen(false)
      setDepositEscrowProgressStep('idle')
      setDepositVerifyAttemptLabel({ current: 0, max: VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS })
    }
  }, [
    raffle.id,
    raffle.prize_type,
    raffle.prize_currency,
    router,
    publicKey,
    signMessage,
    manualDepositTx,
    depositLastTxSignature,
  ])

  const handleReturnPrizeToCreator = useCallback(async () => {
    const reason = returnPrizeReason as 'cancelled' | 'wrong_nft' | 'dispute' | 'platform_error' | 'testing'
    if (!['cancelled', 'wrong_nft', 'dispute', 'platform_error', 'testing'].includes(reason)) {
      setReturnPrizeError('Please select a reason')
      return
    }
    setReturnPrizeError(null)
    setReturnPrizeSuccess(false)
    setReturnPrizeLoading(true)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/return-prize-to-creator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = typeof data?.error === 'string' ? data.error : 'Failed to return prize to creator'
        setReturnPrizeError(msg)
        return
      }
      setReturnPrizeSuccess(true)
      setTimeout(() => {
        router.refresh()
        setShowReturnPrizeDialog(false)
      }, 1500)
    } catch (e) {
      setReturnPrizeError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setReturnPrizeLoading(false)
    }
  }, [raffle.id, returnPrizeReason, router])

  const handleRequestCancellation = useCallback(async () => {
    setRequestCancelLoading(true)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/request-cancellation`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Failed to request cancellation')
        return
      }
      router.refresh()
    } finally {
      setRequestCancelLoading(false)
    }
  }, [raffle.id, router])

  const handleClaimProceeds = useCallback(async () => {
    setClaimProceedsError(null)
    setClaimProceedsLoading(true)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/claim-proceeds`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setClaimProceedsError(
          typeof (data as { error?: string }).error === 'string'
            ? (data as { error: string }).error
            : 'Could not claim proceeds. Sign in on My Dashboard if you are not signed in yet.'
        )
        return
      }
      router.refresh()
    } catch (e) {
      setClaimProceedsError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setClaimProceedsLoading(false)
    }
  }, [raffle.id, router])

  const fetchOffers = useCallback(async () => {
    setOffersLoading(true)
    setOffersError(null)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/offers`, {
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setOffersError(typeof data?.error === 'string' ? data.error : 'Failed to load offers')
        return
      }
      setRaffleOffers(Array.isArray(data?.offers) ? data.offers : [])
      setOfferWindowEndsAt(typeof data?.offerWindowEndsAt === 'string' ? data.offerWindowEndsAt : null)
    } catch (e) {
      setOffersError(e instanceof Error ? e.message : 'Failed to load offers')
    } finally {
      setOffersLoading(false)
    }
  }, [raffle.id])

  const handleSubmitOffer = useCallback(async () => {
    setOffersError(null)
    const amount = Number(newOfferAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setOffersError('Enter a valid offer amount')
      return
    }
    setSubmitOfferLoading(true)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/offers`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setOffersError(typeof data?.error === 'string' ? data.error : 'Failed to submit offer')
        return
      }
      setNewOfferAmount('')
      await fetchOffers()
    } catch (e) {
      setOffersError(e instanceof Error ? e.message : 'Failed to submit offer')
    } finally {
      setSubmitOfferLoading(false)
    }
  }, [fetchOffers, newOfferAmount, raffle.id])

  const handleAcceptOffer = useCallback(
    async (offerId: string) => {
      setOffersError(null)
      setAcceptOfferIdLoading(offerId)
      try {
        const res = await fetch(`/api/raffles/${raffle.id}/offers/${offerId}/accept`, {
          method: 'POST',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setOffersError(typeof data?.error === 'string' ? data.error : 'Failed to accept offer')
          return
        }
        await fetchOffers()
      } catch (e) {
        setOffersError(e instanceof Error ? e.message : 'Failed to accept offer')
      } finally {
        setAcceptOfferIdLoading(null)
      }
    },
    [fetchOffers, raffle.id]
  )

  useEffect(() => {
    const winnerWallet = (raffle.winner_wallet ?? '').trim()
    if (!winnerWallet) return
    const raffleEndMs = new Date(raffle.end_time).getTime()
    const ended = !Number.isNaN(raffleEndMs) && raffleEndMs <= Date.now()
    if (!ended) return
    void fetchOffers()
  }, [fetchOffers, raffle.end_time, raffle.winner_wallet])

  // Check if raffle has ended
  const hasEnded = !isActive && !isFuture
  const winnerWalletNorm = (raffle.winner_wallet ?? '').trim()
  const walletNorm = walletAddress.trim()
  const isWinnerDetail = hasEnded && !!winnerWalletNorm && walletNorm === winnerWalletNorm
  const userHasEnteredDetail = userTickets > 0 && !isWinnerDetail
  const offerWindowEndsDate = offerWindowEndsAt ? new Date(offerWindowEndsAt) : null
  const offerWindowOpen =
    !!offerWindowEndsDate &&
    !Number.isNaN(offerWindowEndsDate.getTime()) &&
    offerWindowEndsDate.getTime() > Date.now()
  const prizeStillInEscrowForOffers =
    !(raffle.nft_transfer_transaction ?? '').trim() && !raffle.prize_returned_at
  const canViewOfferPanel = hasEnded && !!winnerWalletNorm
  const isOfferBuyer =
    connected && !!walletNorm && walletNorm !== winnerWalletNorm && prizeStillInEscrowForOffers

  const detailHeroCardStyle: CSSProperties =
    showEnteredStyle && userHasEnteredDetail
      ? {
          ...borderStyle,
          ['--entered-rgb' as string]: getThemeAccentRgbChannels(raffle.theme_accent),
          ['--card-status-glow' as string]: borderStyle.boxShadow,
        }
      : borderStyle

  // Confetti: show once when opening the winner modal on a past raffle you won
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isWinnerDetail || !showWinner) return

    // Respect OS-level reduced motion
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return

    const key = `confetti:raffle-win:${raffle.id}:${raffle.winner_wallet}`
    try {
      if (window.sessionStorage.getItem(key) === '1') return
      window.sessionStorage.setItem(key, '1')
    } catch {
      // sessionStorage can be blocked; still allow confetti once per mount
    }

    // Ensure module is warm for instant fire
    preloadConfetti()
    fireGreenConfetti()
  }, [isWinnerDetail, showWinner, raffle.id, raffle.winner_wallet])
  // Check if we should show the NFT transfer button (ended, has winner, NFT prize, admin, no transaction recorded yet)
  const showNftTransferButton = 
    hasEnded && 
    raffle.winner_wallet && 
    raffle.prize_type === 'nft' && 
    isAdmin && 
    !raffle.nft_transfer_transaction

  const showClaimPrizeButton =
    hasEnded &&
    raffle.prize_type === 'nft' &&
    !!winnerWalletNorm &&
    walletNorm === winnerWalletNorm &&
    !!raffle.prize_deposited_at &&
    !raffle.nft_transfer_transaction &&
    !raffle.prize_returned_at

  // Show "Return prize to creator" when: admin, NFT raffle, prize in escrow, not yet sent to winner, not already returned
  const showReturnPrizeButton =
    isAdmin &&
    raffle.prize_type === 'nft' &&
    !!raffle.prize_deposited_at &&
    !raffle.nft_transfer_transaction &&
    !raffle.prize_returned_at

  const handleShareRaffle = useCallback(async () => {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/raffles/${raffle.slug}`
    const shareData = {
      title: raffle.title,
      text: `Check out this raffle: ${raffle.title}`,
      url,
    }

    const canUseNativeShare =
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      // Prefer native share sheet on mobile/tablet; desktop UX is more reliable with copy.
      ((typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0) ||
        (typeof window.matchMedia === 'function' &&
          window.matchMedia('(hover: none), (pointer: coarse)').matches))

    if (canUseNativeShare) {
      try {
        await navigator.share(shareData)
        return
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url)
        setShareCopied(true)
        window.setTimeout(() => setShareCopied(false), 1800)
        return
      } catch {
        // If clipboard fails (permissions/unsupported), use prompt fallback.
      }
    }

    window.prompt('Copy raffle link:', url)
  }, [raffle.slug, raffle.title])

  // Size-based styling classes
  const sizeClasses = {
    small: {
      containerPadding: 'py-2 px-2',
      title: 'text-lg mb-0.5',
      description: 'text-xs',
      headerPadding: 'p-2',
      imageSpace: 'space-y-1',
      contentPadding: 'pt-2 space-y-2',
      contentText: 'text-sm',
      labelText: 'text-xs',
      buttonSize: 'sm',
      statsGrid: 'gap-1.5',
      badgeSize: 'sm',
    },
    medium: {
      containerPadding: 'py-4 px-3',
      title: 'text-xl mb-1',
      description: 'text-sm',
      headerPadding: 'p-3',
      imageSpace: 'space-y-2',
      contentPadding: 'pt-3 space-y-3',
      contentText: 'text-base',
      labelText: 'text-xs',
      buttonSize: 'default',
      statsGrid: 'gap-2',
      badgeSize: 'sm',
    },
    large: {
      containerPadding: 'py-6 px-4',
      title: 'text-2xl mb-2',
      description: 'text-base',
      headerPadding: 'p-4',
      imageSpace: 'space-y-3',
      contentPadding: 'pt-4 space-y-4',
      contentText: 'text-lg',
      labelText: 'text-sm',
      buttonSize: 'lg',
      statsGrid: 'gap-3',
      badgeSize: 'default',
    },
  }

  const classes = sizeClasses[imageSize]

  return (
    <>
      <div className={`container mx-auto ${imageSize === 'small' ? 'py-4 px-3' : imageSize === 'medium' ? 'py-6 px-3 sm:px-4' : 'py-8 px-3 sm:px-4'}`}>
      <div className={`mx-auto ${imageSize === 'small' ? 'space-y-3 max-w-xl' : imageSize === 'medium' ? 'space-y-4 max-w-3xl' : 'space-y-6 max-w-5xl'}`}>
        {raffle.list_on_platform === false && (
          <p
            className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-3 text-sm leading-relaxed text-foreground/95 sm:text-base"
            role="status"
          >
            This raffle is not shown on the public raffles list. It was shared as a direct link (for
            example from a partner Discord). You can still enter tickets here like any other raffle.
          </p>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="default"
            onClick={() => router.push('/raffles')}
            className="touch-manipulation min-h-[44px] text-sm sm:text-base"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Listings
          </Button>
          <Button
            variant="outline"
            size="default"
            onClick={handleShareRaffle}
            className="touch-manipulation min-h-[44px] text-sm sm:text-base"
            title="Share this raffle or copy the raffle link."
          >
            <Share2 className="mr-2 h-4 w-4" />
            {shareCopied ? 'Copied!' : 'Share'}
          </Button>
          <RafflePromoPngButton
            title={raffle.title}
            slug={raffle.slug}
            ticketPrice={raffle.ticket_price}
            currency={raffle.currency}
            endTime={raffle.end_time}
            imageUrl={heroImageDead ? null : heroImageSrc}
            buttonLabel="PNG for X"
            fullWidth={false}
          />
          {isActive && profitInfoForSocialFlex.isProfitable && (
            <RaffleOverThresholdPngButton
              title={raffle.title}
              slug={raffle.slug}
              ticketPrice={raffle.ticket_price}
              currency={raffle.currency}
              endTime={raffle.end_time}
              imageUrl={heroImageDead ? null : heroImageSrc}
              metaLines={buildOverThresholdFlexMetaLines(raffle, profitInfoForSocialFlex)}
              buttonLabel="Flex PNG (social)"
              fullWidth={false}
            />
          )}
          {isCreator && (raffle.status === 'live' || raffle.status === 'ready_to_draw') && !raffle.cancellation_requested_at && (
            <Button
              variant="outline"
              size="default"
              onClick={handleRequestCancellation}
              disabled={requestCancelLoading}
              className="touch-manipulation min-h-[44px] text-sm sm:text-base border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
              title="Request cancellation. Ticket buyers get refunds in all cases. Within 24h: no fee to host. After 24h: host is charged cancellation fee."
            >
              {requestCancelLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-2 h-4 w-4" />
              )}
              Request cancellation
            </Button>
          )}
          {isCreator && raffle.cancellation_requested_at && (raffle.status !== 'cancelled') && (
            <span className="text-sm text-amber-600 dark:text-amber-400 self-center">
              Cancellation requested — waiting for admin
            </span>
          )}
          {isCreator &&
            raffle.status === 'successful_pending_claims' &&
            raffleUsesFundsEscrow(raffle) &&
            !raffle.creator_claimed_at &&
            !!raffle.settled_at?.trim() && (
              <Button
                variant="default"
                size="default"
                onClick={handleClaimProceeds}
                disabled={claimProceedsLoading}
                className="touch-manipulation min-h-[44px] text-sm sm:text-base"
                title="Claim your net ticket proceeds from funds escrow (platform fee goes to treasury in the same transaction)."
              >
                {claimProceedsLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Coins className="mr-2 h-4 w-4" />
                )}
                Claim proceeds
              </Button>
            )}
        </div>
        {claimProceedsError && (
          <p className="text-sm text-destructive mb-2" role="alert">
            {claimProceedsError}
          </p>
        )}
        {canViewOfferPanel && (
          <Card className="border-primary/25">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Post-win offers</CardTitle>
              <CardDescription>
                Offers are active for 24 hours after winner selection.
                {offerWindowEndsDate && ` Window ends ${formatDateTimeWithTimezone(offerWindowEndsDate.toISOString())}.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {offersError && <p className="text-sm text-destructive">{offersError}</p>}
              {!offerWindowOpen && (
                <p className="text-sm text-muted-foreground">
                  Offer window has closed for this raffle.
                </p>
              )}
              {!prizeStillInEscrowForOffers && (
                <p className="text-sm text-muted-foreground">
                  Offers are disabled because this raffle prize has already been claimed or returned.
                </p>
              )}
              {isOfferBuyer && offerWindowOpen && prizeStillInEscrowForOffers && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={newOfferAmount}
                    onChange={(e) => setNewOfferAmount(e.target.value)}
                    placeholder={`Your offer in ${raffle.currency}`}
                    className="touch-manipulation min-h-[44px]"
                  />
                  <Button
                    type="button"
                    onClick={handleSubmitOffer}
                    disabled={submitOfferLoading}
                    className="touch-manipulation min-h-[44px]"
                  >
                    {submitOfferLoading ? 'Submitting…' : 'Submit offer'}
                  </Button>
                </div>
              )}
              {offersLoading ? (
                <p className="text-sm text-muted-foreground">Loading offers…</p>
              ) : raffleOffers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No offers yet.</p>
              ) : (
                <div className="space-y-2">
                  {raffleOffers.map((offer) => (
                    <div
                      key={offer.id}
                      className="rounded-md border border-border/60 bg-muted/25 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {formatOfferAmount(Number(offer.amount), offer.currency)}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono break-all">
                          {offer.buyer_wallet}
                        </p>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">
                          {offer.status}
                        </p>
                      </div>
                      {isWinnerDetail && offer.status === 'pending' && offerWindowOpen && prizeStillInEscrowForOffers && (
                        <Button
                          size="sm"
                          onClick={() => void handleAcceptOffer(offer.id)}
                          disabled={acceptOfferIdLoading === offer.id}
                          className="touch-manipulation min-h-[44px] sm:min-h-9"
                        >
                          {acceptOfferIdLoading === offer.id ? 'Accepting…' : 'Accept'}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {showCreatorRefundCandidates && creatorRefundCandidates.length > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Users to refund</CardTitle>
              <CardDescription>
                This raffle did not meet the minimum draw threshold. These confirmed buyers should be refunded from
                funds escrow.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm">
                  <span className="text-muted-foreground">Total pending refunds:</span>{' '}
                  <span className="font-semibold">
                    {raffle.currency === 'USDC'
                      ? creatorRefundTotalPending.toFixed(2)
                      : creatorRefundTotalPending.toFixed(6)}{' '}
                    {raffle.currency}
                  </span>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                  onClick={async () => {
                    if (!creatorRefundCsv) return
                    try {
                      await navigator.clipboard.writeText(creatorRefundCsv)
                    } catch {
                      // no-op: copy is best-effort
                    }
                  }}
                >
                  Copy addresses + amounts
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                onClick={async () => {
                  if (!creatorRefundPayoutScript) return
                  try {
                    await navigator.clipboard.writeText(creatorRefundPayoutScript)
                  } catch {
                    // no-op: copy is best-effort
                  }
                }}
              >
                Copy payout script
              </Button>
              <div className="max-h-72 overflow-auto space-y-2">
                {creatorRefundCandidates.map((row, i) => {
                  const pendingAmount = Math.max(0, row.totalAmount - row.refundedAmount)
                  const fullyRefunded = pendingAmount <= 0
                  return (
                    <div key={row.wallet} className="rounded border border-border/60 bg-muted/30 p-2">
                      <p className="text-xs text-muted-foreground mb-1">User #{i + 1}</p>
                      <p className="text-xs font-mono break-all">{row.wallet}</p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">Amount to refund</span>
                        <span className="font-semibold font-mono whitespace-nowrap">
                          {raffle.currency === 'USDC' ? pendingAmount.toFixed(2) : pendingAmount.toFixed(6)}{' '}
                          {raffle.currency}
                        </span>
                      </div>
                      <p className="mt-1 text-xs">
                        {fullyRefunded ? (
                          <span className="text-emerald-600 dark:text-emerald-400">Refunded</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">Refund pending</span>
                        )}
                      </p>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
        {/* Mobile: raffle name in the empty space below nav buttons */}
        <div className="md:hidden mb-3">
          <h1 className="text-lg font-semibold truncate text-foreground" title={raffle.title}>
            {raffle.title}
          </h1>
        </div>
        {showDepositEscrow && (
          <>
            <Card className="border-amber-500/50 bg-amber-500/5">
              <CardHeader>
                <CardTitle className="text-lg">Prize in escrow required</CardTitle>
                <CardDescription>
                  {isPartnerSplPrizeRaffle(raffle) ? (
                    <>
                      <strong>Flow:</strong> Transfer your{' '}
                      <strong>{String(raffle.prize_currency || '').trim().toUpperCase() || 'Token'} prize</strong> to escrow
                      (your wallet will ask you to sign one SPL transaction). After it confirms, we{' '}
                      <strong>automatically verify</strong> the deposit and activate the raffle. Use <strong>Verify deposit</strong>{' '}
                      if you sent the prize manually — you must paste the transaction signature (deposit_tx). Tickets are still
                      paid in {raffle.currency}.
                    </>
                  ) : (
                    <>
                      <strong>Flow:</strong> Transfer the NFT to escrow below (your wallet will ask you to sign). After the
                      transaction succeeds, we <strong>automatically verify</strong> that the prize is in escrow and activate
                      the raffle—watch the progress popup. Use <strong>Verify deposit</strong> only if you sent the NFT
                      manually or the automatic step timed out. <strong>No listing fee</strong> — only network fees. The
                      prize stays locked until a winner claims it.
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!connected && (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Connect your wallet to transfer the{' '}
                    {isPartnerSplPrizeRaffle(raffle)
                      ? `${String(raffle.prize_currency || '').trim().toUpperCase() || 'token'} prize`
                      : 'NFT'}{' '}
                    to escrow.
                  </p>
                )}
                {!escrowAddress && connected && (
                  <p className="text-sm text-muted-foreground">Preparing…</p>
                )}
                {escrowAddress && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => setShowEscrowConfirmDialog(true)}
                        disabled={!connected || depositEscrowLoading}
                      >
                        {depositEscrowLoading
                          ? depositEscrowProgressStep === 'verify'
                            ? depositVerifyAttemptLabel.current > 0
                              ? `Verifying (${depositVerifyAttemptLabel.current}/${depositVerifyAttemptLabel.max})…`
                              : 'Verifying deposit…'
                            : depositEscrowProgressStep === 'sign_in'
                              ? 'Sign in to finish…'
                              : depositEscrowProgressStep === 'chain'
                                ? 'Confirming on-chain…'
                                : 'Approve in wallet…'
                          : isPartnerSplPrizeRaffle(raffle)
                            ? `Transfer ${String(raffle.prize_currency || '').trim().toUpperCase() || 'token'} to escrow`
                            : 'Transfer NFT to escrow'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleVerifyPrizeDeposit}
                        disabled={depositVerifyLoading}
                        title={
                          isPartnerSplPrizeRaffle(raffle)
                            ? 'Requires deposit transaction signature in the field below for token prizes'
                            : 'Checks on-chain that the NFT is in platform escrow, then activates the raffle'
                        }
                      >
                        {depositVerifyLoading
                          ? depositVerifyAttemptLabel.current > 0
                            ? `Verifying (${depositVerifyAttemptLabel.current}/${depositVerifyAttemptLabel.max})…`
                            : 'Verifying…'
                          : 'Verify deposit'}
                      </Button>
                    </div>
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {isPartnerSplPrizeRaffle(raffle) ? (
                          <>
                            If you send the prize token manually, paste the transaction signature below and tap Verify deposit.
                            The verify step checks that your tx credits the escrow token account for at least the declared prize
                            amount.
                          </>
                        ) : (
                          <>
                            If your wallet does not open a signature prompt here (common for some compressed NFTs), send the NFT manually to escrow in your wallet app, then tap Verify deposit. Phantom and similar wallets sometimes show &quot;No balance changes&quot; for Metaplex or Core NFT transfers — that preview can miss the real custody change; if you trust this site, confirming is still normal.
                          </>
                        )}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-xs break-all rounded bg-background/80 px-2 py-1">{escrowAddress}</code>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(escrowAddress)
                              setDepositEscrowError(null)
                            } catch {
                              setDepositEscrowError('Could not copy escrow address. Please copy it manually.')
                            }
                          }}
                        >
                          Copy escrow address
                        </Button>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="manual-deposit-tx" className="text-xs">
                          Deposit transaction signature (optional fallback)
                        </Label>
                        <Input
                          id="manual-deposit-tx"
                          value={manualDepositTx}
                          onChange={(e) => setManualDepositTx(e.target.value)}
                          placeholder="Paste Solana tx signature if auto-verify fails"
                          className="text-xs sm:text-sm"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full sm:w-auto touch-manipulation min-h-[44px] sm:min-h-0"
                          onClick={handleVerifyPrizeDeposit}
                          disabled={depositVerifyLoading || manualDepositTx.trim().length === 0}
                          title="Submit pasted transfer signature and verify escrow deposit"
                        >
                          {depositVerifyLoading ? 'Submitting…' : 'Submit signature'}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          If auto-verify fails after manual transfer, paste the transfer signature and tap Verify deposit again.
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isPartnerSplPrizeRaffle(raffle)
                        ? 'Verify deposit checks on-chain that the prize tokens reached escrow, then opens the raffle for entries.'
                        : 'Verify deposit checks on-chain that the NFT is in escrow, then opens the raffle for entries.'}
                    </p>
                    {depositLastTxSignature &&
                      !(depositEscrowSuccess && !depositEscrowError) && (
                        <div className="rounded-lg border border-sky-500/45 bg-sky-500/[0.12] p-4 space-y-2">
                          <p className="text-sm font-semibold text-sky-950 dark:text-sky-100">
                            {depositEscrowLoading
                              ? 'Transaction submitted — checking escrow…'
                              : 'On-chain transaction (proof)'}
                          </p>
                          <p className="text-xs text-sky-950/85 dark:text-sky-50/85 leading-relaxed">
                            {depositEscrowLoading
                              ? 'Your wallet already signed. Open Solscan to confirm the transfer on-chain while we finish the server check.'
                              : 'Use Solscan to see that the transfer executed. If our app still shows a warning, wait a few seconds for RPC to catch up, then tap Verify deposit again.'}
                          </p>
                          <a
                            href={solscanTransactionUrl(depositLastTxSignature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary font-medium hover:underline inline-flex items-center gap-1 touch-manipulation min-h-[44px] sm:min-h-0"
                            onTouchStart={handleMobileLinkTouchStart}
                            onTouchMove={handleMobileLinkTouchMove}
                            onTouchEnd={handleMobileLinkTouchEnd}
                          >
                            View transaction on Solscan
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          </a>
                        </div>
                      )}
                    {escrowExplorer && (
                      <div className="flex flex-col gap-2">
                        <a
                          href={escrowExplorer.prizeMintUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline inline-flex items-center gap-1 touch-manipulation min-h-[44px] sm:min-h-0"
                          onTouchStart={handleMobileLinkTouchStart}
                          onTouchMove={handleMobileLinkTouchMove}
                          onTouchEnd={handleMobileLinkTouchEnd}
                        >
                          View prize mint on explorer
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        </a>
                        {escrowExplorer.custodyUrl !== escrowExplorer.prizeMintUrl && (
                          <a
                            href={escrowExplorer.custodyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline inline-flex items-center gap-1 touch-manipulation min-h-[44px] sm:min-h-0"
                            onTouchStart={handleMobileLinkTouchStart}
                            onTouchMove={handleMobileLinkTouchMove}
                            onTouchEnd={handleMobileLinkTouchEnd}
                          >
                            Escrow token account (custody proof)
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          </a>
                        )}
                        {escrowExplorer.custodyUrl === escrowExplorer.prizeMintUrl && (
                          <p className="text-xs text-muted-foreground">
                            On Solscan, confirm the owner is the platform escrow wallet.
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
                {depositEscrowSuccess && !depositEscrowError && (
                  <div
                    role="status"
                    className="rounded-lg border border-emerald-500/45 bg-emerald-500/[0.12] p-4 space-y-2"
                  >
                    <div className="flex items-start gap-2">
                      <CheckCircle
                        className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5"
                        aria-hidden
                      />
                      <div className="space-y-2 min-w-0">
                        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                          Escrow confirmed — raffle updating
                        </p>
                        <p className="text-sm text-emerald-900/90 dark:text-emerald-50/90 leading-relaxed">
                          The prize is verified in escrow. This page should refresh momentarily; if it does not, reload
                          once. Your wallet UI can lag behind the chain — that does not mean the NFT is still yours.
                        </p>
                        {depositLastTxSignature && (
                          <a
                            href={solscanTransactionUrl(depositLastTxSignature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary font-medium hover:underline inline-flex items-center gap-1 touch-manipulation min-h-[44px] sm:min-h-0"
                            onTouchStart={handleMobileLinkTouchStart}
                            onTouchMove={handleMobileLinkTouchMove}
                            onTouchEnd={handleMobileLinkTouchEnd}
                          >
                            View deposit transaction
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {depositEscrowError && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="rounded-lg border border-destructive/50 bg-destructive/[0.08] p-4 space-y-3"
                  >
                    <p className="text-sm font-semibold text-destructive">
                      {isMplCoreNoApprovalsError(depositEscrowError)
                        ? 'This prize cannot be moved into escrow yet'
                        : isEscrowSplPrizeFrozenVerifyError(depositEscrowError)
                          ? 'NFT is in escrow, but the prize account is frozen'
                          : 'Transfer did not complete'}
                    </p>
                    <div className="text-sm text-foreground/90 leading-relaxed">
                      <LinkifiedText
                        text={depositEscrowError}
                        className="whitespace-pre-wrap"
                        linkClassName="text-primary underline font-medium break-all"
                      />
                    </div>
                    {isEscrowSplPrizeFrozenVerifyError(depositEscrowError) && depositEscrowFrozenDiagnostics && (
                      <div className="text-xs text-foreground/90 border-t border-destructive/15 pt-3 space-y-2 leading-relaxed">
                        <p className="font-medium text-foreground">On-chain details</p>
                        <p>
                          On Solscan, open the escrow <strong>token account</strong> (not only the mint) and check{' '}
                          <strong>Frozen</strong>. While that flag is on, transfers to a winner will fail even though the
                          NFT is in escrow.
                        </p>
                        <ul className="list-none space-y-2">
                          <li>
                            <a
                              href={solscanAccountUrl(depositEscrowFrozenDiagnostics.escrowTokenAccount)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-primary font-medium underline break-all touch-manipulation min-h-[44px] py-2"
                              onTouchStart={handleMobileLinkTouchStart}
                              onTouchMove={handleMobileLinkTouchMove}
                              onTouchEnd={handleMobileLinkTouchEnd}
                            >
                              Escrow token account — thaw this for claims
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            </a>
                          </li>
                          <li>
                            <a
                              href={solscanTokenUrl(depositEscrowFrozenDiagnostics.mint)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-primary font-medium underline break-all touch-manipulation min-h-[44px] py-2"
                              onTouchStart={handleMobileLinkTouchStart}
                              onTouchMove={handleMobileLinkTouchMove}
                              onTouchEnd={handleMobileLinkTouchEnd}
                            >
                              Prize mint
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            </a>
                          </li>
                          {depositEscrowFrozenDiagnostics.freezeAuthority ? (
                            <li className="text-muted-foreground break-all">
                              <span className="font-medium text-foreground">Freeze authority </span>
                              (who can sign thaw):{' '}
                              <a
                                href={solscanAccountUrl(depositEscrowFrozenDiagnostics.freezeAuthority)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary font-medium underline touch-manipulation min-h-[44px] inline-flex items-center gap-1 py-1"
                                onTouchStart={handleMobileLinkTouchStart}
                                onTouchMove={handleMobileLinkTouchMove}
                                onTouchEnd={handleMobileLinkTouchEnd}
                              >
                                {depositEscrowFrozenDiagnostics.freezeAuthority}
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              </a>
                            </li>
                          ) : null}
                        </ul>
                      </div>
                    )}
                    {showManualEscrowFallback && !isEscrowSplPrizeFrozenVerifyError(depositEscrowError) && (
                      <p className="text-xs text-amber-800 dark:text-amber-200 border-t border-destructive/15 pt-3 leading-relaxed">
                        <strong>Try manually:</strong>{' '}
                        {isPartnerSplPrizeRaffle(raffle) ? (
                          <>
                            send the <strong>prize tokens</strong> to the escrow address above (or confirm you already
                            did), paste the transfer&apos;s <strong>transaction signature</strong> (raw base58 or a Solscan
                            /tx/ link) in the field, then tap <strong>Verify deposit</strong>.
                          </>
                        ) : (
                          <>
                            send the NFT to the escrow address above, then tap <strong>Verify deposit</strong>.
                          </>
                        )}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Dialog open={showEscrowConfirmDialog} onOpenChange={setShowEscrowConfirmDialog}>
              <DialogContent className="sm:max-w-md max-h-[min(90dvh,32rem)] overflow-y-auto touch-manipulation">
                <DialogHeader>
                  <DialogTitle>Confirm transfer to escrow</DialogTitle>
                  <DialogDescription asChild>
                    <div className="space-y-3 text-left text-foreground">
                      <p className="text-sm">
                        Your wallet will open next so you can <strong>review and sign</strong> the transaction that
                        sends this prize to the platform escrow wallet.
                      </p>
                      <ul className="text-sm list-disc pl-5 space-y-1.5 text-muted-foreground">
                        <li>
                          Keep a little <strong>SOL</strong> for fees (and sometimes a one-time account rent). If
                          simulation fails, top up SOL and try again.
                        </li>
                        <li>
                          Some <strong>Metaplex Core</strong> collections restrict transfers until you complete steps in
                          their app or Discord. If that applies, Owltopia cannot override it.
                        </li>
                        <li>
                          <strong>The NFT stays locked in escrow</strong> until the raffle ends; the winner claims it from
                          escrow.
                        </li>
                      </ul>
                      <p className="text-sm font-medium text-foreground">Continue and open your wallet?</p>
                    </div>
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button
                    variant="outline"
                    onClick={() => setShowEscrowConfirmDialog(false)}
                    disabled={depositEscrowLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => handleTransferNftToEscrow()}
                    disabled={depositEscrowLoading}
                  >
                    {depositEscrowLoading ? 'Sending…' : 'Yes, transfer to escrow'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog
              open={depositEscrowProgressOpen}
              onOpenChange={(open) => {
                if (!open && (depositEscrowLoading || depositVerifyLoading)) return
                setDepositEscrowProgressOpen(open)
              }}
            >
              <DialogContent
                className="sm:max-w-md touch-manipulation"
                onPointerDownOutside={(e) => {
                  if (depositEscrowLoading || depositVerifyLoading) e.preventDefault()
                }}
                onEscapeKeyDown={(e) => {
                  if (depositEscrowLoading || depositVerifyLoading) e.preventDefault()
                }}
              >
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 pr-8">
                    {(depositEscrowLoading || depositVerifyLoading) && (
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden />
                    )}
                    {depositEscrowProgressStep === 'wallet'
                      ? 'Approve in your wallet'
                      : depositEscrowProgressStep === 'chain'
                        ? 'Confirming on the blockchain'
                        : depositEscrowProgressStep === 'sign_in'
                          ? 'Sign in to finish'
                          : 'Verifying NFT in escrow'}
                  </DialogTitle>
                  <DialogDescription asChild>
                    <div className="space-y-2 text-left text-sm text-muted-foreground">
                      {depositEscrowProgressStep === 'wallet' && (
                        <p>
                          Your wallet should open for you to <strong>review and approve</strong> the transfer. If nothing
                          appears, unlock your wallet app or try again on Wi‑Fi.
                        </p>
                      )}
                      {depositEscrowProgressStep === 'chain' && (
                        <p>
                          Waiting until your RPC sees the signed transaction (same step for SPL, Metaplex Core,
                          compressed, and Token Metadata paths). Usually quick after your wallet finishes; on busy
                          networks or mobile data it can take up to a couple of minutes—keep this page open.
                        </p>
                      )}
                      {depositEscrowProgressStep === 'sign_in' && (
                        <p>
                          Sign the message in your wallet so we can record that the prize is in escrow. This is separate
                          from the NFT transfer signature.
                        </p>
                      )}
                      {(depositEscrowProgressStep === 'verify' || depositVerifyLoading) && (
                        <p>
                          Checking with Owltopia that your NFT is in platform escrow so the raffle can go live. On mobile,
                          RPC can lag—we retry automatically
                          {depositVerifyAttemptLabel.max > 0
                            ? ` (up to ${depositVerifyAttemptLabel.max} tries).`
                            : '.'}
                          {depositVerifyAttemptLabel.current > 0 && (
                            <span className="block mt-2 font-medium text-foreground">
                              Attempt {depositVerifyAttemptLabel.current} of {depositVerifyAttemptLabel.max}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          </>
        )}

        <Card className={`${getThemeAccentClasses(raffle.theme_accent)} ${showEnteredStyle && userHasEnteredDetail ? 'relative raffle-entered-card' : ''}`} style={detailHeroCardStyle}>
          {showEnteredStyle && userHasEnteredDetail && (
            <div className="raffle-entered-overlay absolute inset-0 rounded-lg z-0" />
          )}
          <CardHeader className={classes.headerPadding}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
              <div className="flex-1 min-w-0">
                <CardTitle className={classes.title}>{raffle.title}</CardTitle>
                <CardDescription className={`${classes.description} break-words`}>
                  <RaffleDescriptionText raffle={raffle} />
                </CardDescription>
              </div>
              <div
                className={`relative w-full sm:w-auto shrink-0 rounded-2xl bg-gradient-to-r from-emerald-400/70 via-emerald-500/80 to-emerald-300/70 p-[1px] shadow-[0_0_30px_rgba(16,185,129,0.85)] ${
                  isEndingSoon ? 'animate-pulse' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3 rounded-[1rem] bg-background/90 px-3 py-2 sm:px-4 sm:py-2.5 touch-manipulation"
                  style={{ touchAction: 'manipulation' }}
                >
                  <div className="flex flex-col gap-1">
                    {raffle.ticket_price > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-emerald-100/80">Price</span>
                        <span className={`${classes.description} font-semibold flex items-center gap-1 text-emerald-50`}>
                          {raffle.ticket_price.toFixed(4).replace(/\.?0+$/, '')} {raffle.currency}
                          <CurrencyIcon
                            currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'}
                            size={14}
                            className="inline-block"
                          />
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-emerald-100/80">Tickets</span>
                      <span className={`${classes.description} font-semibold text-emerald-50`}>{totalTicketsSold}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                        isFuture
                          ? 'border-amber-300/80 bg-amber-500/20 text-amber-100'
                          : isActive
                            ? 'border-emerald-300/80 bg-emerald-500/25 text-emerald-50'
                            : 'border-sky-300/80 bg-sky-500/20 text-sky-50'
                      }`}
                    >
                      {statusPillLabel}
                    </span>
                    <span className="text-[11px] text-emerald-50/80">
                      {timeToEndLabel}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:flex-shrink-0">
                {isOwlEnabled() && raffle.creator_is_holder === true && (
                  <span
                    className="inline-flex items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/50 text-emerald-400 p-1"
                    title="Hosted by an Owltopia (Owl NFT) holder — 3% platform fee on tickets"
                    role="img"
                    aria-label="Owl holder"
                  >
                    <BadgeCheck className="h-4 w-4 flex-shrink-0" />
                  </span>
                )}
                <OwlVisionBadge score={currentOwlVisionScore} onOpenInTab={() => setActiveTab('owl-vision')} />
              </div>
            </div>
          </CardHeader>

          {hasHeroImageSection && (
            <>
              {!heroImageDead && !heroImageMintLoading && (
                <div className={`flex items-center justify-end gap-2 ${classes.headerPadding} pt-0 pb-2`}>
                  <span className="text-sm text-muted-foreground mr-2">Image size:</span>
                  <div className="flex gap-1 border rounded-md p-1">
                    <Button
                      variant={imageSize === 'small' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setImageSize('small')}
                      className="h-8 px-3"
                      title="Small"
                    >
                      <Grid3x3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={imageSize === 'medium' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setImageSize('medium')}
                      className="h-8 px-3"
                      title="Medium"
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={imageSize === 'large' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setImageSize('large')}
                      className="h-8 px-3"
                      title="Large"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              {heroImageMintLoading ? (
                <div
                  className={`w-full ${imageSize === 'small' ? 'aspect-[4/3]' : imageSize === 'medium' ? 'aspect-[4/3]' : 'aspect-[4/3]'} flex flex-col items-center justify-center gap-3 bg-muted/50 border rounded`}
                  role="status"
                  aria-live="polite"
                  aria-label="Loading artwork"
                >
                  <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden />
                  <span className="text-sm text-muted-foreground">Loading artwork…</span>
                </div>
              ) : !heroImageDead ? (
                <div
                  className={`!relative w-full ${imageSize === 'small' ? 'aspect-[4/3]' : imageSize === 'medium' ? 'aspect-[4/3]' : 'aspect-[4/3]'} overflow-hidden`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- proxy + IPFS: native img matches RaffleCard */}
                  <img
                    key={`${heroImgPhase}-${heroImageSrc}`}
                    src={heroImageSrc}
                    alt={raffle.title}
                    width={1200}
                    height={900}
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    className="h-full w-full object-contain"
                    onError={() => {
                      setHeroImgPhase((phase) => {
                        if (phase === 'primary') {
                          if (fallbackRawUrl) return 'fallback'
                          if (canMintImageFallback) return 'mint_loading'
                          if (displayAdminDisp) return 'admin'
                          return 'dead'
                        }
                        if (phase === 'fallback') {
                          if (canMintImageFallback) return 'mint_loading'
                          if (displayAdminDisp) return 'admin'
                          return 'dead'
                        }
                        if (phase === 'mint') {
                          if (displayAdminDisp) return 'admin'
                          return 'dead'
                        }
                        if (phase === 'admin') {
                          if (adminHeroRaw && adminHeroRaw !== displayAdminDisp) return 'admin_raw'
                          return 'dead'
                        }
                        if (phase === 'admin_raw') return 'dead'
                        return phase
                      })
                    }}
                  />
                </div>
              ) : (
                <div className={`w-full ${imageSize === 'small' ? 'aspect-[4/3]' : imageSize === 'medium' ? 'aspect-[4/3]' : 'aspect-[4/3]'} flex flex-col items-center justify-center gap-3 bg-muted border rounded p-4`}>
                  <span className="text-muted-foreground">Image unavailable</span>
                </div>
              )}
            </>
          )}

          {!hasHeroImageSection && (
            <div className={`w-full aspect-[4/3] flex flex-col items-center justify-center gap-3 bg-muted border rounded p-4 ${classes.headerPadding}`}>
              <span className="text-muted-foreground">Image unavailable</span>
            </div>
          )}

          {raffle.prize_type === 'nft' && raffle.prize_deposited_at && escrowExplorer && (
            <div className={`${classes.headerPadding} pt-0 flex flex-col gap-2`}>
              <a
                href={escrowExplorer.prizeMintUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1 touch-manipulation min-h-[44px] sm:min-h-0"
                onTouchStart={handleMobileLinkTouchStart}
                onTouchMove={handleMobileLinkTouchMove}
                onTouchEnd={handleMobileLinkTouchEnd}
              >
                View prize mint on explorer
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
              {escrowExplorer.custodyUrl !== escrowExplorer.prizeMintUrl && (
                <a
                  href={escrowExplorer.custodyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1 touch-manipulation min-h-[44px] sm:min-h-0"
                  onTouchStart={handleMobileLinkTouchStart}
                  onTouchMove={handleMobileLinkTouchMove}
                  onTouchEnd={handleMobileLinkTouchEnd}
                >
                  Escrow token account (custody proof)
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </a>
              )}
              {escrowExplorer.custodyUrl === escrowExplorer.prizeMintUrl && (
                <p className="text-xs text-muted-foreground">
                  On Solscan, confirm the owner is the platform escrow wallet.
                </p>
              )}
            </div>
          )}

          <CardContent className={classes.contentPadding}>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'overview' | 'owl-vision')}>
              <TabsList className="mb-4 w-full sm:w-auto">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="owl-vision" className="gap-1.5">
                  <Eye className="h-3.5 w-3.5" />
                  Owl Vision
                </TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="mt-0">
            {showClaimPrizeButton && (
              <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Trophy className="h-6 w-6 text-emerald-500 shrink-0 mt-0.5" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">You won this raffle</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      The prize NFT is in platform escrow (verified). Tap Claim prize and we&apos;ll send it to your connected wallet on Solana. If something fails, contact support — an admin can retry the escrow transfer.
                    </p>
                  </div>
                </div>
                <Button
                  variant="default"
                  size="default"
                  onClick={handleClaimPrize}
                  disabled={claimPrizeLoading || claimPrizePhase === 'loading'}
                  style={{ backgroundColor: themeColor, color: '#000' }}
                  className="w-full touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Send className="mr-2 h-4 w-4 shrink-0" />
                  {!connected ? 'Connect wallet' : claimPrizePhase === 'loading' ? 'Claiming…' : 'Claim prize'}
                </Button>
                {claimPrizeError && (
                  <p className="text-sm text-destructive">{claimPrizeError}</p>
                )}
              </div>
            )}
            <div className={`grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 ${classes.statsGrid}`}>
              {raffle.prize_amount != null && raffle.prize_amount > 0 && raffle.prize_currency && (
                <div>
                  <p className={classes.labelText + ' text-muted-foreground'}>Prize</p>
                  <p className={classes.contentText + ' font-bold'}>
                    {raffle.prize_amount} {raffle.prize_currency}
                  </p>
                </div>
              )}
              {raffle.ticket_price > 0 && (
                <div>
                  <p className={classes.labelText + ' text-muted-foreground'}>Ticket Price</p>
                  <div className={classes.contentText + ' font-bold flex items-center gap-2'}>
                    {raffle.ticket_price.toFixed(6).replace(/\.?0+$/, '')} {raffle.currency}
                    <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'} size={imageSize === 'small' ? 16 : 20} className="inline-block" />
                  </div>
                </div>
              )}
              {minTickets ? (
                <div className="col-span-2 sm:col-span-2 md:col-span-2">
                  <p className={classes.labelText + ' text-muted-foreground'}>Tickets Sold</p>
                  <p className={classes.contentText + ' font-bold'}>
                    {totalTicketsSold}
                  </p>
                </div>
              ) : (
                <div>
                  <p className={classes.labelText + ' text-muted-foreground'}>Confirmed Entries</p>
                  <p className={classes.contentText + ' font-bold'}>{totalTicketsSold}</p>
                </div>
              )}
              {raffle.max_tickets !== null && (
                <div>
                  <p className={classes.labelText + ' text-muted-foreground'}>Available Tickets</p>
                  <p className={classes.contentText + ' font-bold'}>
                    {availableTickets !== null ? availableTickets : raffle.max_tickets}
                  </p>
                </div>
              )}
              <div>
                <p className={classes.labelText + ' text-muted-foreground'}>Status</p>
                <div className="mt-3 sm:mt-2 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={(isFuture || isActive || isPendingDraft) ? 'default' : 'secondary'} className={`${imageSize === 'small' ? 'text-xs' : ''} ${statusBadgeClass}`} title={isFuture ? formatDateTimeWithTimezone(raffle.start_time) : formatDateTimeWithTimezone(raffle.end_time)}>
                      {isPendingDraft
                        ? 'Pending escrow deposit'
                        : isFuture
                        ? (new Date(raffle.start_time) <= serverTime
                            ? `Started ${formatDistance(new Date(raffle.start_time), serverTime, { addSuffix: true })}`
                            : `Starts ${formatDateTimeLocal(raffle.start_time)}`)
                        : isActive
                        ? (new Date(raffle.end_time) <= serverTime
                            ? `Ended ${formatDistance(serverTime, new Date(raffle.end_time), { addSuffix: true })}`
                            : `Ends ${formatDateTimeLocal(raffle.end_time)}`)
                        : `Ended ${formatDateTimeLocal(raffle.end_time)}`}
                    </Badge>
                    {minTickets && (
                      <Badge 
                        variant="outline" 
                        className="bg-orange-500/20 border-orange-500 text-orange-400 hover:bg-orange-500/30"
                        title={`Minimum ${minTickets} tickets required to draw winner`}
                      >
                        Draw Threshold: {minTickets}
                      </Badge>
                    )}
                    <RaffleDeadlineExtensionBadge count={raffle.time_extension_count} />
                    {raffle.prize_type === 'nft' && (
                      <Badge
                        variant="outline"
                        className={
                          raffle.prize_deposited_at
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 hover:bg-emerald-500/30'
                            : 'bg-amber-500/20 border-amber-500 text-amber-400 hover:bg-amber-500/30'
                        }
                        title={
                          raffle.prize_deposited_at
                            ? 'Prize escrow deposit verified'
                            : 'Prize escrow deposit not verified'
                        }
                      >
                        Escrow: {raffle.prize_deposited_at ? 'Deposited' : 'Not Deposited'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isFuture ? (
                      <>Starts: {formatDateTimeWithTimezone(raffle.start_time)}</>
                    ) : isPendingDraft ? (
                      <>Pending: waiting for NFT escrow deposit verification</>
                    ) : isActive ? (
                      <>Ends: {formatDateTimeWithTimezone(raffle.end_time)}</>
                    ) : (
                      <>Ended: {formatDateTimeWithTimezone(raffle.end_time)}</>
                    )}
                  </p>
                </div>
              </div>
              <div>
                <p className={classes.labelText + ' text-muted-foreground'}>Created By</p>
                <p className={classes.contentText + ' font-semibold break-all'}>
                  {creatorDisplayName || creatorWallet || 'Unknown'}
                </p>
              </div>
            </div>

            {(raffle.rank ||
              raffle.floor_price ||
              (raffle.prize_type === 'nft' && raffle.nft_mint_address?.trim())) && (
              <div className={`${imageSize === 'small' ? 'p-3' : imageSize === 'medium' ? 'p-4' : 'p-5'} rounded-lg bg-muted/30 border`}>
                <h3 className={`${imageSize === 'small' ? 'text-sm' : imageSize === 'medium' ? 'text-base' : 'text-lg'} font-semibold mb-3`}>Details</h3>
                <div className={`grid grid-cols-1 ${raffle.rank && raffle.floor_price ? 'sm:grid-cols-2' : ''} gap-4`}>
                  {raffle.rank && (
                    <div>
                      <p className={classes.labelText + ' text-muted-foreground'}>Rank</p>
                      <p className={classes.contentText + ' font-semibold'}>{raffle.rank}</p>
                    </div>
                  )}
                  {raffle.floor_price && (
                    <div>
                      <p className={classes.labelText + ' text-muted-foreground'}>Floor Price</p>
                      <p className={classes.contentText + ' font-semibold'}>{raffle.floor_price}</p>
                    </div>
                  )}
                </div>
                {raffle.prize_type === 'nft' && raffle.nft_mint_address?.trim() && (
                  <div className="mt-4 pt-4 border-t border-border/60">
                    <p className={classes.labelText + ' text-muted-foreground mb-2'}>Check collection floor</p>
                    <NftFloorCheckLinks mintAddress={raffle.nft_mint_address} className="min-w-0" />
                  </div>
                )}
              </div>
            )}

            {(() => {
              const profitInfo = getRaffleProfitInfo(raffle, entries)
              const ticketCur = normalizeRaffleTicketCurrency(raffle.currency)
              const thresholdCur =
                profitInfo.thresholdCurrency != null
                  ? normalizeRaffleTicketCurrency(profitInfo.thresholdCurrency)
                  : ticketCur
              const ticketRevenue = revenueInCurrency(profitInfo.revenue, ticketCur)
              const threshold = profitInfo.threshold
              const amountOver = profitInfo.surplusOverThreshold
              const thresholdLabel =
                raffle.prize_type === 'nft' ? 'Revenue threshold' : 'Threshold'
              return (
                <div className={`${imageSize === 'small' ? 'p-3' : imageSize === 'medium' ? 'p-4' : 'p-5'} rounded-lg bg-muted/30 border`}>
                  <h3 className={`${imageSize === 'small' ? 'text-sm' : imageSize === 'medium' ? 'text-base' : 'text-lg'} font-semibold mb-3`}>Revenue &amp; threshold</h3>
                  <div className="space-y-3">
                    <div>
                      <p className={classes.labelText + ' text-muted-foreground'}>Revenue (from tickets)</p>
                      <p className={classes.contentText + ' font-semibold'}>
                        {ticketRevenue.toFixed(ticketCur === 'USDC' ? 2 : 4)} {ticketCur}
                      </p>
                    </div>
                    <div>
                      <p className={classes.labelText + ' text-muted-foreground'}>{thresholdLabel}</p>
                      <p className={classes.contentText + ' font-semibold'}>
                        {threshold != null && threshold > 0
                          ? `${threshold.toFixed(thresholdCur === 'USDC' ? 2 : 4)} ${thresholdCur}`
                          : 'Not set'}
                      </p>
                    </div>
                    {amountOver != null && amountOver > 0 && (
                      <div>
                        <p className={classes.labelText + ' text-muted-foreground'}>Amount over threshold</p>
                        <p className={classes.contentText + ' font-semibold text-emerald-600 dark:text-emerald-400'}>
                          +{amountOver.toFixed(thresholdCur === 'USDC' ? 2 : 4)} {thresholdCur}
                        </p>
                        <p className={classes.labelText + ' text-muted-foreground mt-1.5'}>
                          That surplus is profit you keep above the cost side you set (prize, floor, or draw minimum). Net
                          ticket payout after the platform fee still uses your <span className="font-medium text-foreground">total</span>{' '}
                          gross sales—the dashboard shows that settled total after the draw.
                        </p>
                      </div>
                    )}
                    {threshold != null && threshold > 0 && (amountOver == null || amountOver <= 0) && (
                      <p className={classes.labelText + ' text-muted-foreground'}>
                        Profit above the threshold is ticket revenue past this bar. Until you are over it, there is no surplus
                        yet. Net payout after fees always reflects <span className="font-medium text-foreground">all</span>{' '}
                        sales once the raffle settles.
                      </p>
                    )}
                  </div>
                </div>
              )
            })()}

            {connected && (
              <div className={`${imageSize === 'small' ? 'p-2' : imageSize === 'medium' ? 'p-3' : 'p-4'} rounded-lg bg-muted/50 border border-primary/20`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={classes.labelText + ' text-muted-foreground'}>Your Tickets</p>
                    <p className={`${imageSize === 'small' ? 'text-lg' : imageSize === 'medium' ? 'text-xl' : 'text-2xl'} font-bold`} style={{ color: themeColor }}>
                      {userTicketsHeadline} {userTicketsHeadline === 1 ? 'ticket' : 'tickets'}
                    </p>
                    {userPendingTickets > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {userTickets > 0
                          ? `${userTickets} confirmed · ${userPendingTickets} still confirming on Solana`
                          : `We&apos;re confirming ${userPendingTickets} recent ${userPendingTickets === 1 ? 'entry' : 'entries'} on Solana. Confirmed total updates automatically.`}
                      </p>
                    )}
                  </div>
                  {(userTickets > 0 || userPendingTickets > 0) && (
                    <Badge variant="default" className={`${imageSize === 'small' ? 'text-xs px-2 py-1' : imageSize === 'medium' ? 'text-sm px-3 py-1.5' : 'text-lg px-4 py-2'}`}>
                      {userTickets + userPendingTickets}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <p className="text-xs text-muted-foreground">💡 Don&apos;t see your entry?</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs touch-manipulation"
                    onClick={() => fetchEntries()}
                  >
                    Refresh
                  </Button>
                </div>
              </div>
            )}

            {(showRefundTerminalButton ||
              buyerRefundableEntries.length > 0 ||
              buyerLegacyRefundEligible ||
              buyerCancelledRefundEligible) && (
              <div className="mb-4 space-y-4">
                {showRefundTerminalButton && (
                  <div
                    className={`${imageSize === 'small' ? 'p-3' : imageSize === 'medium' ? 'p-4' : 'p-5'} rounded-lg border border-amber-500/50 bg-amber-500/10 space-y-3`}
                    role="region"
                    aria-label="Enable refunds"
                  >
                    <div className="flex items-start gap-3">
                      <Ticket className="h-6 w-6 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">Enable ticket refunds</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          The draw minimum was not met after the extended deadline, but this listing has not switched to
                          refund mode yet. Tap below to update it—then use Claim refund for each of your entries (connect
                          the wallet you bought with).
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full touch-manipulation min-h-[44px]"
                      disabled={refundTerminalLoading}
                      onClick={() => void handleEnsureRefundTerminal()}
                    >
                      {refundTerminalLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Updating…
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Enable refunds and refresh
                        </>
                      )}
                    </Button>
                  </div>
                )}
                {buyerRefundableEntries.length > 0 && (
                  <div
                    className={`${imageSize === 'small' ? 'p-3' : imageSize === 'medium' ? 'p-4' : 'p-5'} rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-3`}
                    role="region"
                    aria-label="Claim ticket refunds"
                  >
                    <div className="flex items-start gap-3">
                      <Ticket className="h-6 w-6 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">Claim your ticket refund</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          The minimum was not met after the extension. Claim each confirmed payment back from funds escrow.
                          On mobile, use Wi‑Fi or stable data if the request fails.
                        </p>
                      </div>
                    </div>
                    <ul className="space-y-2">
                      {buyerRefundableEntries.map((entry) => {
                        const cur = String(entry.currency ?? raffle.currency ?? 'SOL').toUpperCase()
                        const decimals = cur === 'USDC' ? 2 : 4
                        const amt = Number(entry.amount_paid).toFixed(decimals)
                        return (
                          <li
                            key={entry.id}
                            className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-2 last:border-0 last:pb-0"
                          >
                            <span className="text-sm text-muted-foreground">
                              {entry.ticket_quantity === 1 ? '1 ticket' : `${entry.ticket_quantity} tickets`}
                            </span>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="touch-manipulation min-h-[44px] shrink-0 w-full sm:w-auto"
                              disabled={claimRefundLoadingEntryId === entry.id}
                              onClick={() => void handleClaimTicketRefund(entry.id)}
                            >
                              {claimRefundLoadingEntryId === entry.id ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                  Refunding…
                                </>
                              ) : (
                                `Claim ${amt} ${cur}`
                              )}
                            </Button>
                          </li>
                        )
                      })}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      Same action is available on{' '}
                      <Link href="/dashboard" className="text-primary underline font-medium">
                        My Dashboard
                      </Link>
                      .
                    </p>
                  </div>
                )}
                {buyerLegacyRefundEligible && buyerRefundableEntries.length === 0 && (
                  <div
                    className={`${imageSize === 'small' ? 'p-3' : imageSize === 'medium' ? 'p-4' : 'p-5'} rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-2`}
                  >
                    <div className="flex items-start gap-3">
                      <Ticket className="h-6 w-6 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">Refund owed (legacy listing)</p>
                        {buyerLegacyRefundByCurrency.length > 0 && (
                          <p className="text-sm font-semibold tabular-nums text-foreground mt-2">
                            {buyerLegacyRefundByCurrency.length === 1
                              ? `Amount to refund: ${buyerLegacyRefundByCurrency[0].total.toFixed(
                                  buyerLegacyRefundByCurrency[0].currency === 'USDC' ? 2 : 4
                                )} ${buyerLegacyRefundByCurrency[0].currency}`
                              : `Amounts to refund: ${buyerLegacyRefundByCurrency
                                  .map(
                                    ({ currency, total }) =>
                                      `${total.toFixed(currency === 'USDC' ? 2 : 4)} ${currency}`
                                  )
                                  .join(' · ')}`}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground mt-1">
                          Ticket payments for this raffle did not use automated funds escrow. Refunds are issued
                          manually—open{' '}
                          <Link href="/dashboard" className="text-primary underline font-medium">
                            My Dashboard
                          </Link>{' '}
                          or contact support.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {buyerCancelledRefundEligible && (
                  <div
                    className={`${imageSize === 'small' ? 'p-3' : imageSize === 'medium' ? 'p-4' : 'p-5'} rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-2`}
                    role="region"
                    aria-label="Cancelled raffle refund pending"
                  >
                    <div className="flex items-start gap-3">
                      <Ticket className="h-6 w-6 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">Cancelled raffle — refund pending</p>
                        {buyerCancelledRefundByCurrency.length > 0 && (
                          <p className="text-sm font-semibold tabular-nums text-foreground mt-2">
                            {buyerCancelledRefundByCurrency.length === 1
                              ? `Amount owed: ${buyerCancelledRefundByCurrency[0].total.toFixed(
                                  buyerCancelledRefundByCurrency[0].currency === 'USDC' ? 2 : 4
                                )} ${buyerCancelledRefundByCurrency[0].currency}`
                              : `Amounts owed: ${buyerCancelledRefundByCurrency
                                  .map(
                                    ({ currency, total }) =>
                                      `${total.toFixed(currency === 'USDC' ? 2 : 4)} ${currency}`
                                  )
                                  .join(' · ')}`}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground mt-1">
                          This raffle was cancelled. Ticket refunds are sent manually by the platform (treasury), not via
                          the Claim refund button. If you have not been paid yet, open{' '}
                          <Link href="/dashboard" className="text-primary underline font-medium">
                            My Dashboard
                          </Link>{' '}
                          or contact support with this listing link.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {claimRefundError && (
                  <p className="text-sm text-destructive px-1">{claimRefundError}</p>
                )}
              </div>
            )}

            {isActive && !isFuture && (
              <div className="flex flex-col gap-3 items-stretch">
                {purchasesBlocked && (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Ticket purchases are temporarily blocked. Please check back later.
                  </p>
                )}
                <ReferralComplimentaryHint
                  variant="compact"
                  walletAddress={walletAddress || undefined}
                  show={
                    !purchasesBlocked &&
                    (availableTickets === null || availableTickets > 0) &&
                    userTickets === 0
                  }
                />
                <Button
                  onClick={handleOpenEnterRaffleDialog}
                  disabled={purchasesBlocked || (availableTickets !== null && availableTickets <= 0)}
                  size={classes.buttonSize as any}
                  style={
                    purchasesBlocked
                      ? undefined
                      : { backgroundColor: themeColor, color: '#000' }
                  }
                  variant={purchasesBlocked ? 'secondary' : 'default'}
                  className={`w-full touch-manipulation min-h-[44px] text-sm sm:text-base px-4 sm:px-6 ${purchasesBlocked ? 'opacity-70' : ''}`}
                >
                  {purchasesBlocked
                    ? 'Purchases Blocked'
                    : availableTickets !== null && availableTickets <= 0
                    ? 'Sold Out'
                    : 'Enter Raffle'}
                </Button>
              </div>
            )}
            {isFuture && (
              <div className="flex justify-center">
                <Badge variant="default" className="bg-red-500 hover:bg-red-600 text-white px-4 py-2" title={formatDateTimeWithTimezone(raffle.start_time)}>
                  {new Date(raffle.start_time) <= serverTime ? `Started ${formatDistance(new Date(raffle.start_time), serverTime, { addSuffix: true })}` : `Starts ${formatDateTimeLocal(raffle.start_time)}`}
                </Badge>
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch sm:justify-start sm:gap-3">
              {connected && (
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => setShowParticipants(true)}
                  className="w-full sm:w-auto touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Users className="mr-2 h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">View Participants ({currentOwlVisionScore.uniqueWallets})</span>
                  <span className="sm:hidden">Participants ({currentOwlVisionScore.uniqueWallets})</span>
                </Button>
              )}
              {raffle.winner_wallet && (
                <Button
                  variant="outline"
                  size="default"
                  className="w-full sm:w-auto touch-manipulation min-h-[44px] text-sm sm:text-base"
                  onClick={() => setShowWinner(true)}
                >
                  <Trophy className="mr-2 h-4 w-4 shrink-0" />
                  View Winner
                </Button>
              )}
              {showClaimPrizeButton && (
                <Button
                  variant="default"
                  size="default"
                  onClick={handleClaimPrize}
                  disabled={claimPrizeLoading || claimPrizePhase === 'loading'}
                  style={{ backgroundColor: themeColor, color: '#000' }}
                  className="w-full sm:w-auto touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Send className="mr-2 h-4 w-4 shrink-0" />
                  {!connected
                    ? 'Connect Wallet'
                    : claimPrizePhase === 'loading'
                    ? 'Claiming…'
                    : 'Claim Prize'}
                </Button>
              )}
              {showNftTransferButton && (
                <Button
                  variant="outline"
                  size="default"
                  onClick={handleOpenNftTransferDialog}
                  className="w-full sm:w-auto touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Send className="mr-2 h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">Record NFT Transfer</span>
                  <span className="sm:hidden">Record Transfer</span>
                </Button>
              )}
              {showReturnPrizeButton && (
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => {
                    setReturnPrizeError(null)
                    setReturnPrizeSuccess(false)
                    setShowReturnPrizeDialog(true)
                  }}
                  className="w-full sm:w-auto touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <ArrowLeft className="mr-2 h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">Return Prize to Creator</span>
                  <span className="sm:hidden">Return Prize</span>
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => router.push(`/admin/raffles/${raffle.id}`)}
                  className="w-full sm:w-auto touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Edit className="mr-2 h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">Edit Raffle</span>
                  <span className="sm:hidden">Edit</span>
                </Button>
              )}
            </div>
              </TabsContent>
              <TabsContent value="owl-vision" className="mt-0">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                      <Eye className="h-5 w-5 text-green-500" />
                      Owl Vision Trust Score: {currentOwlVisionScore.score}/100
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      This score summarizes how transparent and fair this raffle is — verified payments, wallet diversity, and time integrity.
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                    <div>
                      <p className="font-medium text-sm text-muted-foreground">Verified Payments</p>
                      <p className="text-base font-semibold">
                        {Math.round(currentOwlVisionScore.verifiedRatio * 100)}% — {currentOwlVisionScore.confirmedEntries} / {currentOwlVisionScore.totalEntries} entries confirmed on-chain
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Higher % means more tickets backed by real, verified transactions.</p>
                    </div>
                    <div>
                      <p className="font-medium text-sm text-muted-foreground">Wallet Diversity</p>
                      <p className="text-base font-semibold">
                        {Math.round(currentOwlVisionScore.diversityRatio * 100)}% — {currentOwlVisionScore.uniqueWallets} unique wallets
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Higher diversity suggests broader, more organic participation.</p>
                    </div>
                    <div>
                      <p className="font-medium text-sm text-muted-foreground">Time Integrity</p>
                      <p className="text-base font-semibold">
                        {currentOwlVisionScore.integrityScore}/10 — {currentOwlVisionScore.editedAfterEntries ? 'Edited after entries' : 'Not edited after entries'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Full points when the raffle wasn’t changed after people entered.</p>
                    </div>
                  </div>
                  {adminRole === 'full' && (
                    <AdminManualRefundRecorder
                      raffleId={raffle.id}
                      raffleCurrency={raffle.currency || 'SOL'}
                      entries={entries}
                      onRecorded={() => {
                        void fetchEntries()
                        router.refresh()
                      }}
                      adminFundsEscrowRefundEnabled={raffleAllowsAdminFundsEscrowRefund(raffle)}
                    />
                  )}
                </div>
              </TabsContent>
            </Tabs>
            {showClaimPrizeButton && claimPrizeError && (
              <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {claimPrizeError}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ParticipantsModal
        open={showParticipants}
        onOpenChange={setShowParticipants}
        entries={entries}
        themeAccent={raffle.theme_accent}
      />

      {raffle.winner_wallet && (
        <WinnerModal
          open={showWinner}
          onOpenChange={setShowWinner}
          winnerWallet={raffle.winner_wallet}
          prizeAmount={raffle.prize_amount}
          prizeCurrency={raffle.prize_currency}
          themeAccent={raffle.theme_accent}
          nftTransferTransaction={raffle.nft_transfer_transaction}
          prizeType={raffle.prize_type}
          nftMintAddress={raffle.nft_mint_address}
          nftCollectionName={raffle.nft_collection_name}
        />
      )}

      <Dialog open={showReturnPrizeDialog} onOpenChange={setShowReturnPrizeDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Return Prize to Creator</DialogTitle>
            <DialogDescription>
              Send the NFT from escrow back to the raffle creator. Use only for: cancelled raffle, wrong NFT deposited, dispute resolution, or platform error. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="return-prize-reason">Reason</Label>
              <select
                id="return-prize-reason"
                value={returnPrizeReason}
                onChange={(e) => setReturnPrizeReason(e.target.value)}
                disabled={returnPrizeLoading}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="cancelled">Raffle cancelled</option>
                <option value="wrong_nft">Wrong NFT deposited</option>
                <option value="dispute">Dispute resolution</option>
                <option value="platform_error">Platform error</option>
                <option value="testing">Testing</option>
              </select>
            </div>
            {returnPrizeError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive text-destructive text-sm">
                {returnPrizeError}
              </div>
            )}
            {returnPrizeSuccess && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500 text-green-500 text-sm">
                Prize returned to creator successfully.
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-3 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setShowReturnPrizeDialog(false)}
              disabled={returnPrizeLoading}
              className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handleReturnPrizeToCreator}
              disabled={returnPrizeLoading}
              style={{ backgroundColor: themeColor, color: '#000' }}
              className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              {returnPrizeLoading ? 'Returning...' : 'Return Prize to Creator'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNftTransferDialog} onOpenChange={setShowNftTransferDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Record NFT Transfer Transaction</DialogTitle>
            <DialogDescription>
              Prefer &quot;Send prize from escrow&quot; on the admin raffle tools. Use this when the prize was sent
              manually—for example the escrow SPL token account was frozen and someone with freeze authority moved the NFT
              to the winner—then paste the Solana transaction signature here for transparency.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="nft-transfer-signature">Transaction Signature</Label>
              <Input
                id="nft-transfer-signature"
                type="text"
                placeholder="Enter transaction signature..."
                value={nftTransferSignature}
                onChange={(e) => setNftTransferSignature(e.target.value)}
                disabled={isSubmittingTransfer}
                className="text-base sm:text-sm h-11 sm:h-10 font-mono"
              />
              <p className="text-xs text-muted-foreground">
                The Solana transaction signature that transferred the NFT to the winner&apos;s wallet.
              </p>
            </div>
            
            {transferError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive text-destructive text-sm">
                {transferError}
              </div>
            )}
            
            {transferSuccess && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500 text-green-500 text-sm">
                NFT transfer transaction recorded successfully!
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-3 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setShowNftTransferDialog(false)}
              disabled={isSubmittingTransfer}
              className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitNftTransfer}
              disabled={!connected || isSubmittingTransfer || !nftTransferSignature.trim()}
              style={{
                backgroundColor: themeColor,
                color: '#000',
              }}
              className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              {!connected
                ? 'Connect Wallet'
                : isSubmittingTransfer
                ? 'Recording...'
                : 'Record Transaction'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* While a purchase is processing, keep users on the page with a simple blocking dialog */}
      <Dialog open={isProcessing} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Processing your entry</DialogTitle>
            <DialogDescription>
              Your payment was sent. We&apos;re confirming it on Solana — this usually takes a few seconds.
              Please keep this page open; your tickets will update automatically once confirmed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 mt-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              You can safely read this page while we verify on-chain. Closing the tab won&apos;t cancel the transaction.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showEnterRaffleDialog} onOpenChange={setShowEnterRaffleDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Enter Raffle</DialogTitle>
            <DialogDescription>
              Select the number of tickets you want to purchase
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {raffle.max_tickets && (
              <div className="p-3 rounded-lg bg-muted border">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tickets Available</span>
                  <span className="font-semibold">
                    {availableTickets !== null && availableTickets >= 0 
                      ? `${availableTickets} / ${raffle.max_tickets}`
                      : `${raffle.max_tickets} / ${raffle.max_tickets}`}
                  </span>
                </div>
                {availableTickets !== null && availableTickets <= 0 && (
                  <p className="text-xs text-destructive mt-1">
                    All tickets have been sold
                  </p>
                )}
              </div>
            )}
            
              <div className="space-y-2">
                <Label htmlFor="dialog-quantity">Number of Tickets</Label>
                <Input
                  id="dialog-quantity"
                  type="number"
                  min="1"
                  max={maxPurchaseQuantity}
                  value={ticketQuantityDisplay}
                  onChange={(e) => handleQuantityChange(e.target.value)}
                  onBlur={handleQuantityBlur}
                  disabled={availableTickets !== null && availableTickets <= 0}
                  className="text-base sm:text-sm h-11 sm:h-10"
                />
              {raffle.max_tickets && availableTickets !== null && availableTickets > 0 && (
                <p className="text-xs text-muted-foreground">
                  Maximum {availableTickets} ticket{availableTickets !== 1 ? 's' : ''} available
                </p>
              )}
            </div>
            
            <HootBoostMeter quantity={ticketQuantity} />
            
            <ReferralComplimentaryHint
              variant="dialog"
              walletAddress={walletAddress || undefined}
              show={
                ticketQuantity === 1 &&
                userTickets === 0 &&
                (availableTickets === null || availableTickets > 0)
              }
            />

            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-muted-foreground">Total Cost</span>
              <div className="text-xl font-bold flex items-center gap-2">
                {purchaseAmount.toFixed(6)} {raffle.currency}
                <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'} size={20} className="inline-block" />
              </div>
            </div>
            
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive text-destructive text-sm">
                {error}
              </div>
            )}
            
            {success && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500 text-green-500 text-sm space-y-2">
                <p>Tickets purchased successfully! Transaction confirmed.</p>
                <p className="text-xs opacity-90">
                  Your entry should appear shortly. If you don&apos;t see it, please refresh the page.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-3 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setShowEnterRaffleDialog(false)}
              disabled={isProcessing}
              className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePurchase}
              disabled={
                availableTickets !== null && availableTickets <= 0 ||
                !connected ||
                isProcessing
              }
              style={{
                backgroundColor: themeColor,
                color: '#000',
              }}
              className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              {!connected
                ? 'Connect Wallet'
                : isProcessing
                ? 'Processing...'
                : availableTickets !== null && availableTickets <= 0
                ? 'Sold Out'
                : 'Buy Tickets'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {(claimPrizePhase === 'loading' || claimPrizePhase === 'success') && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-background/90 backdrop-blur-sm p-4"
          role="alertdialog"
          aria-modal="true"
          aria-busy={claimPrizePhase === 'loading'}
          aria-labelledby="claim-prize-overlay-title"
        >
          <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg space-y-4 text-center">
            {claimPrizePhase === 'loading' ? (
              <>
                <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" aria-hidden />
                <h2 id="claim-prize-overlay-title" className="text-lg font-semibold text-foreground">
                  Claiming your prize…
                </h2>
                <p className="text-sm text-muted-foreground">
                  Stay on this screen. Your wallet may ask you to sign in first; after that we broadcast
                  the NFT transfer from escrow. Solana usually confirms within a few seconds.
                </p>
              </>
            ) : (
              <>
                <div
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                >
                  <Trophy className="h-8 w-8" />
                </div>
                <h2 id="claim-prize-overlay-title" className="text-lg font-semibold text-foreground">
                  {claimPrizeAlreadyClaimed ? 'Prize already sent' : 'Prize sent!'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {claimPrizeAlreadyClaimed
                    ? 'This prize was already transferred to your wallet. Open Solscan below to verify the transaction.'
                    : 'Your NFT prize has been sent to your connected wallet. You can confirm the transfer on Solscan.'}
                </p>
                {claimPrizeTxSignature ? (
                  <a
                    href={solscanTransactionUrl(claimPrizeTxSignature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/15 w-full touch-manipulation"
                  >
                    View transaction on Solscan
                    <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
                  </a>
                ) : null}
                <Button
                  type="button"
                  className="w-full min-h-[44px] touch-manipulation text-base"
                  onClick={closeClaimPrizeSuccess}
                >
                  Done
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  )
}

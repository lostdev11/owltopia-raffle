'use client'

import { Fragment, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
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
} from '@/lib/solana/escrow-deposit-log'
import { isEscrowSplPrizeFrozenVerifyError } from '@/lib/raffles/verify-prize-deposit-client'
import { walletNftLooksLikeSnsDomain } from '@/lib/raffles/sns-domain-metadata'
import { nftPrizeRaffleTitleFromWalletSelection } from '@/lib/raffles/nft-prize-raffle-title'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EscrowDepositProgressDialog } from '@/components/EscrowDepositProgressDialog'
import type { ThemeAccent } from '@/lib/types'
import {
  getThemeAccentBorderStyle,
  getThemeAccentClasses,
  THEME_ACCENT_SELECT_OPTIONS,
} from '@/lib/theme-accent'
import { DateTimePicker } from '@/components/DateTimePicker'
import { formatDateTimeWithTimezone, localDateTimeToUtc, utcToLocalDateTime } from '@/lib/utils'
import type { DuplicateNftPrizeConflictReason } from '@/lib/raffles/duplicate-nft-prize-conflict'
import type { NftHolderInWallet, WalletNft } from '@/lib/solana/wallet-tokens'
import { getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'
import {
  NFT_DEFAULT_SUGGEST_TICKET_COUNT,
  suggestTicketPriceFromFloor,
  computeNftMinTicketsFromFloorAndTicket,
  parseNftFloorPrice,
  parseNftTicketPrice,
  validateNftMaxTickets,
  validateNftMinTicketsNotOverCap,
} from '@/lib/raffles/nft-raffle-economics'
import { getCachedAdmin, setCachedAdmin, type AdminRole } from '@/lib/admin-check-cache'
import { descriptionContainsBlockedLinks } from '@/lib/raffle-description-links'
import {
  getPartnerPrizeListingImageUrl,
  getPartnerPrizeMintForCurrency,
  getPartnerPrizeTokenByCurrency,
  isPartnerPrizeCurrency,
  isPublicSplPrizeCurrency,
  listPartnerPrizeTokens,
  PARTNER_OWL_PRIZE_UI_ENABLED,
} from '@/lib/partner-prize-tokens'
import { humanPartnerPrizeToRawUnits } from '@/lib/partner-prize-amount'
import { explainCreateRaffleThreshold } from '@/lib/raffle-profit'
import {
  buildCreateRaffleFeeCopy,
  type PlatformFeeReason,
} from '@/lib/raffles/creator-fee-copy'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'
import {
  BAMBOO_TICKET_CURRENCY,
  canWalletUseBambooTicketCurrency,
} from '@/lib/raffles/bamboo-ticket-currency'
import { buildMilestoneBonusRulesCopy, MILESTONE_BETA_NOTICE } from '@/lib/raffles/milestones/copy'
import { MILESTONE_MAX_PER_RAFFLE, MILESTONE_MAX_PRIZE_SOL, milestoneMaxPrizeUsdc } from '@/lib/raffles/milestones/constants'
import type { Raffle, RaffleMilestone, RaffleMilestoneWinnerMode, RaffleMilestoneTriggerType } from '@/lib/types'
import {
  fetchFundsEscrowAddress,
  milestoneDepositTotalForPrizeCurrency,
  sendMilestoneDepositTransaction,
  sumMilestoneDepositsByCurrency,
  verifyCreateMilestoneDepositsFromClient,
  pendingCryptoMilestonesForCreate,
  appendSolMilestoneTransfersToTransaction,
} from '@/lib/client/create-raffle-milestone-deposit'

function focusFormField(elementId: string) {
  const el = document.getElementById(elementId)
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (el instanceof HTMLElement) el.focus()
}

/** Production APIs often return a generic 5xx string; expand for humans and mention My raffles (same page). */
function formatCreateRaffleApiError(status: number, apiMessage: string): string {
  const m = (apiMessage || '').trim()
  const lower = m.toLowerCase()
  if (
    lower === 'internal server error' ||
    lower === 'internal service error' ||
    lower === 'server error' ||
    lower === 'service error'
  ) {
    if (status === 503) {
      return 'We could not save the raffle just now (service unavailable). Check My raffles below in case it still saved, or try again in a minute.'
    }
    return 'We could not save the raffle just now. Check My raffles below in case it still saved, then try again.'
  }
  return m || `Something went wrong (HTTP ${status}). Try again in a moment.`
}

type CreateEscrowProgressState = {
  open: boolean
  title: string
  description: string
  phase: 'loading' | 'result'
  /** When true, `finally` leaves the dialog open until the user taps `primaryAction`. */
  persistUntilDismiss: boolean
  primaryAction?: { label: string; onClick: () => void }
}

const CREATE_ESCROW_IDLE: CreateEscrowProgressState = {
  open: false,
  title: '',
  description: '',
  phase: 'loading',
  persistUntilDismiss: false,
}

type MilestoneDraftRow = {
  trigger_type: RaffleMilestoneTriggerType
  trigger_value: string
  prize_amount: string
  prize_currency: 'SOL' | 'USDC'
  winner_mode: RaffleMilestoneWinnerMode
  /** When true, ticket-count target follows the live draw goal from floor ÷ ticket or partner min. */
  followDrawGoal?: boolean
}

const DEFAULT_MILESTONE_ROW: MilestoneDraftRow = {
  trigger_type: 'draw_threshold',
  trigger_value: '1',
  prize_amount: '0.1',
  prize_currency: 'SOL',
  winner_mode: 'random',
  followDrawGoal: true,
}

function parseCreateRaffleResponse(body: unknown): { raffle: Raffle; milestones: RaffleMilestone[] } {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const milestones = Array.isArray(raw.milestones)
    ? (raw.milestones as RaffleMilestone[])
    : []
  const { milestones: _m, ...rest } = raw
  return { raffle: rest as unknown as Raffle, milestones }
}

/** Milestone currencies that must be deposited in a follow-up tx (not the main prize currency). */
function milestoneCurrenciesNeedingFollowUpTx(
  milestones: RaffleMilestone[],
  prizeCurrency: string | null
): Array<'SOL' | 'USDC'> {
  const prize = (prizeCurrency ?? '').trim().toUpperCase()
  const totals = sumMilestoneDepositsByCurrency(pendingCryptoMilestonesForCreate(milestones))
  const out: Array<'SOL' | 'USDC'> = []
  if ((totals.SOL ?? 0) > 0 && prize !== 'SOL') out.push('SOL')
  if ((totals.USDC ?? 0) > 0 && prize !== 'USDC') out.push('USDC')
  return out
}

export function CreateRaffleForm({ snsDomainHubFlow = false }: { snsDomainHubFlow?: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const createSubmitInFlightRef = useRef(false)
  const partnerModeDefaultAppliedRef = useRef(false)
  const { publicKey, connected, wallet } = useWallet()
  const sendTransaction = useSendTransactionForWallet()
  const { connection } = useConnection()
  const [themeAccent, setThemeAccent] = useState<ThemeAccent>('prime')
  const [milestonesEnabled, setMilestonesEnabled] = useState(false)
  const [milestoneRows, setMilestoneRows] = useState<MilestoneDraftRow[]>([{ ...DEFAULT_MILESTONE_ROW }])
  const milestoneRulesCopy = useMemo(() => buildMilestoneBonusRulesCopy(), [])
  // datetime-local expects a *local* time string. Using toISOString() here would be UTC and can shift by timezone,
  // causing raffles to start/end earlier or later than intended.
  const [startTime, setStartTime] = useState(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
  })
  const [endTime, setEndTime] = useState('')
  const [loading, setLoading] = useState(false)
  /** saving = POST raffle; signing = resolve NFT on RPC + wallet sends prize to escrow */
  const [createStep, setCreateStep] = useState<'idle' | 'saving' | 'signing'>('idle')
  const [escrowProgress, setEscrowProgress] = useState<CreateEscrowProgressState>(CREATE_ESCROW_IDLE)
  /** Listing image comes from the selected prize NFT metadata. */
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [prizeMode, setPrizeMode] = useState<'nft' | 'token'>('nft')
  const [tokenPrizeCurrency, setTokenPrizeCurrency] = useState<string>('SOL')
  const [partnerPrizeAmount, setPartnerPrizeAmount] = useState('')
  const [partnerMinTickets, setPartnerMinTickets] = useState('')
  const [selectedNft, setSelectedNft] = useState<WalletNft | null>(null)
  const [walletNfts, setWalletNfts] = useState<WalletNft[] | null>(null)
  const [nftSearchQuery, setNftSearchQuery] = useState('')
  const [loadingWalletAssets, setLoadingWalletAssets] = useState(false)
  const [walletAssetsError, setWalletAssetsError] = useState<string | null>(null)
  /** Inline message for POST /api/raffles failures — avoids a blocking alert that can feel like a brief “flash” on mobile. */
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [floorPrice, setFloorPrice] = useState('')
  const [raffleCurrency, setRaffleCurrency] = useState('SOL')
  const [alternateBambooTicketPrice, setAlternateBambooTicketPrice] = useState('')
  const [alternateSolTicketPrice, setAlternateSolTicketPrice] = useState('')
  const [ticketPrice, setTicketPrice] = useState('')
  /** When non-null, ticket was last set by floor autofill; floor edits re-suggest only if ticket still matches. */
  const lastAutofillTicketRef = useRef<string | null>(null)
  const [viewerIsAdmin, setViewerIsAdmin] = useState<boolean | null>(null)
  /** Partners / admins: hide from /raffles but keep the slug (share in Discord, etc.) */
  const [canSetLinkOnlyVisibility, setCanSetLinkOnlyVisibility] = useState(false)
  /** Active `partner_community_creators` wallet — unlocks extra SPL prize tickers beyond SOL/USDC. */
  const [isPartnerCommunityCreator, setIsPartnerCommunityCreator] = useState(false)
  const [platformFeeBps, setPlatformFeeBps] = useState<number | null>(null)
  const [platformFeeReason, setPlatformFeeReason] = useState<PlatformFeeReason | null>(null)
  const [platformFeeTierLoaded, setPlatformFeeTierLoaded] = useState(false)
  /** Wallet is linked in admin partner-creators to a Discord partner tenant (server webhooks). */
  const [partnerDiscordLinked, setPartnerDiscordLinked] = useState(false)
  const [hideFromPublicBrowse, setHideFromPublicBrowse] = useState(false)
  const partnerCreateMode = searchParams.get('mode') === 'partner'
  useEffect(() => {
    if (snsDomainHubFlow) setPrizeMode('nft')
  }, [snsDomainHubFlow])
  const canUseBambooTicketCurrency =
    viewerIsAdmin === true ||
    (publicKey ? canWalletUseBambooTicketCurrency(publicKey.toBase58()) : false)

  useEffect(() => {
    partnerModeDefaultAppliedRef.current = false
  }, [publicKey, partnerCreateMode])

  useEffect(() => {
    if (prizeMode === 'token') {
      setSelectedNft(null)
      setImageUrl(getPartnerPrizeListingImageUrl(tokenPrizeCurrency))
      setFloorPrice('')
      lastAutofillTicketRef.current = null
    }
  }, [prizeMode, tokenPrizeCurrency])

  useEffect(() => {
    lastAutofillTicketRef.current = null
  }, [prizeMode])

  useEffect(() => {
    if (raffleCurrency !== 'SOL') setAlternateBambooTicketPrice('')
  }, [raffleCurrency])

  useEffect(() => {
    if (raffleCurrency !== BAMBOO_TICKET_CURRENCY) setAlternateSolTicketPrice('')
  }, [raffleCurrency])

  useEffect(() => {
    if (raffleCurrency !== 'OWL') return
    if (!isOwlEnabled() || viewerIsAdmin === false) {
      setRaffleCurrency('SOL')
    }
  }, [raffleCurrency, viewerIsAdmin])

  useEffect(() => {
    if (raffleCurrency !== BAMBOO_TICKET_CURRENCY) return
    if (!canUseBambooTicketCurrency) {
      setRaffleCurrency('SOL')
    }
  }, [raffleCurrency, canUseBambooTicketCurrency])

  useEffect(() => {
    if (tokenPrizeCurrency !== 'OWL') return
    if (!PARTNER_OWL_PRIZE_UI_ENABLED || viewerIsAdmin !== true) {
      const fallback =
        listPartnerPrizeTokens().find((t) => isPublicSplPrizeCurrency(t.currencyCode))?.currencyCode ??
        listPartnerPrizeTokens()[0]?.currencyCode
      if (fallback) setTokenPrizeCurrency(fallback)
    }
  }, [tokenPrizeCurrency, viewerIsAdmin])

  useEffect(() => {
    if (!connected || !publicKey) {
      setViewerIsAdmin(null)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached !== null) {
      setViewerIsAdmin(cached)
      return
    }
    let cancelled = false
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role: AdminRole | null = admin && data?.role === 'full' ? 'full' : null
        setCachedAdmin(addr, admin, role)
        setViewerIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setViewerIsAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !connected || !publicKey) {
      setCanSetLinkOnlyVisibility(false)
      setPartnerDiscordLinked(false)
      setIsPartnerCommunityCreator(false)
      setPlatformFeeBps(null)
      setPlatformFeeReason(null)
      setPlatformFeeTierLoaded(false)
      setHideFromPublicBrowse(false)
      return
    }
    let cancelled = false
    setPlatformFeeTierLoaded(false)
    const walletParam = publicKey.toBase58()
    fetch(
      `/api/raffles/visibility-options?wallet=${encodeURIComponent(walletParam)}`,
      { credentials: 'include' }
    )
      .then((r) => (cancelled || !r.ok ? null : r.json()))
      .then(
        (
          d: {
            canSetLinkOnly?: boolean
            partnerDiscordLinked?: boolean
            isPartnerCommunityCreator?: boolean
            platformFeeBps?: number | null
            platformFeeReason?: PlatformFeeReason | null
          } | null
        ) => {
          if (cancelled) return
          if (!d) {
            setPlatformFeeTierLoaded(true)
            return
          }
          const ok = d.canSetLinkOnly === true
          setCanSetLinkOnlyVisibility(ok)
          setPartnerDiscordLinked(d.partnerDiscordLinked === true)
          setIsPartnerCommunityCreator(d.isPartnerCommunityCreator === true)
          const bps = d.platformFeeBps
          setPlatformFeeBps(typeof bps === 'number' && Number.isFinite(bps) ? bps : null)
          const reason = d.platformFeeReason
          setPlatformFeeReason(
            reason === 'holder' || reason === 'standard' || reason === 'partner_community'
              ? reason
              : null
          )
          setPlatformFeeTierLoaded(true)
          if (!ok) setHideFromPublicBrowse(false)
          if (ok && partnerCreateMode && !snsDomainHubFlow && !partnerModeDefaultAppliedRef.current) {
            setHideFromPublicBrowse(true)
            partnerModeDefaultAppliedRef.current = true
          }
        }
      )
      .catch(() => {
        if (!cancelled) {
          setCanSetLinkOnlyVisibility(false)
          setPartnerDiscordLinked(false)
          setIsPartnerCommunityCreator(false)
          setPlatformFeeBps(null)
          setPlatformFeeReason(null)
          setPlatformFeeTierLoaded(true)
          setHideFromPublicBrowse(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, partnerCreateMode, snsDomainHubFlow])

  const createRaffleFeeCopy = useMemo(
    () =>
      buildCreateRaffleFeeCopy({
        connected: connected && !!publicKey,
        feeTierLoaded: platformFeeTierLoaded,
        feeBps: platformFeeBps ?? undefined,
        feeReason: platformFeeReason ?? undefined,
      }),
    [connected, publicKey, platformFeeTierLoaded, platformFeeBps, platformFeeReason]
  )

  /**
   * When floor changes: set ticket to floor ÷ default ticket count only if the ticket is empty, or
   * still exactly the last value we autofill (so a manual price is not cleared when the user fixes floor).
   */
  const applyFloorToTicketAutofill = useCallback((floorValue: string) => {
    const trimmed = floorValue.trim()
    if (!trimmed) {
      if (ticketPrice === '' || (lastAutofillTicketRef.current !== null && ticketPrice === lastAutofillTicketRef.current)) {
        setTicketPrice('')
      }
      lastAutofillTicketRef.current = null
      return
    }
    const floor = parseFloat(trimmed)
    if (!Number.isFinite(floor) || floor <= 0) {
      return
    }
    const calculated = suggestTicketPriceFromFloor(floor, NFT_DEFAULT_SUGGEST_TICKET_COUNT)
    if (!Number.isFinite(calculated)) {
      return
    }
    const formatted =
      calculated >= 1
        ? calculated.toFixed(2)
        : calculated >= 0.01
          ? calculated.toFixed(4)
          : calculated.toFixed(6)
    const shouldAutofill =
      ticketPrice === '' || (lastAutofillTicketRef.current !== null && ticketPrice === lastAutofillTicketRef.current)
    if (shouldAutofill) {
      setTicketPrice(formatted)
      lastAutofillTicketRef.current = formatted
    }
  }, [ticketPrice])

  /** When the prize NFT (or mode) changes, reset floor and ticket so values are not carried over. */
  useEffect(() => {
    if (prizeMode !== 'nft') return
    setFloorPrice('')
    setTicketPrice('')
    lastAutofillTicketRef.current = null
  }, [prizeMode, selectedNft?.mint])

  const derivedDrawGoal = useMemo(() => {
    const fp = parseNftFloorPrice(floorPrice)
    const tp = parseNftTicketPrice(ticketPrice)
    if (!fp.ok || !tp.ok) return null
    return computeNftMinTicketsFromFloorAndTicket(fp.value, tp.value)
  }, [floorPrice, ticketPrice])

  const partnerMinTicketsParsed = useMemo(() => {
    const n = parseInt(String(partnerMinTickets).trim(), 10)
    if (!Number.isFinite(n) || n < 1) return null
    return n
  }, [partnerMinTickets])

  const partnerPrizeAmountParsed = useMemo(() => {
    const n = parseFloat(partnerPrizeAmount.trim())
    if (!Number.isFinite(n) || n <= 0) return null
    return n
  }, [partnerPrizeAmount])

  const ticketPriceParsedForPreview = useMemo(() => {
    const p = parseNftTicketPrice(ticketPrice)
    return p.ok ? p.value : null
  }, [ticketPrice])

  const effectiveDrawGoalTickets = useMemo(() => {
    if (prizeMode === 'token') return partnerMinTicketsParsed
    return derivedDrawGoal
  }, [prizeMode, partnerMinTicketsParsed, derivedDrawGoal])

  useEffect(() => {
    if (!milestonesEnabled || effectiveDrawGoalTickets == null || effectiveDrawGoalTickets < 1) return
    const goalStr = String(effectiveDrawGoalTickets)
    setMilestoneRows((prev) =>
      prev.map((row) => {
        if (row.trigger_type === 'draw_threshold') return row
        if (row.followDrawGoal) {
          return { ...row, trigger_value: goalStr }
        }
        return row
      })
    )
  }, [milestonesEnabled, effectiveDrawGoalTickets])

  const thresholdExplain = useMemo(
    () =>
      explainCreateRaffleThreshold({
        prizeMode,
        ticketCurrency: raffleCurrency,
        ticketPrice: ticketPriceParsedForPreview,
        floorPriceInput: floorPrice,
        partnerMinTickets: prizeMode === 'token' ? partnerMinTicketsParsed : null,
        partnerPrizeAmount: prizeMode === 'token' ? partnerPrizeAmountParsed : null,
        partnerPrizeCurrency: tokenPrizeCurrency,
      }),
    [
      prizeMode,
      raffleCurrency,
      ticketPriceParsedForPreview,
      floorPrice,
      partnerMinTicketsParsed,
      partnerPrizeAmountParsed,
      tokenPrizeCurrency,
    ]
  )

  /** TRQ, CANE, etc. — only admins + partner-community wallets; SOL/USDC stay open to all creators. */
  const canSelectPartnerPrizeTokens = viewerIsAdmin === true || isPartnerCommunityCreator

  const allPartnerPrizeTokens = useMemo(() => [...listPartnerPrizeTokens()], [])

  useEffect(() => {
    if (canSelectPartnerPrizeTokens) return
    if (isPublicSplPrizeCurrency(tokenPrizeCurrency)) return
    setTokenPrizeCurrency('SOL')
  }, [canSelectPartnerPrizeTokens, tokenPrizeCurrency])

  const partnerPrizeAmountPlaceholder = useMemo(() => {
    const dec = getPartnerPrizeTokenByCurrency(tokenPrizeCurrency)?.decimals ?? 9
    if (dec === 0) return 'e.g. 1 or 10 (whole tokens only)'
    return dec <= 6 ? 'e.g. 100 or 50.25' : 'e.g. 1000 or 250.5'
  }, [tokenPrizeCurrency])

  const loadWalletAssets = async () => {
    if (!publicKey) return
    setLoadingWalletAssets(true)
    setWalletAssetsError(null)
    const walletAddr = publicKey.toBase58()
    try {
      // Prefer API first: faster (batch from Helius) and returns more NFTs (paginated).
      const [apiRes, escrowRes] = await Promise.all([
        fetch(`/api/wallet/nfts?wallet=${encodeURIComponent(walletAddr)}`, { credentials: 'include' }),
        fetch(`/api/wallet/escrowed-nft-mints?wallet=${encodeURIComponent(walletAddr)}`, { credentials: 'include' }),
      ])
      let nfts: WalletNft[] = []
      if (apiRes.ok) {
        const data = await apiRes.json()
        nfts = Array.isArray(data) ? data : []
      }
      // Fallback to client RPC when API is unavailable (e.g. no HELIUS_API_KEY) or fails
      if (nfts.length === 0 || apiRes.status === 503) {
        const { getWalletNfts } = await import('@/lib/solana/wallet-tokens')
        try {
          nfts = await getWalletNfts(connection, publicKey)
        } catch (rpcErr) {
          if (nfts.length === 0) throw rpcErr
        }
      }
      // Exclude NFTs already in escrow (from parallel fetch)
      if (escrowRes.ok) {
        try {
          const { mints: escrowedMints } = await escrowRes.json()
          if (Array.isArray(escrowedMints) && escrowedMints.length > 0) {
            const escrowedSet = new Set(escrowedMints.map((m: string) => m.toLowerCase()))
            nfts = nfts.filter((n) => !escrowedSet.has(n.mint.toLowerCase()))
          }
        } catch {
          // ignore
        }
      }
      if (snsDomainHubFlow) {
        nfts = nfts.filter(walletNftLooksLikeSnsDomain)
      }
      setWalletNfts(nfts)
      setNftSearchQuery('')
    } catch (e) {
      console.error('Load wallet assets:', e)
      setWalletAssetsError(e instanceof Error ? e.message : 'Failed to load wallet assets')
      setWalletNfts(null)
    } finally {
      setLoadingWalletAssets(false)
    }
  }

  const depositFollowUpMilestonesAfterPrize = useCallback(
    async (params: {
      raffle: Raffle
      createdMilestones: RaffleMilestone[]
      prizeCurrency: string | null
      mainDepositSig: string | null
      /** Currencies already deposited in the main prize transaction (e.g. SOL bundled with SPL NFT). */
      skipCurrencies?: Array<'SOL' | 'USDC'>
    }) => {
      if (!publicKey || !connected) return

      const prizeCur = (params.prizeCurrency ?? '').trim().toUpperCase()
      if (params.mainDepositSig && (prizeCur === 'SOL' || prizeCur === 'USDC')) {
        const bundled = milestoneDepositTotalForPrizeCurrency(params.createdMilestones, prizeCur)
        if (bundled > 0) {
          const v = await verifyCreateMilestoneDepositsFromClient({
            raffleId: params.raffle.id,
            depositTx: params.mainDepositSig,
            currency: prizeCur,
          })
          if (!v.ok) {
            throw new Error(v.error ?? 'Bonus deposit verification failed.')
          }
        }
      }

      const skip = new Set(params.skipCurrencies ?? [])
      const followUp = milestoneCurrenciesNeedingFollowUpTx(
        params.createdMilestones,
        params.prizeCurrency
      ).filter((c) => !skip.has(c))
      if (followUp.length === 0) return

      const fundsAddress = await fetchFundsEscrowAddress()
      if (!fundsAddress) {
        throw new Error(
          'Funds escrow is not configured. Open your raffle page to deposit bonus milestones manually.'
        )
      }

      const pending = pendingCryptoMilestonesForCreate(params.createdMilestones)
      const totals = sumMilestoneDepositsByCurrency(pending)

      for (const currency of followUp) {
        const amount = totals[currency] ?? 0
        if (amount <= 0) continue
        setEscrowProgress((p) => ({
          ...p,
          open: true,
          phase: 'loading',
          persistUntilDismiss: false,
          title: 'Bonus milestone deposit',
          description: `When your wallet opens, approve sending ${amount} ${currency} bonus to escrow.`,
        }))
        const sig = await sendMilestoneDepositTransaction({
          connection,
          sendTransaction,
          publicKey,
          currency,
          amount,
          fundsEscrowAddress: fundsAddress,
        })
        const v = await verifyCreateMilestoneDepositsFromClient({
          raffleId: params.raffle.id,
          depositTx: sig,
          currency,
        })
        if (!v.ok) {
          throw new Error(v.error ?? 'Bonus deposit verification failed.')
        }
      }
    },
    [publicKey, connected, connection, sendTransaction]
  )

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (loading || createStep !== 'idle' || createSubmitInFlightRef.current) {
      return
    }

    createSubmitInFlightRef.current = true
    try {
    if (!connected || !publicKey) {
      alert('Please connect your wallet to create a raffle')
      return
    }

    const formData = new FormData(e.currentTarget)
    const isPartner = prizeMode === 'token'

    if (!isPartner && !selectedNft) {
      alert('Please select an NFT from your wallet for an NFT raffle.')
      focusFormField('nft-prize-section')
      return
    }

    if (isPartner) {
      if (!isPublicSplPrizeCurrency(tokenPrizeCurrency) && viewerIsAdmin !== true && !isPartnerCommunityCreator) {
        alert('That prize token is only for partner communities and admins. Choose SOL or USDC, or apply via the partner program.')
        focusFormField('token_prize_select')
        return
      }
      const tokenMeta = getPartnerPrizeTokenByCurrency(tokenPrizeCurrency)
      const amt = partnerPrizeAmount.trim()
      if (!amt || !tokenMeta || humanPartnerPrizeToRawUnits(tokenPrizeCurrency, amt) == null) {
        const dec = tokenMeta?.decimals ?? 9
        alert(
          `Enter a valid ${tokenPrizeCurrency} prize amount (positive number, up to ${dec} decimal place${dec === 1 ? '' : 's'}).`
        )
        focusFormField('partner_prize_amount')
        return
      }
    }

    const isNftPrizeMode = prizeMode === 'nft'
    const titleTrimmed = isNftPrizeMode
      ? selectedNft
        ? nftPrizeRaffleTitleFromWalletSelection(selectedNft.name, selectedNft.mint)
        : ''
      : ((formData.get('title') as string) ?? '').trim()
    if (!titleTrimmed) {
      alert(
        isNftPrizeMode
          ? 'Select an NFT from your wallet — the raffle title is set from that NFT’s name.'
          : 'Please enter a raffle title.'
      )
      if (!isNftPrizeMode) focusFormField('title')
      else document.getElementById('nft-prize-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    if (!startTime?.trim()) {
      alert('Please set a start time for your raffle.')
      focusFormField('start_time')
      return
    }
    if (!endTime?.trim()) {
      alert('Please set an end time for your raffle.')
      focusFormField('end_time')
      return
    }

    if (!isPartner && selectedNft) {
      try {
        const mintPk = new PublicKey(selectedNft.mint)
        const stakedCheck = await getNftHolderInWallet(connection, mintPk, publicKey, 'confirmed')
        if (stakedCheck && 'delegated' in stakedCheck && stakedCheck.delegated) {
          alert(
            'This NFT is staked or delegated. Unstake it before creating a raffle—it cannot be sent to escrow while staked.'
          )
          return
        }
      } catch {
        // Mint parse or RPC: server will re-check on create
      }
    }

    // Validate end after start and 7-day maximum (browser HTML5 checks are skipped — see form noValidate)
    let startDateUtc: Date
    let endDateUtc: Date
    try {
      startDateUtc = new Date(localDateTimeToUtc(startTime))
      endDateUtc = new Date(localDateTimeToUtc(endTime))
    } catch {
      alert('Start or end time is invalid. Check both date fields.')
      focusFormField('start_time')
      return
    }
    if (endDateUtc <= startDateUtc) {
      alert('End time must be after start time.')
      focusFormField('end_time')
      return
    }
    const durationMs = endDateUtc.getTime() - startDateUtc.getTime()
    const durationDays = durationMs / (1000 * 60 * 60 * 24)
    if (durationDays > 7) {
      alert('Raffle duration cannot exceed 7 days')
      focusFormField('end_time')
      return
    }

    const floorPriceValue = (formData.get('floor_price') as string)?.trim() ?? ''
    const fpNum = parseFloat(floorPriceValue)
    if (!floorPriceValue || !Number.isFinite(fpNum) || fpNum <= 0) {
      alert('Enter a valid floor price (prize value) in your raffle currency.')
      focusFormField('floor_price')
      return
    }
    const ticketStr = (formData.get('ticket_price') as string)?.trim() ?? ''
    const tpParsed = parseNftTicketPrice(ticketStr)
    if (!tpParsed.ok) {
      alert(tpParsed.error)
      focusFormField('ticket_price')
      return
    }

    let drawGoalTickets: number
    if (isPartner) {
      if (partnerMinTicketsParsed == null) {
        alert('Enter draw goal (minimum tickets) as a positive whole number.')
        focusFormField('partner_min_tickets')
        return
      }
      drawGoalTickets = partnerMinTicketsParsed
    } else {
      drawGoalTickets = computeNftMinTicketsFromFloorAndTicket(fpNum, tpParsed.value)
    }
    const capTickets = validateNftMinTicketsNotOverCap(drawGoalTickets)
    if (!capTickets.ok) {
      alert(capTickets.error)
      focusFormField(isPartner ? 'partner_min_tickets' : 'floor_price')
      return
    }
    const maxTicketsRaw = ((formData.get('max_tickets') as string) ?? '').trim()
    let maxTicketsParsed: number | null = null
    if (maxTicketsRaw) {
      maxTicketsParsed = parseInt(maxTicketsRaw, 10)
      if (!Number.isFinite(maxTicketsParsed) || maxTicketsParsed <= 0) {
        alert('Max tickets must be a positive whole number, or leave the field empty for unlimited.')
        focusFormField('max_tickets')
        return
      }
      if (maxTicketsParsed < drawGoalTickets) {
        alert(
          isPartner
            ? `Max tickets must be at least ${drawGoalTickets} (your draw goal), or leave empty for unlimited.`
            : `Max tickets must be at least ${drawGoalTickets} (draw goal from floor ÷ ticket price), or leave empty for unlimited.`
        )
        focusFormField('max_tickets')
        return
      }
    }
    const maxCheck = validateNftMaxTickets(maxTicketsParsed, drawGoalTickets)
    if (!maxCheck.ok) {
      alert(maxCheck.error)
      focusFormField('max_tickets')
      return
    }

    const descriptionValue = ((formData.get('description') as string) ?? '').trim()
      ? (formData.get('description') as string)
      : ''
    if (viewerIsAdmin === false && descriptionContainsBlockedLinks(descriptionValue)) {
      alert(
        'Descriptions cannot include links or web addresses. Remove URLs, typed domains (like example.com), IPs, Discord/Telegram invites, and markdown-style links.'
      )
      focusFormField('description')
      return
    }

    setSubmissionError(null)
    setCreateStep('saving')
    setLoading(true)
    const rankValue = formData.get('rank') as string
    const currency = (formData.get('currency') as string) || 'SOL'
    const data: Record<string, unknown> = {
      title: titleTrimmed,
      description: formData.get('description') as string,
      image_url: imageUrl || null,
      ticket_price: tpParsed.value,
      currency,
      max_tickets: maxTicketsParsed,
      rank: rankValue && rankValue.trim() ? rankValue.trim() : null,
      floor_price: floorPriceValue,
      start_time: localDateTimeToUtc(startTime),
      end_time: localDateTimeToUtc(endTime),
      theme_accent: themeAccent,
      status: (formData.get('status') as string) || 'draft',
      slug: titleTrimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, ''),
      wallet_address: publicKey.toBase58(),
      prize_type: isPartner ? 'crypto' : 'nft',
    }
    if (isPartner) {
      data.prize_currency = tokenPrizeCurrency
      data.prize_amount = parseFloat(partnerPrizeAmount.trim())
      data.min_tickets = partnerMinTicketsParsed
    } else {
      data.nft_mint_address = selectedNft!.mint
      data.nft_token_id = selectedNft!.mint
      data.nft_metadata_uri = selectedNft!.metadataUri ?? undefined
      data.nft_collection_name = selectedNft!.collectionName ?? undefined
    }
    if (hideFromPublicBrowse) {
      data.list_on_platform = false
    }
    if (viewerIsAdmin === true) {
      const promo = (formData.get('promo_x_handle') as string)?.trim()
      if (promo) data.promo_x_handle = promo
    }
    if (milestonesEnabled && milestoneRows.length > 0) {
      const built = milestoneRows
        .map((row) => ({
          trigger_type: row.trigger_type,
          trigger_value:
            row.trigger_type === 'draw_threshold' ? 1 : parseFloat(row.trigger_value),
          prize_type: 'crypto' as const,
          prize_amount: parseFloat(row.prize_amount),
          prize_currency: row.prize_currency,
          winner_mode: row.winner_mode,
        }))
        .filter(
          (row) =>
            Number.isFinite(row.trigger_value) &&
            row.trigger_value > 0 &&
            Number.isFinite(row.prize_amount) &&
            row.prize_amount > 0
        )
      if (built.length > 0) data.milestones = built
    }
    if (canUseBambooTicketCurrency) {
      if (currency === 'SOL' && alternateBambooTicketPrice.trim()) {
        const ap = parseNftTicketPrice(alternateBambooTicketPrice.trim())
        if (!ap.ok) {
          alert(`Optional Bamboo ticket price: ${ap.error}`)
          setLoading(false)
          setCreateStep('idle')
          createSubmitInFlightRef.current = false
          return
        }
        data.alternate_bamboo_ticket_price = ap.value
      }
      if (currency === BAMBOO_TICKET_CURRENCY && alternateSolTicketPrice.trim()) {
        const ap = parseNftTicketPrice(alternateSolTicketPrice.trim())
        if (!ap.ok) {
          alert(`Optional SOL ticket price: ${ap.error}`)
          setLoading(false)
          setCreateStep('idle')
          createSubmitInFlightRef.current = false
          return
        }
        data.alternate_sol_ticket_price = ap.value
      }
    }
    try {
      const createUrl = snsDomainHubFlow ? '/api/raffles/sns-domain' : '/api/raffles'
      const response = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-connected-wallet': publicKey.toBase58(),
        },
        body: JSON.stringify(data),
        credentials: 'include',
      })

      if (response.ok) {
        const { raffle, milestones: createdMilestones } = parseCreateRaffleResponse(await response.json())
        // NFT raffles: one flow — sign transfer to escrow, retry verify until RPC catches up, then redirect
        if (
          raffle.prize_type === 'nft' &&
          raffle.nft_mint_address &&
          selectedNft &&
          publicKey &&
          (connected && wallet?.adapter)
        ) {
          try {
            setCreateStep('signing')
            setEscrowProgress({
              open: true,
              title: 'Finish creating your raffle',
              description:
                'Your raffle was saved. Loading escrow settings — your wallet will open next to send the prize NFT.',
              phase: 'loading',
              persistUntilDismiss: false,
            })
            const mintPk = new PublicKey(raffle.nft_mint_address)
            const walletAdapter = wallet?.adapter ?? null

            const escrowRes = await fetch('/api/config/prize-escrow', { credentials: 'include' })
            const escrowData = await escrowRes.json().catch(() => ({}))
            const escrowAddress = escrowData?.address
            if (!escrowRes.ok || !escrowAddress) {
              const errMsg =
                typeof escrowData?.error === 'string' && escrowData.error.trim()
                  ? escrowData.error.trim()
                  : 'Prize escrow is not configured on this server.'
              alert(
                `${errMsg} Your raffle is saved as a draft. ` +
                  'Please contact an admin, or try again once escrow is configured.'
              )
              router.push(`/raffles/${raffle.slug}?deposit=1`)
              return
            }
            const escrowPubkey = new PublicKey(escrowAddress)
            setEscrowProgress((p) => ({
              ...p,
              phase: 'loading',
              persistUntilDismiss: false,
              description:
                'Checking on-chain that your NFT is in this wallet. On mobile or Wi‑Fi this can take 15–45 seconds — please wait.',
            }))

            const depositLogCtx = {
              raffleId: raffle.id,
              raffleSlug: raffle.slug,
              nftMint: raffle.nft_mint_address,
              transferAssetId: selectedNft.mint,
              escrowAddress,
              fromWallet: publicKey.toBase58(),
            }
            logEscrowDepositStart({
              ...depositLogCtx,
              dbPrizeStandard: raffle.prize_standard ?? null,
              displayLabel: selectedNft.name,
            })

            // Mobile RPC can lag behind the NFT list API — retry like the raffle page deposit flow.
            let resolvedHolder: NftHolderInWallet | null = null
            // Helius DAS sets tokenAccount === mint (asset id). That is not an SPL token account; skip
            // or we can mis-resolve and never try compressed.
            if (
              selectedNft?.tokenAccount &&
              selectedNft.tokenAccount !== selectedNft.mint
            ) {
              try {
                const selectedTokenAccount = new PublicKey(selectedNft.tokenAccount)
                const selectedInfo = await connection.getParsedAccountInfo(selectedTokenAccount, 'processed')
                const ownerProgram = selectedInfo.value?.owner
                const isSplProgram = ownerProgram?.equals(TOKEN_PROGRAM_ID) ?? false
                const isToken2022 = ownerProgram?.equals(TOKEN_2022_PROGRAM_ID) ?? false
                const info = (selectedInfo.value?.data as { parsed?: { info?: Record<string, unknown> } } | undefined)?.parsed?.info
                const selectedMint = typeof info?.mint === 'string' ? info.mint : null
                const amountRaw =
                  typeof info?.tokenAmount === 'object' && info?.tokenAmount
                    ? (info.tokenAmount as { amount?: unknown }).amount
                    : undefined
                const amount =
                  typeof amountRaw === 'string'
                    ? Number(amountRaw)
                    : typeof amountRaw === 'number'
                      ? amountRaw
                      : 0
                const delegate = typeof info?.delegate === 'string' ? info.delegate : null
                if (selectedMint === mintPk.toBase58() && amount >= 1 && !delegate) {
                  if (isSplProgram) {
                    resolvedHolder = { tokenProgram: TOKEN_PROGRAM_ID, tokenAccount: selectedTokenAccount }
                  } else if (isToken2022) {
                    resolvedHolder = { tokenProgram: TOKEN_2022_PROGRAM_ID, tokenAccount: selectedTokenAccount }
                  }
                }
              } catch {
                // Fall through to holder lookup retries.
              }
            }
            for (let attempt = 0; attempt < HOLDER_LOOKUP_MAX_ATTEMPTS; attempt++) {
              if (resolvedHolder) break
              const h = await getNftHolderInWallet(connection, mintPk, publicKey, 'processed')
              if (h && 'delegated' in h && h.delegated) {
                alert(
                  'This NFT is staked or delegated. Unstake it, then complete the deposit from the raffle page (your draft is saved).'
                )
                router.push(`/raffles/${raffle.slug}?deposit=1`)
                return
              }
              if (h && 'tokenProgram' in h && 'tokenAccount' in h) {
                resolvedHolder = h
                break
              }
              if (attempt < HOLDER_LOOKUP_MAX_ATTEMPTS - 1) {
                await new Promise((r) => setTimeout(r, 700))
              }
            }

            let depositSig: string | null = null
            let lastMplCoreEscrowError: string | null = null
            let bundledSolWithNft = 0

            const nftMilestoneSol = milestoneDepositTotalForPrizeCurrency(createdMilestones, 'SOL')
            const nftWalletHint =
              nftMilestoneSol > 0
                ? `approve sending the prize NFT and ${nftMilestoneSol} SOL bonus to escrow in one transaction.`
                : 'approve the transaction to send the prize NFT to escrow.'

            setEscrowProgress((p) => ({
              ...p,
              phase: 'loading',
              persistUntilDismiss: false,
              description: `When your wallet opens, ${nftWalletHint}`,
            }))

            if (resolvedHolder) {
              const { tokenProgram, tokenAccount: sourceTokenAccount } = resolvedHolder
              if (walletAdapter && tokenProgram.equals(TOKEN_PROGRAM_ID)) {
                try {
                  logEscrowDepositPath(depositLogCtx, 'token_metadata')
                  depositSig = await transferTokenMetadataNftToEscrow({
                    connection,
                    wallet: walletAdapter,
                    mintAddress: raffle.nft_mint_address,
                    escrowAddress,
                  })
                  logEscrowDepositSigned(depositLogCtx, 'token_metadata', depositSig)
                } catch (tmErr) {
                  logEscrowDepositAbort(depositLogCtx, 'token_metadata_failed_trying_spl', {
                    detail: tmErr instanceof Error ? tmErr.message : String(tmErr),
                  })
                  depositSig = null
                }
              }
              if (!depositSig) {
                if (!connected) {
                  logEscrowDepositAbort(depositLogCtx, 'no_send_transaction_after_token_metadata')
                  alert(
                    'Your wallet did not expose a transaction sender. Open your raffle and complete the deposit there, or try another wallet.'
                  )
                  router.push(`/raffles/${raffle.slug}?deposit=1`)
                  return
                }
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
                    1n,
                    [],
                    tokenProgram
                  )
                )
                const bundle = await appendSolMilestoneTransfersToTransaction(
                  tx,
                  publicKey,
                  createdMilestones
                )
                if (bundle) bundledSolWithNft = bundle.amount
                logEscrowDepositPath(depositLogCtx, 'spl_transfer', {
                  tokenProgram: tokenProgram.toBase58(),
                  sourceTokenAccount: sourceTokenAccount.toBase58(),
                  escrowAta: escrowAta.toBase58(),
                  bundledSolMilestone: bundledSolWithNft > 0 ? bundledSolWithNft : undefined,
                })
                depositSig = await sendTransaction(tx, connection)
                await confirmSignatureSuccessOnChain(connection, depositSig)
                logEscrowDepositSigned(depositLogCtx, 'spl_transfer', depositSig)
              }
            } else if (walletAdapter) {
              try {
                logEscrowDepositPath(depositLogCtx, 'fallback_compressed', {
                  note: 'No SPL holder resolved; trying compressed',
                })
                depositSig = await transferCompressedNftToEscrow({
                  connection,
                  wallet: walletAdapter,
                  assetId: selectedNft.mint,
                  escrowAddress,
                })
                logEscrowDepositSigned(depositLogCtx, 'fallback_compressed', depositSig)
              } catch (cErr) {
                logEscrowDepositAbort(depositLogCtx, 'fallback_compressed_failed', {
                  detail: cErr instanceof Error ? cErr.message : String(cErr),
                })
                depositSig = null
              }
              if (!depositSig) {
                try {
                  logEscrowDepositPath(depositLogCtx, 'fallback_mpl_core')
                  depositSig = await transferMplCoreToEscrow({
                    connection,
                    wallet: walletAdapter,
                    assetId: selectedNft.mint,
                    escrowAddress,
                  })
                  logEscrowDepositSigned(depositLogCtx, 'fallback_mpl_core', depositSig)
                } catch (coreErr) {
                  const coreMsg = coreErr instanceof Error ? coreErr.message : String(coreErr)
                  lastMplCoreEscrowError = coreMsg
                  logEscrowDepositAbort(depositLogCtx, 'fallback_mpl_core_failed', {
                    detail: coreMsg,
                  })
                  depositSig = null
                }
              }
              if (!depositSig) {
                logEscrowDepositAbort(depositLogCtx, 'no_path_create_form')
                const mintShort =
                  selectedNft.mint.length > 16
                    ? `${selectedNft.mint.slice(0, 4)}…${selectedNft.mint.slice(-4)}`
                    : selectedNft.mint
                if (
                  lastMplCoreEscrowError &&
                  isMplCoreNoApprovalsError(lastMplCoreEscrowError)
                ) {
                  alert(
                    mplCoreNoApprovalsEscrowMessage(mintShort, {
                      fullAssetId: selectedNft.mint,
                    })
                  )
                } else {
                  alert(
                    'We could not send this NFT to escrow from here (tried compressed, Metaplex Core, and SPL). ' +
                      'Your raffle is saved — open it to deposit or verify, or try Wi‑Fi / another network.'
                  )
                }
                router.push(`/raffles/${raffle.slug}?deposit=1`)
                return
              }
            } else {
              logEscrowDepositAbort(depositLogCtx, 'no_wallet_adapter_for_core_compressed')
              alert(
                'We could not confirm this NFT as SPL in your wallet yet, and the wallet adapter is not ready for Core/compressed transfers. ' +
                  'Open your raffle when ready and tap deposit.'
              )
              router.push(`/raffles/${raffle.slug}?deposit=1`)
              return
            }

            setEscrowProgress((p) => ({
              ...p,
              phase: 'loading',
              persistUntilDismiss: false,
              description:
                'Saving your deposit and opening your raffle. If our servers are slow to confirm on mobile, your raffle page will update automatically — no need to tap Verify.',
            }))
            const regRes = await fetch(`/api/raffles/${raffle.id}/register-deposit-tx`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ deposit_tx: depositSig }),
            })
            const regData = (await regRes.json().catch(() => ({}))) as {
              error?: string
              verified?: boolean
              pendingReason?: string
              frozenEscrowDiagnostics?: { escrowTokenAccount?: string; mint?: string }
            }
            logEscrowDepositVerify(
              depositLogCtx,
              regRes.ok && regData.verified === true,
              regRes.ok && regData.verified !== true
                ? regData.pendingReason || regData.error
                : undefined
            )
            if (!regRes.ok) {
              if (regRes.status === 401) {
                setEscrowProgress({
                  open: true,
                  title: 'Sign in required',
                  description:
                    'Your session expired. Sign in from your dashboard. Your raffle is saved — after signing in, open your raffle to finish.',
                  phase: 'result',
                  persistUntilDismiss: true,
                  primaryAction: {
                    label: 'Go to dashboard',
                    onClick: () => {
                      setEscrowProgress(CREATE_ESCROW_IDLE)
                      router.push('/dashboard')
                    },
                  },
                })
                return
              }
              const errMsg =
                typeof regData.error === 'string' && regData.error.trim()
                  ? regData.error.trim()
                  : 'Could not save your deposit signature.'
              setEscrowProgress({
                open: true,
                title: 'Could not finish setup',
                description: errMsg,
                phase: 'result',
                persistUntilDismiss: true,
                primaryAction: {
                  label: 'Open raffle',
                  onClick: () => {
                    setEscrowProgress(CREATE_ESCROW_IDLE)
                    router.push(`/raffles/${raffle.slug}`)
                  },
                },
              })
              return
            }
            if (
              regData.verified === false &&
              isEscrowSplPrizeFrozenVerifyError(regData.pendingReason || '')
            ) {
              const q = /devnet/i.test(resolvePublicSolanaRpcUrl()) ? '?cluster=devnet' : ''
              const d = regData.frozenEscrowDiagnostics
              const acct = d?.escrowTokenAccount
              const links = acct
                ? `\n\nEscrow token account (must be thawed on-chain):\nhttps://solscan.io/account/${encodeURIComponent(acct)}${q}`
                : ''
              setEscrowProgress({
                open: true,
                title: 'Deposit blocked',
                description: (regData.pendingReason || 'Frozen token account in escrow.') + links,
                phase: 'result',
                persistUntilDismiss: true,
                primaryAction: {
                  label: 'Open raffle',
                  onClick: () => {
                    setEscrowProgress(CREATE_ESCROW_IDLE)
                    router.push(`/raffles/${raffle.slug}`)
                  },
                },
              })
              return
            }
            if (regData.verified === false) {
              const pr =
                typeof regData.pendingReason === 'string' ? regData.pendingReason.trim() : ''
              if (pr) {
                setEscrowProgress({
                  open: true,
                  title: 'Verification pending',
                  description: pr,
                  phase: 'result',
                  persistUntilDismiss: true,
                  primaryAction: {
                    label: 'Open raffle',
                    onClick: () => {
                      setEscrowProgress(CREATE_ESCROW_IDLE)
                      router.push(`/raffles/${raffle.slug}?deposit=1`)
                    },
                  },
                })
                return
              }
            }
            try {
              if (bundledSolWithNft > 0 && depositSig) {
                const v = await verifyCreateMilestoneDepositsFromClient({
                  raffleId: raffle.id,
                  depositTx: depositSig,
                  currency: 'SOL',
                })
                if (!v.ok) {
                  throw new Error(v.error ?? 'Bonus deposit verification failed.')
                }
              }
              await depositFollowUpMilestonesAfterPrize({
                raffle,
                createdMilestones,
                prizeCurrency: raffle.prize_currency,
                mainDepositSig: depositSig,
                skipCurrencies: bundledSolWithNft > 0 ? ['SOL'] : [],
              })
            } catch (milestoneErr) {
              const msg =
                milestoneErr instanceof Error
                  ? milestoneErr.message
                  : 'Bonus milestone deposit failed.'
              setEscrowProgress({
                open: true,
                title: 'Bonus deposit needed',
                description: `${msg} Open your raffle to finish bonus deposits.`,
                phase: 'result',
                persistUntilDismiss: true,
                primaryAction: {
                  label: 'Open raffle',
                  onClick: () => {
                    setEscrowProgress(CREATE_ESCROW_IDLE)
                    router.push(`/raffles/${raffle.slug}#bonus-milestones`)
                  },
                },
              })
              return
            }
            router.push(`/raffles/${raffle.slug}`)
          } catch (transferErr) {
            logEscrowDepositError(
              {
                raffleId: raffle.id,
                raffleSlug: raffle.slug,
                nftMint: raffle.nft_mint_address,
                transferAssetId: selectedNft.mint,
                fromWallet: publicKey.toBase58(),
              },
              transferErr
            )
            console.error('NFT transfer to escrow failed:', transferErr)
            alert(
              transferErr instanceof Error ? transferErr.message : 'Transfer to escrow failed. You can complete it on the raffle page.'
            )
            router.push(`/raffles/${raffle.slug}?deposit=1`)
          }
        } else if (raffle.prize_type === 'crypto' && isPartnerPrizeCurrency(raffle.prize_currency)) {
          const prizeCur = String(raffle.prize_currency || '').trim().toUpperCase()
          const prizeMint = getPartnerPrizeMintForCurrency(prizeCur)
          if (!publicKey || !connected || !prizeMint) {
            router.push(`/raffles/${raffle.slug}?deposit=1`)
          } else {
            try {
              setCreateStep('signing')
              setEscrowProgress({
                open: true,
                title: 'Finish creating your raffle',
                description:
                  `Your raffle was saved. Loading escrow settings — your wallet will open next to send the ${prizeCur} prize.`,
                phase: 'loading',
                persistUntilDismiss: false,
              })
              const rawNeed = humanPartnerPrizeToRawUnits(prizeCur, raffle.prize_amount)
              if (rawNeed == null) {
                alert(`Invalid ${prizeCur} prize amount from server. Open your raffle to try deposit again.`)
                router.push(`/raffles/${raffle.slug}?deposit=1`)
                return
              }
              const escrowRes = await fetch('/api/config/prize-escrow', { credentials: 'include' })
              const escrowData = await escrowRes.json().catch(() => ({}))
              const escrowAddress = escrowData?.address
              if (!escrowRes.ok || !escrowAddress) {
                const errMsg =
                  typeof escrowData?.error === 'string' && escrowData.error.trim()
                    ? escrowData.error.trim()
                    : 'Prize escrow is not configured on this server.'
                alert(`${errMsg} Your raffle is saved as a draft.`)
                router.push(`/raffles/${raffle.slug}?deposit=1`)
                return
              }
              const escrowPubkey = new PublicKey(escrowAddress)
              const milestoneBonus = milestoneDepositTotalForPrizeCurrency(createdMilestones, prizeCur)
              const prizeHuman = Number(raffle.prize_amount ?? 0)
              let depositSig: string
              if (prizeCur === 'SOL') {
                if (rawNeed > BigInt(Number.MAX_SAFE_INTEGER)) {
                  alert('This SOL prize amount is too large for a wallet transfer.')
                  router.push(`/raffles/${raffle.slug}?deposit=1`)
                  return
                }
                let fundsEscrowAddress: string | null = null
                if (milestoneBonus > 0) {
                  fundsEscrowAddress = await fetchFundsEscrowAddress()
                  if (!fundsEscrowAddress) {
                    alert(
                      'Funds escrow is not configured. Your raffle is saved — deposit bonuses on the raffle page.'
                    )
                    router.push(`/raffles/${raffle.slug}?deposit=1`)
                    return
                  }
                }
                const walletCopy =
                  milestoneBonus > 0
                    ? `approve sending ${(prizeHuman + milestoneBonus).toFixed(4)} SOL (${prizeHuman} prize + ${milestoneBonus} bonus) to escrow.`
                    : 'approve the transaction to send SOL to escrow.'
                setEscrowProgress((p) => ({
                  ...p,
                  phase: 'loading',
                  persistUntilDismiss: false,
                  description: `When your wallet opens, ${walletCopy}`,
                }))
                const tx = new Transaction().add(
                  SystemProgram.transfer({
                    fromPubkey: publicKey,
                    toPubkey: escrowPubkey,
                    lamports: Number(rawNeed),
                  })
                )
                if (milestoneBonus > 0 && fundsEscrowAddress) {
                  tx.add(
                    SystemProgram.transfer({
                      fromPubkey: publicKey,
                      toPubkey: new PublicKey(fundsEscrowAddress),
                      lamports: Math.round(milestoneBonus * 1e9),
                    })
                  )
                }
                depositSig = await sendTransaction(tx, connection)
                await confirmSignatureSuccessOnChain(connection, depositSig)
              } else {
                const mintPk = new PublicKey(prizeMint)
                setEscrowProgress((p) => ({
                  ...p,
                  phase: 'loading',
                  persistUntilDismiss: false,
                  description: `Checking your ${prizeCur} balance — please wait.`,
                }))
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
                  alert(
                    `Your wallet does not show enough ${prizeCur} for this prize yet (or the account is delegated). Top up ${prizeCur}, then open your raffle to deposit.`
                  )
                  router.push(`/raffles/${raffle.slug}?deposit=1`)
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
                if (prizeCur === 'USDC' && milestoneBonus > 0) {
                  const fundsEscrowAddress = await fetchFundsEscrowAddress()
                  if (!fundsEscrowAddress) {
                    alert(
                      'Funds escrow is not configured. Your raffle is saved — deposit bonuses on the raffle page.'
                    )
                    router.push(`/raffles/${raffle.slug}?deposit=1`)
                    return
                  }
                  const fundsPk = new PublicKey(fundsEscrowAddress)
                  const fundsAta = await getAssociatedTokenAddress(
                    mintPk,
                    fundsPk,
                    false,
                    tokenProgram,
                    ASSOCIATED_TOKEN_PROGRAM_ID
                  )
                  try {
                    await getAccount(connection, fundsAta, 'confirmed', tokenProgram)
                  } catch {
                    tx.add(
                      createAssociatedTokenAccountInstruction(
                        publicKey,
                        fundsAta,
                        fundsPk,
                        mintPk,
                        tokenProgram,
                        ASSOCIATED_TOKEN_PROGRAM_ID
                      )
                    )
                  }
                  const usdcDecimals = getTokenInfo('USDC').decimals
                  const bonusRaw = BigInt(Math.round(milestoneBonus * Math.pow(10, usdcDecimals)))
                  tx.add(
                    createTransferInstruction(
                      sourceTokenAccount,
                      fundsAta,
                      publicKey,
                      bonusRaw,
                      [],
                      tokenProgram
                    )
                  )
                }
                const walletCopy =
                  milestoneBonus > 0
                    ? `approve sending ${prizeHuman + milestoneBonus} ${prizeCur} (${prizeHuman} prize + ${milestoneBonus} bonus) to escrow.`
                    : `approve the transaction to send ${prizeCur} to escrow.`
                setEscrowProgress((p) => ({
                  ...p,
                  phase: 'loading',
                  persistUntilDismiss: false,
                  description: `When your wallet opens, ${walletCopy}`,
                }))
                depositSig = await sendTransaction(tx, connection)
                await confirmSignatureSuccessOnChain(connection, depositSig)
              }
              setEscrowProgress((p) => ({
                ...p,
                phase: 'loading',
                persistUntilDismiss: false,
                description:
                  'Saving your deposit and opening your raffle. If our servers are slow to confirm on mobile, your raffle page will update automatically.',
              }))
              const regRes = await fetch(`/api/raffles/${raffle.id}/register-deposit-tx`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ deposit_tx: depositSig }),
              })
              const regData = (await regRes.json().catch(() => ({}))) as {
                error?: string
                verified?: boolean
                pendingReason?: string
                frozenEscrowDiagnostics?: { escrowTokenAccount?: string }
              }
              if (!regRes.ok) {
                if (regRes.status === 401) {
                  setEscrowProgress({
                    open: true,
                    title: 'Sign in required',
                    description:
                      'Your session expired. Sign in from your dashboard. Your raffle is saved — after signing in, open your raffle to finish.',
                    phase: 'result',
                    persistUntilDismiss: true,
                    primaryAction: {
                      label: 'Go to dashboard',
                      onClick: () => {
                        setEscrowProgress(CREATE_ESCROW_IDLE)
                        router.push('/dashboard')
                      },
                    },
                  })
                  return
                }
                const errMsg =
                  typeof regData.error === 'string' && regData.error.trim()
                    ? regData.error.trim()
                    : 'Could not save your deposit signature.'
                setEscrowProgress({
                  open: true,
                  title: 'Could not finish setup',
                  description: errMsg,
                  phase: 'result',
                  persistUntilDismiss: true,
                  primaryAction: {
                    label: 'Open raffle',
                    onClick: () => {
                      setEscrowProgress(CREATE_ESCROW_IDLE)
                      router.push(`/raffles/${raffle.slug}`)
                    },
                  },
                })
                return
              }
              if (
                regData.verified === false &&
                isEscrowSplPrizeFrozenVerifyError(regData.pendingReason || '')
              ) {
                const q = /devnet/i.test(resolvePublicSolanaRpcUrl()) ? '?cluster=devnet' : ''
                const acct = regData.frozenEscrowDiagnostics?.escrowTokenAccount
                const links = acct
                  ? `\n\nEscrow token account:\nhttps://solscan.io/account/${encodeURIComponent(acct)}${q}`
                  : ''
                setEscrowProgress({
                  open: true,
                  title: 'Deposit blocked',
                  description: (regData.pendingReason || 'Verify failed') + links,
                  phase: 'result',
                  persistUntilDismiss: true,
                  primaryAction: {
                    label: 'Open raffle',
                    onClick: () => {
                      setEscrowProgress(CREATE_ESCROW_IDLE)
                      router.push(`/raffles/${raffle.slug}`)
                    },
                  },
                })
                return
              }
              if (regData.verified === false) {
                const pr =
                  typeof regData.pendingReason === 'string' ? regData.pendingReason.trim() : ''
                if (pr) {
                  setEscrowProgress({
                    open: true,
                    title: 'Verification pending',
                    description: pr,
                    phase: 'result',
                    persistUntilDismiss: true,
                    primaryAction: {
                      label: 'Open raffle',
                      onClick: () => {
                        setEscrowProgress(CREATE_ESCROW_IDLE)
                        router.push(`/raffles/${raffle.slug}?deposit=1`)
                      },
                    },
                  })
                  return
                }
              }
              try {
                await depositFollowUpMilestonesAfterPrize({
                  raffle,
                  createdMilestones,
                  prizeCurrency: prizeCur,
                  mainDepositSig: depositSig,
                })
              } catch (milestoneErr) {
                const msg =
                  milestoneErr instanceof Error
                    ? milestoneErr.message
                    : 'Bonus milestone deposit failed.'
                setEscrowProgress({
                  open: true,
                  title: 'Bonus deposit needed',
                  description: `${msg} Open your raffle to finish bonus deposits.`,
                  phase: 'result',
                  persistUntilDismiss: true,
                  primaryAction: {
                    label: 'Open raffle',
                    onClick: () => {
                      setEscrowProgress(CREATE_ESCROW_IDLE)
                      router.push(`/raffles/${raffle.slug}#bonus-milestones`)
                    },
                  },
                })
                return
              }
              router.push(`/raffles/${raffle.slug}`)
            } catch (transferErr) {
              console.error('SPL prize token transfer to escrow failed:', transferErr)
              alert(
                transferErr instanceof Error
                  ? transferErr.message
                  : 'Transfer to escrow failed. You can complete it on the raffle page.'
              )
              router.push(`/raffles/${raffle.slug}?deposit=1`)
            }
          }
        } else if (raffle.prize_type === 'nft' && raffle.nft_mint_address) {
          router.push(`/raffles/${raffle.slug}?deposit=1`)
        } else {
          router.push(`/raffles/${raffle.slug}`)
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        const msg = errorData?.error ?? 'Error creating raffle'
        const existingSlug =
          typeof errorData?.existing_slug === 'string' && errorData.existing_slug.trim()
            ? errorData.existing_slug.trim()
            : ''
        if (response.status === 401) {
          alert(
            typeof msg === 'string' && msg.trim()
              ? msg.trim()
              : 'Sign in required. Open your dashboard, sign in with your wallet, then try again.'
          )
          router.push('/dashboard')
        } else if (response.status === 409 && existingSlug) {
          const conflictReason = errorData?.conflict_reason as DuplicateNftPrizeConflictReason | undefined
          const offerEndsRaw =
            typeof errorData?.offer_window_ends_at === 'string' ? errorData.offer_window_ends_at.trim() : ''
          const offerEndsLabel =
            offerEndsRaw && !Number.isNaN(new Date(offerEndsRaw).getTime())
              ? formatDateTimeWithTimezone(offerEndsRaw)
              : ''
          let alertBody = typeof msg === 'string' && msg.trim() ? msg.trim() : 'This NFT cannot be listed yet.'
          if (conflictReason === 'post_draw_offers' && offerEndsLabel) {
            alertBody += `\n\nYou can try again after buyout offers close (${offerEndsLabel}).`
          }
          const openHint =
            conflictReason === 'post_draw_offers' || conflictReason === 'settlement_in_progress'
              ? 'Opening the previous raffle…'
              : 'Opening your existing raffle…'
          alert(`${alertBody}\n\n${openHint}`)
          router.push(`/raffles/${encodeURIComponent(existingSlug)}`)
        } else {
          const friendly = formatCreateRaffleApiError(response.status, typeof msg === 'string' ? msg : '')
          setSubmissionError(friendly)
          requestAnimationFrame(() => {
            document
              .getElementById('create-raffle-submit-error')
              ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          })
        }
      }
    } catch (error) {
      console.error('Error:', error)
      setSubmissionError(
        'We could not reach the server to save your raffle. Check your connection, then try again.'
      )
      requestAnimationFrame(() => {
        document
          .getElementById('create-raffle-submit-error')
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    }
    } finally {
      createSubmitInFlightRef.current = false
      setLoading(false)
      setCreateStep('idle')
      setEscrowProgress((p) => (p.persistUntilDismiss ? p : CREATE_ESCROW_IDLE))
    }
  }

  const borderStyle = getThemeAccentBorderStyle(themeAccent)

  if (!connected || !publicKey) {
    return (
      <Card className={getThemeAccentClasses(themeAccent)} style={borderStyle}>
        <CardHeader>
          <CardTitle>{snsDomainHubFlow ? 'Create a .sol domain raffle' : 'Create a raffle'}</CardTitle>
          <CardDescription>
            {snsDomainHubFlow
              ? 'Connect your wallet to host a .sol domain raffle for the domains hub. Sign in from your dashboard first so we can save your listing.'
              : 'Connect your wallet to create a raffle (NFT or SPL token prize such as SOL or USDC). Sign in from your dashboard first so we can save your listing.'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Fragment>
      <EscrowDepositProgressDialog
        open={escrowProgress.open}
        title={escrowProgress.title}
        description={escrowProgress.description}
        phase={escrowProgress.phase}
        primaryAction={escrowProgress.primaryAction}
      />
      <Card className={getThemeAccentClasses(themeAccent)} style={borderStyle}>
      <CardHeader>
        <CardTitle>Raffle Details</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-6"
        >
          {prizeMode === 'token' ? (
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input id="title" name="title" required />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            {viewerIsAdmin === false && (
              <p className="text-xs text-muted-foreground">
                No links or web addresses (URLs, domains, IPs, Discord/Telegram invites) unless you use an admin wallet.
              </p>
            )}
            <textarea
              id="description"
              name="description"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {!snsDomainHubFlow ? (
          <div className="space-y-3 rounded-md border bg-muted/30 p-4">
            <Label className="text-base">Prize type</Label>
            <div
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              role="group"
              aria-label="Prize type"
            >
              <Button
                type="button"
                variant={prizeMode === 'nft' ? 'default' : 'outline'}
                className="min-h-[44px] w-full touch-manipulation"
                onClick={() => setPrizeMode('nft')}
                aria-pressed={prizeMode === 'nft'}
              >
                NFT from wallet
              </Button>
              <Button
                type="button"
                variant={prizeMode === 'token' ? 'default' : 'outline'}
                className="min-h-[44px] w-full touch-manipulation"
                onClick={() => setPrizeMode('token')}
                aria-pressed={prizeMode === 'token'}
              >
                SPL Token
              </Button>
            </div>
            {viewerIsAdmin !== true && !isPartnerCommunityCreator ? (
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground/90">SOL</span> and{' '}
                <span className="font-medium text-foreground/90">USDC</span> are selectable below. Other SPL prize tokens
                appear grayed out until you are on a partner allowlist —{' '}
                <Link href="/partner-program" className="text-primary underline-offset-2 hover:underline">
                  partner program
                </Link>
                .
              </p>
            ) : null}
            {prizeMode === 'token' && (
              <div className="space-y-1.5">
                <Label htmlFor="token_prize_select" className="text-sm">
                  Prize token
                </Label>
                <select
                  id="token_prize_select"
                  value={tokenPrizeCurrency}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v && isPartnerPrizeCurrency(v)) {
                      setPrizeMode('token')
                      setTokenPrizeCurrency(v)
                    }
                  }}
                  className="flex min-h-[44px] w-full touch-manipulation rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label="Prize token"
                >
                  {allPartnerPrizeTokens.map((t) => {
                    const label = t.displayLabel ? `${t.displayLabel} (${t.currencyCode})` : t.currencyCode
                    const disabled =
                      !isPublicSplPrizeCurrency(t.currencyCode) && !canSelectPartnerPrizeTokens
                    return (
                      <option
                        key={t.currencyCode}
                        value={t.currencyCode}
                        disabled={disabled}
                        title={
                          disabled
                            ? 'Partner prize token — available to Owltopia admins and allowlisted partner wallets'
                            : undefined
                        }
                      >
                        {label}
                      </option>
                    )
                  })}
                  {PARTNER_OWL_PRIZE_UI_ENABLED && viewerIsAdmin === true ? <option value="OWL">OWL</option> : null}
                </select>
              </div>
            )}
          </div>
          ) : (
            <div className="space-y-2 rounded-md border border-teal-500/25 bg-teal-500/5 p-4">
              <p className="text-sm font-medium text-foreground">.sol domain prize (SNS)</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Only wallet NFTs that look like SNS .sol domains are listed. This path creates a raffle for the .sol
                domains hub only (hidden from Main and Partner). The server verifies on-chain metadata before saving.
              </p>
            </div>
          )}

          {prizeMode === 'token' && (
            <div
              id="partner-prize-section"
              tabIndex={-1}
              className="space-y-3 rounded-md border bg-muted/30 p-4 border-emerald-500/30"
            >
              <Label>
                {tokenPrizeCurrency} prize amount *
              </Label>
              <Input
                id="partner_prize_amount"
                name="partner_prize_amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder={partnerPrizeAmountPlaceholder}
                className="min-h-[44px] touch-manipulation text-base sm:text-sm"
                value={partnerPrizeAmount}
                onChange={(e) => setPartnerPrizeAmount(e.target.value)}
              />
              <div className="space-y-2">
                <Label htmlFor="partner_min_tickets">Draw goal (min tickets) *</Label>
                <Input
                  id="partner_min_tickets"
                  name="partner_min_tickets"
                  type="number"
                  min={1}
                  step={1}
                  required
                  placeholder="e.g. 50"
                  className="min-h-[44px] touch-manipulation text-base sm:text-sm"
                  value={partnerMinTickets}
                  onChange={(e) => setPartnerMinTickets(e.target.value)}
                />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  How many confirmed tickets must sell before a winner can be drawn after the raffle ends.
                </p>
              </div>
            </div>
          )}

          <div id="nft-prize-section" tabIndex={-1} className="space-y-3 rounded-md border bg-muted/30 p-4">
              {prizeMode === 'nft' ? (
                <>
              <Label>{snsDomainHubFlow ? '.sol domain prize (from your wallet)' : 'NFT prize (from your wallet)'}</Label>
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-400">Be careful when selecting an NFT</p>
                <p className="text-muted-foreground mt-0.5">
                  Only choose an NFT you intend to give away. Staked or delegated NFTs cannot be used until you unstake them.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={loadWalletAssets}
                disabled={loadingWalletAssets || !publicKey}
              >
                {loadingWalletAssets ? 'Loading…' : snsDomainHubFlow ? 'Load .sol domains from wallet' : 'Load NFTs from wallet'}
              </Button>
              {walletAssetsError && (
                <p className="text-sm text-destructive">{walletAssetsError}</p>
              )}
              {walletNfts && walletNfts.length === 0 && !loadingWalletAssets && (
                <div className="text-sm text-muted-foreground space-y-1">
                  {snsDomainHubFlow ? (
                    <>
                      <p>No SNS-looking .sol domain NFTs found in this wallet.</p>
                      <p>
                        We filter by metadata (for example a name ending in <span className="font-mono">.sol</span> or
                        known SNS/Bonfida collection hints). Transfer a domain NFT here, then load again.
                      </p>
                    </>
                  ) : (
                    <>
                      <p>No NFTs found in this wallet.</p>
                      <p>If you&apos;re on <strong>Devnet</strong>, set Phantom to Devnet and ensure this wallet holds at least one NFT (mint or receive one, then click Load again).</p>
                    </>
                  )}
                </div>
              )}
              {walletNfts && walletNfts.length > 0 && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="nft-search" className="text-xs">Search NFTs</Label>
                    <Input
                      id="nft-search"
                      type="text"
                      placeholder="Search by name, collection, or mint…"
                      value={nftSearchQuery}
                      onChange={(e) => setNftSearchQuery(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[280px] overflow-y-auto">
                  {(() => {
                    const q = nftSearchQuery.trim().toLowerCase()
                    const filtered = q
                      ? walletNfts.filter(
                          (nft) =>
                            (nft.name?.toLowerCase().includes(q)) ||
                            (nft.collectionName?.toLowerCase().includes(q)) ||
                            nft.mint.toLowerCase().includes(q)
                        )
                      : walletNfts
                    return filtered.length === 0 ? (
                      <p className="col-span-full text-sm text-muted-foreground py-2">
                        {q ? 'No NFTs match your search.' : 'No NFTs to show.'}
                      </p>
                    ) : (
                      filtered.map((nft) => (
                    <button
                      key={nft.tokenAccount}
                      type="button"
                      onClick={() => {
                        setSelectedNft(nft)
                        setImageUrl(nft.image?.trim() ? nft.image.trim() : null)
                      }}
                      className={`rounded-lg border-2 p-2 text-left transition-colors ${
                        selectedNft?.mint === nft.mint
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-muted-foreground/50'
                      }`}
                    >
                      <div className="aspect-square rounded overflow-hidden bg-muted mb-2">
                        {nft.image ? (
                          <img
                            src={getRaffleDisplayImageUrl(nft.image) ?? nft.image}
                            alt={nft.name ?? nft.mint}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const el = e.currentTarget
                              const fallback = nft.image
                              if (fallback && el.src !== fallback) {
                                el.src = fallback
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                            No image
                          </div>
                        )}
                      </div>
                      <p className="text-xs font-medium truncate" title={nft.name ?? nft.mint}>
                        {nft.name ?? `${nft.mint.slice(0, 4)}…`}
                      </p>
                    </button>
                      ))
                    )
                  })()}
                </div>
                </>
              )}
              {selectedNft && (
                <p className="text-sm text-muted-foreground">
                  Selected: {selectedNft.name ?? selectedNft.mint}
                </p>
              )}
              {prizeMode === 'nft' ? (
                <div className="space-y-2 pt-2">
                  <Label htmlFor="title">Title *</Label>
                  {selectedNft ? (
                    <>
                      <Input
                        id="title"
                        name="title"
                        readOnly
                        required
                        value={nftPrizeRaffleTitleFromWalletSelection(
                          selectedNft.name,
                          selectedNft.mint
                        )}
                        className="bg-muted/50"
                        aria-readonly="true"
                      />
                      <p className="text-xs text-muted-foreground">
                        Raffle title is the selected NFT&apos;s name (from your wallet metadata).
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Pick an NFT above to set the raffle title.
                    </p>
                  )}
                </div>
              ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Switch to &quot;NFT prize&quot; above to pick an NFT from your wallet.
                </p>
              )}
            </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currency">Currency *</Label>
              <select
                id="currency"
                name="currency"
                value={raffleCurrency}
                onChange={(e) => setRaffleCurrency(e.target.value)}
                className="flex h-10 w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 touch-manipulation"
                required
              >
                <option value="SOL">SOL</option>
                <option value="USDC">USDC</option>
                {isOwlEnabled() && viewerIsAdmin === true ? <option value="OWL">OWL</option> : null}
                {isOwlEnabled() && viewerIsAdmin !== true ? (
                  <option value="OWL" disabled>
                    OWL (platform admins only)
                  </option>
                ) : null}
                {canUseBambooTicketCurrency ? (
                  <option value={BAMBOO_TICKET_CURRENCY}>Bamboo (BAMBOO)</option>
                ) : (
                  <option value={BAMBOO_TICKET_CURRENCY} disabled>
                    Bamboo (BAMBOO) — Partner Pro allowlisted wallet
                  </option>
                )}
              </select>
              {(canUseBambooTicketCurrency || (partnerDiscordLinked && partnerCreateMode)) && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {canUseBambooTicketCurrency ? (
                    <>
                      Extra ticket currencies in this menu are allowlisted to approved partner creator wallets only —
                      other hosts do not see them.
                    </>
                  ) : (
                    <>
                      Want your project&apos;s SPL as ticket payment?{' '}
                      <Link
                        href="/partner-program"
                        className="font-medium text-primary underline-offset-2 hover:underline touch-manipulation"
                      >
                        Partner Pro
                      </Link>{' '}
                      adds custom ticket mints for your wallet&apos;s raffles only (not site-wide).
                    </>
                  )}
                </p>
              )}
            </div>
            {canUseBambooTicketCurrency && raffleCurrency === 'SOL' && (
              <div className="space-y-2">
                <Label htmlFor="alternate_bamboo_ticket_price">Bamboo ticket price (optional)</Label>
                <Input
                  id="alternate_bamboo_ticket_price"
                  type="text"
                  inputMode="decimal"
                  className="text-base sm:text-sm touch-manipulation min-h-[44px]"
                  value={alternateBambooTicketPrice}
                  onChange={(e) => setAlternateBambooTicketPrice(e.target.value)}
                  placeholder="e.g. 100 — same raffle, buyers may pay SOL or BAMBOO"
                />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Leave blank for SOL-only tickets. When set, one raffle accepts both SOL (ticket price above) and BAMBOO
                  at this price — no second listing for the same SPL prize.
                </p>
              </div>
            )}
            {canUseBambooTicketCurrency && raffleCurrency === BAMBOO_TICKET_CURRENCY && (
              <div className="space-y-2">
                <Label htmlFor="alternate_sol_ticket_price">SOL ticket price (optional)</Label>
                <Input
                  id="alternate_sol_ticket_price"
                  type="text"
                  inputMode="decimal"
                  className="text-base sm:text-sm touch-manipulation min-h-[44px]"
                  value={alternateSolTicketPrice}
                  onChange={(e) => setAlternateSolTicketPrice(e.target.value)}
                  placeholder="e.g. 0.05 — buyers may pay BAMBOO or SOL"
                />
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="floor_price">Floor price (prize value) *</Label>
                <Input
                  id="floor_price"
                  name="floor_price"
                  type="text"
                  inputMode="decimal"
                  className="text-base sm:text-sm touch-manipulation min-h-[44px]"
                  value={floorPrice ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setFloorPrice(v)
                    applyFloorToTicketAutofill(v)
                  }}
                  placeholder="e.g., 0.25 or 5.5 (same as currency above)"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ticket_price">Ticket price *</Label>
                <Input
                  id="ticket_price"
                  name="ticket_price"
                  type="number"
                  step="any"
                  required
                  className="text-base sm:text-sm touch-manipulation min-h-[44px]"
                  value={ticketPrice ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setTicketPrice(v)
                    if (lastAutofillTicketRef.current !== null && v !== lastAutofillTicketRef.current) {
                      lastAutofillTicketRef.current = null
                    }
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {prizeMode === 'nft'
                ? 'Draw goal updates automatically when you change ticket price or prize value.'
                : 'Changing ticket price updates the sales goal below; minimum tickets stays what you set for the draw.'}
            </p>
            <div
              className="rounded-lg border bg-muted/40 px-3 py-2.5 sm:px-4 space-y-2"
              role="status"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-foreground">Your raffle goals</p>
              {!thresholdExplain.ready ? (
                <p className="text-xs text-muted-foreground leading-relaxed">{thresholdExplain.intro}</p>
              ) : (
                <ul className="text-sm text-foreground space-y-1.5 list-none pl-0">
                  {thresholdExplain.minTicketsLine ? (
                    <li className="leading-snug">{thresholdExplain.minTicketsLine}</li>
                  ) : null}
                  {thresholdExplain.salesGoalLine ? (
                    <li className="leading-snug font-medium tabular-nums">{thresholdExplain.salesGoalLine}</li>
                  ) : null}
                </ul>
              )}
              {thresholdExplain.footnote ? (
                <p className="text-xs text-muted-foreground leading-relaxed">{thresholdExplain.footnote}</p>
              ) : null}
            </div>
            <div className="rounded-lg border border-border/80 bg-background/50 px-3 py-2.5 sm:px-4 space-y-1.5">
              <p className="text-sm font-medium text-foreground">{createRaffleFeeCopy.heading}</p>
              {createRaffleFeeCopy.lines.map((line) => (
                <p key={line} className="text-xs text-muted-foreground leading-relaxed">
                  {line}
                </p>
              ))}
              {createRaffleFeeCopy.yourRate ? (
                <p className="text-xs font-medium text-foreground pt-0.5">{createRaffleFeeCopy.yourRate}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="max_tickets">Max Tickets (optional)</Label>
            <Input
              id="max_tickets"
              name="max_tickets"
              type="number"
              min={prizeMode === 'token' ? (partnerMinTicketsParsed ?? 1) : (derivedDrawGoal ?? 1)}
              placeholder="Leave empty for unlimited tickets"
              className="min-h-[44px] touch-manipulation"
            />
          </div>

          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer touch-manipulation min-h-[44px]">
              <input
                type="checkbox"
                checked={milestonesEnabled}
                onChange={(e) => {
                  const on = e.target.checked
                  setMilestonesEnabled(on)
                  if (!on) {
                    setMilestoneRows([{ ...DEFAULT_MILESTONE_ROW }])
                  }
                }}
                className="mt-1 h-5 w-5"
              />
              <span>
                <span className="text-sm font-medium text-foreground">Add bonus milestone(s)</span>
                <span className="block text-xs text-amber-200/90 mt-0.5">{MILESTONE_BETA_NOTICE}</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Bonuses in the same currency as your prize are charged in the same wallet step as the main prize.
                  Prefund to platform funds escrow (max {MILESTONE_MAX_PRIZE_SOL} SOL or {milestoneMaxPrizeUsdc()}{' '}
                  USDC per milestone). Default winner mode is random (ticket-weighted).
                </span>
              </span>
            </label>
            {milestonesEnabled && (
              <>
                <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
                  {milestoneRulesCopy.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {milestoneRows.map((row, idx) => (
                  <div key={idx} className="border border-border/50 rounded-md p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">
                        Milestone {idx + 1}
                        {milestoneRows.length > 1 ? ` of ${milestoneRows.length}` : ''}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-[44px] min-w-[44px] touch-manipulation text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                        aria-label={`Remove milestone ${idx + 1}`}
                        onClick={() => {
                          setMilestoneRows((prev) => {
                            const next = prev.filter((_, i) => i !== idx)
                            if (next.length === 0) {
                              setMilestonesEnabled(false)
                              return [{ ...DEFAULT_MILESTONE_ROW }]
                            }
                            return next
                          })
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Trigger</Label>
                      <select
                        value={row.trigger_type}
                        onChange={(e) => {
                          const v = e.target.value as RaffleMilestoneTriggerType
                          setMilestoneRows((prev) =>
                            prev.map((r, i) => {
                              if (i !== idx) return r
                              if (v === 'draw_threshold') {
                                return {
                                  ...r,
                                  trigger_type: v,
                                  trigger_value: '1',
                                  followDrawGoal: true,
                                }
                              }
                              if (v === 'absolute_tickets') {
                                return {
                                  ...r,
                                  trigger_type: v,
                                  trigger_value:
                                    effectiveDrawGoalTickets != null
                                      ? String(effectiveDrawGoalTickets)
                                      : r.trigger_value,
                                  followDrawGoal: true,
                                }
                              }
                              return { ...r, trigger_type: v, followDrawGoal: false }
                            })
                          )
                        }}
                        className="flex min-h-[44px] w-full touch-manipulation rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="draw_threshold">When draw goal is met (recommended)</option>
                        <option value="absolute_tickets">Custom ticket count</option>
                        <option value="percent_max">% of max tickets</option>
                      </select>
                    </div>
                    {row.trigger_type === 'draw_threshold' ? (
                      <div className="space-y-1 sm:col-span-1">
                        <Label className="text-xs">Unlock target</Label>
                        <p className="text-sm text-muted-foreground min-h-[44px] flex items-center tabular-nums">
                          {effectiveDrawGoalTickets != null && effectiveDrawGoalTickets > 0
                            ? `${effectiveDrawGoalTickets} tickets (matches draw goal)`
                            : 'Set floor, ticket price, or draw goal first'}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label className="text-xs">Target value</Label>
                        <Input
                          type="number"
                          min={effectiveDrawGoalTickets ?? 1}
                          value={row.trigger_value}
                          onChange={(e) =>
                            setMilestoneRows((prev) =>
                              prev.map((r, i) =>
                                i === idx
                                  ? { ...r, trigger_value: e.target.value, followDrawGoal: false }
                                  : r
                              )
                            )
                          }
                          className="min-h-[44px] touch-manipulation"
                        />
                        {row.trigger_type === 'absolute_tickets' &&
                          effectiveDrawGoalTickets != null &&
                          effectiveDrawGoalTickets > 0 && (
                            <button
                              type="button"
                              className="text-xs text-primary underline-offset-2 hover:underline touch-manipulation"
                              onClick={() =>
                                setMilestoneRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx
                                      ? {
                                          ...r,
                                          trigger_value: String(effectiveDrawGoalTickets),
                                          followDrawGoal: true,
                                        }
                                      : r
                                  )
                                )
                              }
                            >
                              Use draw goal ({effectiveDrawGoalTickets} tickets)
                            </button>
                          )}
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs">Bonus amount</Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={row.prize_amount}
                        onChange={(e) =>
                          setMilestoneRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, prize_amount: e.target.value } : r))
                          )
                        }
                        className="min-h-[44px] touch-manipulation"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Currency</Label>
                      <select
                        value={row.prize_currency}
                        onChange={(e) => {
                          const v = e.target.value as 'SOL' | 'USDC'
                          setMilestoneRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, prize_currency: v } : r))
                          )
                        }}
                        className="flex min-h-[44px] w-full touch-manipulation rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="SOL">SOL</option>
                        <option value="USDC">USDC</option>
                      </select>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">Winner selection</Label>
                      <select
                        value={row.winner_mode}
                        onChange={(e) => {
                          const v = e.target.value as RaffleMilestoneWinnerMode
                          setMilestoneRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, winner_mode: v } : r))
                          )
                        }}
                        className="flex min-h-[44px] w-full touch-manipulation rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="random">Random (ticket-weighted) — recommended</option>
                        <option value="top_buyer">Top buyer (ties broken randomly)</option>
                        <option value="creator_initiated_pull">Creator starts random draw when unlocked</option>
                      </select>
                    </div>
                    </div>
                  </div>
                ))}
                {milestoneRows.length < MILESTONE_MAX_PER_RAFFLE && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-[44px] touch-manipulation"
                    onClick={() =>
                      setMilestoneRows((prev) => [...prev, { ...DEFAULT_MILESTONE_ROW }])
                    }
                  >
                    Add another milestone
                  </Button>
                )}
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="rank">Rank (optional)</Label>
            <Input
              id="rank"
              name="rank"
              type="text"
              placeholder="e.g., #123 or 123"
              className="min-h-[44px] touch-manipulation"
            />
          </div>

          {viewerIsAdmin === true && (
            <div className="space-y-2">
              <Label htmlFor="promo_x_handle">Promo X @handle (optional, admin)</Label>
              <Input
                id="promo_x_handle"
                name="promo_x_handle"
                type="text"
                placeholder="e.g. THC_Labz"
                className="min-h-[44px] touch-manipulation"
                maxLength={15}
              />
              <p className="text-xs text-muted-foreground">
                Official @Owltopia_sol share copy uses this for the NFT line (e.g. NFT: @THC_Labz).
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="status">Status *</Label>
            <select
              id="status"
              name="status"
              defaultValue="draft"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              <option value="draft">Draft</option>
              <option value="live" disabled>
                Live (NFT requires escrow deposit)
              </option>
              <option value="ready_to_draw" disabled>
                Ready to Draw (NFT requires escrow deposit)
              </option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="theme_accent">Theme Accent *</Label>
            <select
              id="theme_accent"
              name="theme_accent"
              value={themeAccent}
              onChange={(e) => setThemeAccent(e.target.value as ThemeAccent)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              {THEME_ACCENT_SELECT_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {canSetLinkOnlyVisibility && (
            <div className="rounded-lg border border-violet-500/25 bg-violet-500/5 px-3 py-3 sm:px-4 sm:py-3.5 space-y-2">
              {partnerCreateMode && (
                <p className="text-xs font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
                  Partner raffle setup
                </p>
              )}
              <label className="flex items-start gap-3 touch-manipulation min-h-[44px]">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0"
                  checked={hideFromPublicBrowse}
                  onChange={(e) => setHideFromPublicBrowse(e.target.checked)}
                  id="hide-from-public-browse"
                />
                <span className="min-w-0 text-sm sm:text-base leading-relaxed text-foreground/95">
                  <span className="font-medium">Partner raffle only</span>
                  {': '}
                  hide this raffle from the public raffles list. People can still enter using the direct
                  page link{partnerDiscordLinked ? ' from your partner Discord webhook or a shared link' : ' you share'}.
                </span>
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_time">Start Time *</Label>
              <div className="flex gap-2 items-start">
                <DateTimePicker
                  id="start_time"
                  name="start_time"
                  value={startTime}
                  onChange={setStartTime}
                  required
                  datePlaceholder="Choose start date"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const now = new Date()
                    const year = now.getFullYear()
                    const month = String(now.getMonth() + 1).padStart(2, '0')
                    const day = String(now.getDate()).padStart(2, '0')
                    const hours = String(now.getHours()).padStart(2, '0')
                    const minutes = String(now.getMinutes()).padStart(2, '0')
                    setStartTime(`${year}-${month}-${day}T${hours}:${minutes}`)
                  }}
                  title="Set to current time"
                  className="touch-manipulation min-h-[44px] shrink-0 px-3 sm:px-4"
                >
                  Now
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_time">End Time * (Max 7 days from start)</Label>
              <div className="flex gap-2 items-start">
                <DateTimePicker
                  id="end_time"
                  name="end_time"
                  value={endTime}
                  onChange={setEndTime}
                  required
                  datePlaceholder="Choose end date"
                  min={startTime || undefined}
                  max={
                    startTime
                      ? (() => {
                          const startUtc = localDateTimeToUtc(startTime)
                          const maxUtc = new Date(startUtc)
                          maxUtc.setUTCDate(maxUtc.getUTCDate() + 7)
                          return utcToLocalDateTime(maxUtc.toISOString())
                        })()
                      : undefined
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const baseUtc = startTime ? localDateTimeToUtc(startTime) : new Date().toISOString()
                    const maxUtc = new Date(baseUtc)
                    maxUtc.setUTCDate(maxUtc.getUTCDate() + 7)
                    setEndTime(utcToLocalDateTime(maxUtc.toISOString()))
                  }}
                  title="Set to 7 days from start"
                  className="touch-manipulation min-h-[44px] shrink-0 px-3 sm:px-4"
                >
                  Max
                </Button>
              </div>
            </div>
          </div>

          {submissionError ? (
            <div
              id="create-raffle-submit-error"
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <p className="min-w-0 flex-1 leading-relaxed">{submissionError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch-manipulation min-h-[44px] shrink-0 self-start border-destructive/40"
                  onClick={() => setSubmissionError(null)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <Button
              type="submit"
              disabled={loading || createStep !== 'idle'}
              className="flex-1 touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              {loading
                ? createStep === 'signing'
                  ? 'Approve in wallet…'
                  : createStep === 'saving'
                    ? 'Saving raffle…'
                    : 'Working…'
                : 'Create raffle — send prize to escrow'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              className="touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
    </Fragment>
  )
}

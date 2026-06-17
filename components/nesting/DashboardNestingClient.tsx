'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token'
import { PublicKey, Transaction } from '@solana/web3.js'
import {
  Loader2,
  Egg,
  LayoutDashboard,
  ArrowLeft,
  RefreshCw,
  Wallet,
  ChevronDown,
  Layers,
  Coins,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import type { StakingRewardEventRow } from '@/lib/db/staking-reward-events'
import {
  isOpenStakingPosition,
  isOpeningNftNestAbortable,
  nftMintBlocksDuplicateStakeExceptResume,
} from '@/lib/nesting/position-lifecycle'
import {
  buildOwlClaimAllPreview,
  isOwlRewardPosition,
  sumOwlPendingAccrualForPositions,
} from '@/lib/nesting/claim-plan'
import { sendStakingPlatformFeeTransaction } from '@/lib/nesting/client/staking-platform-fee-tx'
import {
  formatStakingPlatformFeeTotalLabel,
} from '@/lib/nesting/staking-platform-fee'
import type { StakingPlatformFeeTxConfig } from '@/lib/nesting/client/staking-platform-fee-tx'

const PENDING_CLAIM_LEDGER_STORAGE_KEY = 'owl_pending_claim_ledger_sync_v1'

type PendingClaimLedgerSync = {
  transaction_signature: string
  claims: Array<{ position_id: string; amount: number; claimed_rewards_total: number }>
  total_claimed: number
}
import { PositionCard } from '@/components/nesting/PositionCard'
import { NftPerchGroupedNestCard } from '@/components/nesting/NftPerchGroupedNestCard'
import { nestGalleryAnchorId } from '@/lib/nesting/nest-position-anchor'
import { NestingStakedAssetThumb } from '@/components/nesting/NestingStakedAssetThumb'
import { SectionHeader } from '@/components/council/SectionHeader'
import { EmptyState } from '@/components/council/EmptyState'
import { runNestingTxAction, throwIfNestingAborted } from '@/lib/nesting/run-tx-action'
import {
  isNestingTxPhaseInFlight,
  nestingTxPhaseLabel,
  type NestingTxPhase,
} from '@/lib/nesting/tx-states'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { NestingActionStatusLine } from '@/components/nesting/NestingActionStatusLine'
import { NestingOwlCoinWalletProgressPanel } from '@/components/nesting/NestingOwlCoinWalletProgressPanel'
import { NestingSecurityNotice } from '@/components/nesting/NestingSecurityNotice'
import { NestingClaimLedger } from '@/components/nesting/NestingClaimLedger'
import { NestingClaimAllPanel } from '@/components/nesting/NestingClaimAllPanel'
import { NestingClaimSuccessDialog } from '@/components/nesting/NestingClaimSuccessDialog'
import {
  NestSwapAssetChip,
  NestSwapFlowShell,
} from '@/components/nesting/nest-swap-ui'
import { useNestingSecurityAck } from '@/hooks/use-nesting-security-ack'
import {
  findStakingPoolByIdOrSlug,
  formatRewardRate,
  isNftStakingPool,
  perchAssetKindLabel,
  shortenAddress,
} from '@/lib/nesting/format'
import {
  nestingClaimAccruingButtonClass,
  nestingClaimReadyButtonClass,
  nestingMutedActionButtonClass,
} from '@/lib/nesting/ui-classes'
import { getCachedAdmin, setCachedAdmin, type AdminRole } from '@/lib/admin-check-cache'
import { cn, isMobileDevice, isSolanaMobileEnvironment } from '@/lib/utils'
import { nestingMobileConnectHint } from '@/lib/nesting/mobile-hints'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { decimalToRawBigint } from '@/lib/nesting/token-amount'
import { getTokenInfo } from '@/lib/tokens'
import {
  addMplCoreFreezeDelegate,
  batchRelockMplCoreNestAssetsInWallet,
  capNftStakeAssetIds,
  chunkNftFreezeAssetIds,
  NESTING_MPL_CORE_FREEZE_WALLET_BATCH_MAX,
  NESTING_NFT_STAKE_MAX_PER_RUN,
} from '@/lib/solana/mpl-core-freeze'
import { isNestingStakeFlowError, NestingStakeFlowError } from '@/lib/nesting/errors'
import { formatNestingWalletError } from '@/lib/nesting/wallet-error'
import {
  fetchNestingJson,
  formatNestingApiFetchError,
  nestingClientApiUrl,
  NESTING_CLAIM_FETCH_TIMEOUT_MS,
  nestingFetchNetworkErrorMessage,
  nestingFetchTimeoutMessage,
} from '@/lib/nesting/fetch-json'

const MOBILE_401_RETRY_MS = 800
const MOBILE_NETWORK_RETRY_MS = 1_200
/** Match main dashboard: let wallet publicKey settle after redirect (Android / Seeker). */
const MOBILE_WALLET_STABILIZE_MS = 450
const MOBILE_VISIBILITY_REFRESH_MS = 350
const NESTING_ADMIN_SELLOUT_BYPASS_STORAGE_KEY = 'owl_nesting_admin_bypass_sellout_v1'

function rpcEndpointLooksDevnet(endpoint: string | undefined): boolean {
  if (!endpoint?.trim()) return false
  return /devnet/i.test(endpoint)
}

export function DashboardNestingClient() {
  const { publicKey, connected, signMessage, wallet } = useWallet()
  const {
    acknowledged: securityAck,
    signing: securityAckSigning,
    error: securityAckError,
    signAcknowledgment: signSecurityAck,
    clearError: clearSecurityAckError,
  } = useNestingSecurityAck(publicKey)
  const { connection } = useConnection()
  const sendTransaction = useSendTransactionForWallet()
  const { setVisible } = useWalletModal()
  const searchParams = useSearchParams()
  const preselectedPoolId = searchParams.get('pool')

  const [pools, setPools] = useState<StakingPoolRow[]>([])
  const [nestingDisabled, setNestingDisabled] = useState(false)
  const [nestingPausedByDeployEnv, setNestingPausedByDeployEnv] = useState(false)
  const [nestingPausedByAdmin, setNestingPausedByAdmin] = useState(false)
  const [nestingNftFreezeDelegate, setNestingNftFreezeDelegate] = useState('')
  const [platformFeeConfig, setPlatformFeeConfig] = useState<{
    sol: number
    lamports: number
    treasury: string | null
  }>({ sol: 0, lamports: 0, treasury: null })
  const [positions, setPositions] = useState<StakingPositionRow[]>([])
  const [claimLedgerEvents, setClaimLedgerEvents] = useState<StakingRewardEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [walletReady, setWalletReady] = useState(() =>
    typeof window !== 'undefined' ? !isMobileDevice() : true
  )
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [successNotice, setSuccessNotice] = useState<{
    message: string
    hint?: string
    title?: string
    placement: 'modal'
  } | null>(null)
  const [claimLedgerNotice, setClaimLedgerNotice] = useState<string | null>(null)
  const [claimLedgerHealBusy, setClaimLedgerHealBusy] = useState(false)
  const [stakeAmount, setStakeAmount] = useState('')
  const [stakeAssetId, setStakeAssetId] = useState('')
  const [stakeAssetIds, setStakeAssetIds] = useState<string[]>([])
  const [stakeTxPhase, setStakeTxPhase] = useState<NestingTxPhase>('idle')
  const [claimAllTxPhase, setClaimAllTxPhase] = useState<NestingTxPhase>('idle')
  /** Multi NFT confirm: show which coin the wallet is locking so the flow does not look frozen. */
  const [nftStakeBatchHint, setNftStakeBatchHint] = useState<string | null>(null)
  const [posPhases, setPosPhases] = useState<Record<string, { claim: NestingTxPhase; unstake: NestingTxPhase }>>({})
  const [viewerIsAdmin, setViewerIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && publicKey ? getCachedAdmin(publicKey.toBase58()) : null
  )
  const [adminBypassSellout, setAdminBypassSellout] = useState(false)
  const [owlNestMintScan, setOwlNestMintScan] = useState<{
    status: 'idle' | 'loading' | 'done'
    mints: { mint: string; name: string | null; image?: string | null }[]
    configured: boolean
    hint?: string
    /** From API when configured — helps verify the NFT matches this collection mint. */
    resolvedCollectionAddress?: string | null
  }>({ status: 'idle', mints: [], configured: true })

  /** On-chain SPL token balance scan for token-type perches (e.g. OWL governance). */
  const [walletTokenScan, setWalletTokenScan] = useState<{
    status: 'idle' | 'loading' | 'done'
    /** UI-friendly token amount (already divided by 10^decimals). */
    uiAmount: number | null
    /** Raw on-chain balance, base units. */
    rawAmount: bigint | null
    decimals: number | null
    /** Mint we read against — used to detect stale scans when perch changes. */
    mintAddress: string | null
    hint?: string
  }>({
    status: 'idle',
    uiAmount: null,
    rawAmount: null,
    decimals: null,
    mintAddress: null,
  })

  const owlNestFetchAbortRef = useRef<AbortController | null>(null)
  /** Lets the user back out of a slow open-nest flow (API / wallet / sync). */
  const stakeTxAbortRef = useRef<AbortController | null>(null)
  const owlNestScanStatusRef = useRef(owlNestMintScan.status)
  owlNestScanStatusRef.current = owlNestMintScan.status
  /** Pool id for which we last finished a wallet scan (`done`). Cleared when perch changes so auto-refresh cannot run against stale “done”. */
  const owlNestLastLoadedPoolIdRef = useRef<string | null>(null)

  const setPosSubPhase = useCallback((id: string, key: 'claim' | 'unstake', phase: NestingTxPhase) => {
    setPosPhases((m) => {
      const cur = m[id] ?? {
        claim: 'idle' as NestingTxPhase,
        unstake: 'idle' as NestingTxPhase,
      }
      return { ...m, [id]: { ...cur, [key]: phase } }
    })
  }, [])

  /** Clear stale `failed` / orphaned phases after refresh (avoids blocking Claim all). */
  const clearStalePositionPhases = useCallback(() => {
    setPosPhases((m) => {
      let changed = false
      const next: typeof m = {}
      for (const [id, phases] of Object.entries(m)) {
        const claim = isNestingTxPhaseInFlight(phases.claim) ? phases.claim : 'idle'
        const unstake = isNestingTxPhaseInFlight(phases.unstake) ? phases.unstake : 'idle'
        if (claim !== phases.claim || unstake !== phases.unstake) changed = true
        if (claim !== 'idle' || unstake !== 'idle') {
          next[id] = { claim, unstake }
        }
      }
      return changed ? next : m
    })
  }, [])

  const walletAddr = publicKey?.toBase58() ?? ''

  const platformFeeActive = useMemo(
    () => platformFeeConfig.lamports > 0 && !!platformFeeConfig.treasury?.trim(),
    [platformFeeConfig]
  )

  const platformFeeTxConfig = useMemo((): StakingPlatformFeeTxConfig | null => {
    if (!platformFeeActive || !platformFeeConfig.treasury?.trim()) return null
    return {
      treasury: platformFeeConfig.treasury.trim(),
      unitLamports: platformFeeConfig.lamports,
    }
  }, [platformFeeActive, platformFeeConfig])

  const loadPools = useCallback(async () => {
    try {
      const res = await fetch(nestingClientApiUrl('/api/staking/pools'), { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return
      setPools(Array.isArray(json.pools) ? json.pools : [])
      setNestingDisabled(json.nesting_disabled === true)
      setNestingPausedByDeployEnv(json.nesting_paused_by_deploy_env === true)
      setNestingPausedByAdmin(json.nesting_paused_by_admin === true)
      setNestingNftFreezeDelegate(
        typeof json.nesting_nft_freeze_delegate === 'string' ? json.nesting_nft_freeze_delegate : ''
      )
      const feeLamports = Number(json.nesting_platform_fee_lamports)
      const feeSol = Number(json.nesting_platform_fee_sol)
      setPlatformFeeConfig({
        lamports: Number.isFinite(feeLamports) && feeLamports > 0 ? feeLamports : 0,
        sol: Number.isFinite(feeSol) && feeSol > 0 ? feeSol : 0,
        treasury:
          typeof json.nesting_platform_fee_treasury === 'string' && json.nesting_platform_fee_treasury.trim()
            ? json.nesting_platform_fee_treasury.trim()
            : null,
      })
    } catch {
      /* ignore */
    }
  }, [])

  const loadClaimLedger = useCallback(async () => {
    if (!connected || !publicKey) return
    const addr = publicKey.toBase58()
    const res = await fetch(nestingClientApiUrl('/api/me/staking/reward-events?limit=25'), {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'X-Connected-Wallet': addr },
    })
    if (!res.ok) {
      setClaimLedgerEvents([])
      return
    }
    const json = await res.json().catch(() => ({}))
    setClaimLedgerEvents(Array.isArray(json.events) ? json.events : [])
  }, [connected, publicKey])

  const applyPositionsPayload = useCallback(
    (json: Record<string, unknown>) => {
      setPositions(Array.isArray(json.positions) ? (json.positions as StakingPositionRow[]) : [])
      const healedCount =
        typeof json.healed_count === 'number' && json.healed_count > 0 ? json.healed_count : 0
      if (healedCount > 0) {
        setSuccessNotice({
          placement: 'modal',
          title: healedCount === 1 ? 'Nest opened successfully' : 'Nests opened successfully',
          message:
            healedCount === 1
              ? 'Your Owltopia coin is nested and the wallet lock is confirmed on-chain.'
              : `${healedCount} Owltopia coins are nested and wallet locks are confirmed on-chain.`,
          hint: 'OWL rewards are accruing. Claim anytime in Your nests below.',
        })
      }
      clearStalePositionPhases()
    },
    [clearStalePositionPhases]
  )

  const loadPositions = useCallback(
    async (opts?: { heal?: boolean; silent?: boolean }): Promise<boolean> => {
      if (!connected || !publicKey) return false
      const addr = publicKey.toBase58()
      const heal = opts?.heal !== false
      const url = heal
        ? '/api/me/staking/positions'
        : '/api/me/staking/positions?heal=0'
      const result = await fetchNestingJson<Record<string, unknown>>(url, {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'X-Connected-Wallet': addr },
      })

      if (result.status === 0 && !result.ok) {
        if (!opts?.silent) {
          setError(
            result.clientTimeout
              ? nestingFetchTimeoutMessage('positions')
              : nestingFetchNetworkErrorMessage('positions')
          )
        }
        return false
      }

      if (result.status === 401) {
        setNeedsSignIn(true)
        setPositions([])
        setClaimLedgerEvents([])
        return false
      }

      const json = result.json ?? {}
      if (!result.ok) {
        if (!opts?.silent) {
          setError(typeof json.error === 'string' ? json.error : 'Failed to load positions')
        }
        return false
      }

      setNeedsSignIn(false)
      applyPositionsPayload(json)
      void loadClaimLedger()
      return true
    },
    [connected, publicKey, loadClaimLedger, applyPositionsPayload]
  )

  const refreshAll = useCallback(async () => {
    if (!connected || !publicKey) {
      setLoading(false)
      setPositions([])
      setNeedsSignIn(false)
      return
    }
    setLoading(true)
    setError(null)
    await loadPools()
    let ok = await loadPositions({ heal: false })
    if (
      !ok &&
      typeof window !== 'undefined' &&
      isMobileDevice() &&
      document.visibilityState === 'visible'
    ) {
      await new Promise((r) => setTimeout(r, MOBILE_401_RETRY_MS))
      ok = await loadPositions({ heal: false, silent: true })
    }
    if (
      !ok &&
      typeof window !== 'undefined' &&
      isMobileDevice() &&
      document.visibilityState === 'visible'
    ) {
      await new Promise((r) => setTimeout(r, MOBILE_NETWORK_RETRY_MS))
      ok = await loadPositions({ heal: false, silent: true })
    }
    setLoading(false)
    if (ok) {
      void loadPositions({ heal: true, silent: true })
    }
  }, [connected, publicKey, loadPools, loadPositions])

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

  useEffect(() => {
    if (!walletReady && isMobileDevice()) return
    void refreshAll()
  }, [refreshAll, walletReady])

  useEffect(() => {
    if (!connected || !publicKey) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const run = () => {
        void loadPositions({ heal: false, silent: true }).then((ok) => {
          if (ok) void loadPositions({ heal: true, silent: true })
        })
      }
      if (isMobileDevice()) {
        setTimeout(run, MOBILE_VISIBILITY_REFRESH_MS)
      } else {
        run()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [connected, publicKey, loadPositions])


  const [rewardsNowMs, setRewardsNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setRewardsNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') clearStalePositionPhases()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [clearStalePositionPhases])

  useEffect(() => {
    try {
      setAdminBypassSellout(sessionStorage.getItem(NESTING_ADMIN_SELLOUT_BYPASS_STORAGE_KEY) === '1')
    } catch {
      setAdminBypassSellout(false)
    }
  }, [])

  const setAdminBypassSelloutPersisted = useCallback((next: boolean) => {
    setAdminBypassSellout(next)
    try {
      sessionStorage.setItem(NESTING_ADMIN_SELLOUT_BYPASS_STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* private mode / storage full */
    }
  }, [])

  useEffect(() => {
    if (!connected || !publicKey) {
      setViewerIsAdmin(false)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached === true) {
      setViewerIsAdmin(true)
      return
    }
    let cancelled = false
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled || !data) return
        const admin = data.isAdmin === true
        const role = admin && data.role ? data.role : null
        setCachedAdmin(addr, admin, role as AdminRole | undefined)
        setViewerIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setViewerIsAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey])

  const positionLockedPoolId = useMemo(() => {
    const ids = new Set<string>()
    for (const pos of positions) {
      if (pos.status !== 'active' && pos.status !== 'pending') continue
      const pid = pos.pool_id?.trim()
      if (pid) ids.add(pid)
    }
    if (ids.size !== 1) return null
    return [...ids][0]!
  }, [positions])

  const poolById = useMemo(() => {
    const m = new Map<string, StakingPoolRow>()
    for (const p of pools) m.set(p.id, p)
    return m
  }, [pools])

  /** Active + in-progress nests — closed (`unstaked`) rows stay in state but hide from the list. */
  const openPositions = useMemo(
    () => positions.filter((p) => isOpenStakingPosition(p)),
    [positions]
  )

  /** NFT perches with 2+ open positions render as one grouped card (same pool). */
  const { nftNestGroups, ungroupedOpenPositions } = useMemo(() => {
    const byPool = new Map<string, StakingPositionRow[]>()
    for (const pos of openPositions) {
      const poolRow = poolById.get(pos.pool_id)
      if (!poolRow || poolRow.asset_type !== 'nft') continue
      const prev = byPool.get(pos.pool_id)
      if (prev) prev.push(pos)
      else byPool.set(pos.pool_id, [pos])
    }

    const groupedPoolIds = new Set<string>()
    const groups: { poolId: string; pool: StakingPoolRow; positions: StakingPositionRow[] }[] = []
    for (const [poolId, plist] of byPool) {
      if (plist.length < 2) continue
      const poolRow = poolById.get(poolId)
      if (!poolRow) continue
      groupedPoolIds.add(poolId)
      groups.push({
        poolId,
        pool: poolRow,
        positions: [...plist].sort(
          (a, b) => new Date(a.staked_at).getTime() - new Date(b.staked_at).getTime()
        ),
      })
    }

    const ungroupedOpenPositions = openPositions.filter((pos) => {
      const poolRow = poolById.get(pos.pool_id)
      if (poolRow?.asset_type === 'nft' && groupedPoolIds.has(pos.pool_id)) return false
      return true
    })

    groups.sort((a, b) => (a.pool.name ?? a.poolId).localeCompare(b.pool.name ?? b.poolId))
    return { nftNestGroups: groups, ungroupedOpenPositions }
  }, [openPositions, poolById])

  const claimAllPreview = useMemo(
    () => buildOwlClaimAllPreview(openPositions, rewardsNowMs),
    [openPositions, rewardsNowMs]
  )

  const claimableNestCount = claimAllPreview.count
  const claimAllReady = claimAllPreview.ready

  const claimAllPlatformFeeLabel = useMemo(() => {
    if (!platformFeeActive || !claimAllReady || claimableNestCount < 1) return null
    return formatStakingPlatformFeeTotalLabel(claimableNestCount)
  }, [platformFeeActive, claimAllReady, claimableNestCount])

  const claimAllBusy = claimAllTxPhase !== 'idle'

  /** Deploy kill switch only — admin “pause holder actions” still allows claims. */
  const nestingClaimsBlocked = nestingPausedByDeployEnv

  const claimAllButtonDisabled =
    nestingClaimsBlocked || claimAllBusy || stakeTxPhase !== 'idle'

  const claimAllDisabledReason = useMemo((): string | null => {
    if (!claimAllButtonDisabled || !claimAllReady) return null
    if (claimAllBusy) return null
    if (nestingClaimsBlocked) {
      return 'Claims are off while NESTING_DISABLED is set — see the notice above.'
    }
    if (stakeTxPhase !== 'idle') return 'Finish the nest you are opening above, then try again.'
    return null
  }, [claimAllButtonDisabled, claimAllReady, claimAllBusy, nestingClaimsBlocked, stakeTxPhase])

  /** Match staked mints to the user’s last wallet NFT scan (image + name hints). */
  const nestingWalletMintHints = useMemo(() => {
    const m = new Map<string, { name: string | null; image: string | null }>()
    for (const row of owlNestMintScan.mints) {
      const id = row.mint?.trim()
      if (!id) continue
      m.set(id, { name: row.name ?? null, image: row.image ?? null })
    }
    return m
  }, [owlNestMintScan.mints])

  /** Single active staking row (canonical Owl Nest deployment). */
  const solePerch = pools.length === 1 ? pools[0] : null

  /** True when the URL chose this perch (`?pool=slug` or id) — one perch session, no picker. */
  const perchChosenInUrl = Boolean(preselectedPoolId?.trim())

  /**
   * Perch locked for this visit. One perch per session: explicit `?pool=`, the only
   * live pool, or all open nests on the same pool — never mix Owltopia coins + council UI.
   */
  const lockedPerch = useMemo(() => {
    if (solePerch) return solePerch
    if (preselectedPoolId) {
      const fromUrl = findStakingPoolByIdOrSlug(pools, preselectedPoolId)
      if (fromUrl) return fromUrl
    }
    if (positionLockedPoolId) {
      const fromPositions = findStakingPoolByIdOrSlug(pools, positionLockedPoolId)
      if (fromPositions) return fromPositions
    }
    return null
  }, [solePerch, preselectedPoolId, pools, positionLockedPoolId])

  const preselectedPerchMissing =
    perchChosenInUrl && !loading && pools.length > 0 && !lockedPerch

  const showPerchPicker = !lockedPerch && pools.length > 0

  const otherPerches = useMemo(() => {
    if (!lockedPerch) return []
    return pools.filter((p) => p.id !== lockedPerch.id)
  }, [lockedPerch, pools])

  const selectedPerch = useMemo(() => lockedPerch ?? undefined, [lockedPerch])

  const nftMintRequired = selectedPerch ? isNftStakingPool(selectedPerch) : false
  const tokenStakeRequired = selectedPerch ? !isNftStakingPool(selectedPerch) : false

  const owlCoinProgressPreferredPoolId = useMemo(() => {
    if (selectedPerch && isNftStakingPool(selectedPerch)) return selectedPerch.id
    if (preselectedPoolId) return preselectedPoolId
    return null
  }, [selectedPerch, preselectedPoolId])

  /**
   * Mint address used to fund a token-type perch. Prefers the perch's own
   * `token_mint`/`stake_mint`, then falls back to the platform-wide OWL mint
   * (`NEXT_PUBLIC_OWL_MINT_ADDRESS`) so OWL governance perches can read the
   * wallet balance even before an admin fills in the per-perch mint.
   */
  const { tokenStakeMint, tokenStakeMintFallback } = useMemo(() => {
    if (selectedPerch?.asset_type !== 'token') {
      return { tokenStakeMint: null as string | null, tokenStakeMintFallback: false }
    }
    const direct =
      selectedPerch.token_mint?.trim() || selectedPerch.stake_mint?.trim() || ''
    if (direct) return { tokenStakeMint: direct, tokenStakeMintFallback: false }
    const owl = getTokenInfo('OWL').mintAddress?.trim() || ''
    if (owl) return { tokenStakeMint: owl, tokenStakeMintFallback: true }
    return { tokenStakeMint: null as string | null, tokenStakeMintFallback: false }
  }, [selectedPerch])

  /**
   * Symbol shown on the "Load X" button. Prefers the perch's `reward_token`,
   * else assumes "OWL" when we fell back to the platform OWL mint.
   */
  const tokenStakeSymbol = useMemo(() => {
    if (selectedPerch?.asset_type !== 'token') return 'token'
    const fromPool = selectedPerch.reward_token?.trim()
    if (fromPool) return fromPool
    if (tokenStakeMintFallback) return 'OWL'
    return 'token'
  }, [selectedPerch, tokenStakeMintFallback])

  /** Bump when nested mint set changes so we re-scan eligible NFT list after stake/unstake. */
  const nestedActiveMintKey = useMemo(
    () =>
      positions
        .filter((p) => p.status === 'active' && p.asset_identifier?.trim())
        .map((p) => p.asset_identifier!.trim())
        .sort()
        .join('|'),
    [positions],
  )

  const owlNestEligibleMintsKey = useMemo(
    () =>
      owlNestMintScan.mints
        .map((m) => m.mint)
        .sort()
        .join('|'),
    [owlNestMintScan.mints],
  )

  const selectedOwlNestMintRows = useMemo(
    () =>
      stakeAssetIds
        .map((id) => owlNestMintScan.mints.find((m) => m.mint === id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m)),
    [stakeAssetIds, owlNestMintScan.mints]
  )

  useEffect(() => {
    owlNestFetchAbortRef.current?.abort()
    owlNestLastLoadedPoolIdRef.current = null
    const poolId = selectedPerch?.id ?? ''
    if (!nftMintRequired || !poolId) {
      setOwlNestMintScan({ status: 'idle', mints: [], configured: true })
      return
    }
    setOwlNestMintScan({ status: 'idle', mints: [], configured: true })
    setStakeAssetId('')
    setStakeAssetIds([])
  }, [nftMintRequired, selectedPerch?.id])

  useEffect(() => {
    return () => owlNestFetchAbortRef.current?.abort()
  }, [])

  const loadOwlNestNftsFromWallet = useCallback(async () => {
    if (!connected || !publicKey || needsSignIn || loading || error !== null) return
    const poolId = selectedPerch?.id
    if (!nftMintRequired || !poolId) return

    owlNestFetchAbortRef.current?.abort()
    const ac = new AbortController()
    owlNestFetchAbortRef.current = ac

    const addr = publicKey.toBase58()
    const mintLooksValid = (m: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)

    setOwlNestMintScan({
      status: 'loading',
      mints: [],
      configured: true,
      hint: undefined,
      resolvedCollectionAddress: undefined,
    })

    try {
      const res = await fetch(
        nestingClientApiUrl(
          `/api/me/nesting/wallet-owl-nest-nfts?pool_id=${encodeURIComponent(poolId)}`
        ),
        {
          credentials: 'include',
          cache: 'no-store',
          headers: { 'X-Connected-Wallet': addr },
          signal: ac.signal,
        }
      )
      const raw = await res.json().catch(() => ({}))
      if (ac.signal.aborted) return
      if (!res.ok) {
        owlNestLastLoadedPoolIdRef.current = poolId
        setOwlNestMintScan({
          status: 'done',
          mints: [],
          configured: true,
          hint: typeof raw?.error === 'string' ? raw.error : 'Could not scan wallet for Owltopia coins.',
          resolvedCollectionAddress: undefined,
        })
        return
      }
      if (raw?.configured === false) {
        owlNestLastLoadedPoolIdRef.current = poolId
        setOwlNestMintScan({
          status: 'done',
          mints: [],
          configured: false,
          hint:
            typeof raw?.message === 'string'
              ? raw.message
              : 'Set Owltopia / nesting collection env or pool collection_key to auto-detect mints.',
          resolvedCollectionAddress: null,
        })
        return
      }
      const rows = Array.isArray(raw?.mints) ? raw.mints : []
      const mints = rows
        .map((row: { mint?: unknown; name?: unknown; image?: unknown }) => ({
          mint: typeof row.mint === 'string' ? row.mint.trim() : '',
          name: typeof row.name === 'string' ? row.name : null,
          image: typeof row.image === 'string' ? row.image : null,
        }))
        .filter((row: { mint: string }) => mintLooksValid(row.mint))
      owlNestLastLoadedPoolIdRef.current = poolId
      const resolvedCollectionAddress =
        typeof raw?.collectionAddress === 'string' ? raw.collectionAddress.trim() : null
      setOwlNestMintScan({
        status: 'done',
        mints,
        configured: true,
        resolvedCollectionAddress: resolvedCollectionAddress || null,
      })
    } catch {
      if (ac.signal.aborted) return
      owlNestLastLoadedPoolIdRef.current = poolId
      setOwlNestMintScan({
        status: 'done',
        mints: [],
        configured: true,
        hint: nestingFetchNetworkErrorMessage('generic'),
        resolvedCollectionAddress: undefined,
      })
    }
  }, [
    connected,
    publicKey,
    needsSignIn,
    loading,
    error,
    nftMintRequired,
    selectedPerch?.id,
  ])

  const loadOwlNestNftsRef = useRef(loadOwlNestNftsFromWallet)
  loadOwlNestNftsRef.current = loadOwlNestNftsFromWallet

  /** Reset token balance scan whenever the selected perch / mint changes. */
  useEffect(() => {
    setWalletTokenScan({
      status: 'idle',
      uiAmount: null,
      rawAmount: null,
      decimals: null,
      mintAddress: null,
    })
    // Token perches don't use the NFT mint/memo field — clear any stale value
    // left over from a previously selected NFT perch.
    if (tokenStakeRequired) setStakeAssetId('')
  }, [tokenStakeRequired, tokenStakeMint])

  /**
   * Loads the user's on-chain SPL balance for the perch's `token_mint`
   * (e.g. OWL governance token). Only used for token-type perches.
   * Public on-chain read — does not require backend sign-in.
   */
  const loadPerchTokenFromWallet = useCallback(async () => {
    if (!connected || !publicKey) return
    if (!tokenStakeRequired || !tokenStakeMint) return

    setWalletTokenScan({
      status: 'loading',
      uiAmount: null,
      rawAmount: null,
      decimals: null,
      mintAddress: tokenStakeMint,
    })

    try {
      const mint = new PublicKey(tokenStakeMint)
      // Fast pre-check so we can show a clearer error if the mint isn't on
      // this cluster (common cause: env points at mainnet OWL mint while RPC
      // is devnet, or vice versa — `getMint` would otherwise throw a generic
      // "TokenAccountNotFoundError").
      const mintAccountInfo = await connection.getAccountInfo(mint, 'confirmed')
      if (!mintAccountInfo) {
        const rpc =
          ((connection as { rpcEndpoint?: string }).rpcEndpoint ?? '').trim() ||
          ((connection as { _rpcEndpoint?: string })._rpcEndpoint ?? '').trim()
        const devnetRpc = rpcEndpointLooksDevnet(rpc)
        const extra =
          devnetRpc && tokenStakeSymbol === 'OWL'
            ? ' Your app RPC is devnet, but this OWL mint is almost certainly mainnet-only. Use mainnet in NEXT_PUBLIC_SOLANA_RPC_URL (and restart dev), or set NEXT_PUBLIC_OWL_MINT_ADDRESS to an SPL mint that exists on devnet.'
            : devnetRpc
              ? ' Your app RPC looks like devnet; this mint may be issued on mainnet only (or vice versa).'
              : ''
        setWalletTokenScan({
          status: 'done',
          uiAmount: null,
          rawAmount: null,
          decimals: null,
          mintAddress: tokenStakeMint,
          hint: `${tokenStakeSymbol} mint ${shortenAddress(tokenStakeMint, 6)} doesn't exist on this cluster. Check that NEXT_PUBLIC_SOLANA_RPC_URL and NEXT_PUBLIC_OWL_MINT_ADDRESS are on the same network (mainnet vs devnet).${extra}`,
        })
        return
      }
      const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_PROGRAM_ID)
      const ata = await getAssociatedTokenAddress(
        mint,
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      let raw = 0n
      try {
        const acc = await getAccount(connection, ata, 'confirmed', TOKEN_PROGRAM_ID)
        raw = acc.amount
      } catch {
        raw = 0n
      }
      const ui = Number(raw) / Math.pow(10, mintInfo.decimals)
      setWalletTokenScan({
        status: 'done',
        uiAmount: ui,
        rawAmount: raw,
        decimals: mintInfo.decimals,
        mintAddress: tokenStakeMint,
      })
    } catch (e) {
      const msg =
        e instanceof Error && e.message
          ? e.message
          : `Could not read your ${tokenStakeSymbol} balance from the network.`
      setWalletTokenScan({
        status: 'done',
        uiAmount: null,
        rawAmount: null,
        decimals: null,
        mintAddress: tokenStakeMint,
        hint: msg,
      })
    }
  }, [
    connection,
    connected,
    publicKey,
    tokenStakeRequired,
    tokenStakeMint,
    tokenStakeSymbol,
  ])

  /** After stake/unstake, refresh eligible NFTs (only if user already loaded for this perch). */
  useEffect(() => {
    const poolId = selectedPerch?.id
    if (!nftMintRequired || !poolId) return
    if (!connected || !publicKey || needsSignIn || loading || error !== null) return
    if (owlNestScanStatusRef.current !== 'done') return
    const loadedFor = owlNestLastLoadedPoolIdRef.current
    if (loadedFor !== poolId) return
    void loadOwlNestNftsRef.current()
    // Intentionally keyed on nested set + perch only — avoids re-scan when `loading` flips during unrelated dashboard refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [nestedActiveMintKey, nftMintRequired, selectedPerch?.id])

  const loadPerchTokenRef = useRef(loadPerchTokenFromWallet)
  loadPerchTokenRef.current = loadPerchTokenFromWallet

  /**
   * Auto-load the wallet's balance for token-type perches as soon as we know
   * which mint to read against — like a swap UI showing your balance up-front.
   * The useEffect above this clears `walletTokenScan` to `idle` whenever
   * `tokenStakeMint` changes, so this fires once per perch/mint switch.
   * Public on-chain read — intentionally does not gate on `needsSignIn`.
   */
  useEffect(() => {
    if (!connected || !publicKey) return
    if (!tokenStakeRequired || !tokenStakeMint) return
    if (walletTokenScan.status !== 'idle') return
    if (walletTokenScan.mintAddress === tokenStakeMint) return
    void loadPerchTokenRef.current()
  }, [
    connected,
    publicKey,
    tokenStakeRequired,
    tokenStakeMint,
    walletTokenScan.status,
    walletTokenScan.mintAddress,
  ])

  /** Auto-load Owltopia coins for NFT perches (needs SIWS) so the wallet nest bar can show X / Y. */
  useEffect(() => {
    if (!connected || !publicKey || needsSignIn || loading || error !== null) return
    if (!nftMintRequired || !selectedPerch?.id) return
    if (owlNestMintScan.status !== 'idle') return
    void loadOwlNestNftsRef.current()
  }, [
    connected,
    publicKey,
    needsSignIn,
    loading,
    error,
    nftMintRequired,
    selectedPerch?.id,
    owlNestMintScan.status,
  ])

  const selectedNftStakeAssetIds = useMemo(() => {
    if (!nftMintRequired) return []
    const ids = stakeAssetIds.map((id) => id.trim()).filter(Boolean)
    if (ids.length > 0) return Array.from(new Set(ids))
    const single = stakeAssetId.trim()
    return single ? [single] : []
  }, [nftMintRequired, stakeAssetId, stakeAssetIds])

  /** While nesting is globally paused, still allow Confirm nest when every selected NFT is mid-open (pending, freeze not confirmed). */
  /** Pending NFT nests that still need wallet lock or server freeze confirm. */
  const openingNestsNeedingWalletLock = useMemo(() => {
    return positions.filter((p) => {
      if (p.status !== 'pending' || !p.asset_identifier?.trim()) return false
      const pool = poolById.get(p.pool_id)
      return (
        pool?.asset_type === 'nft' &&
        pool.adapter_mode === 'onchain_enabled' &&
        isOpeningNftNestAbortable(p, pool)
      )
    })
  }, [positions, poolById])

  const openNestFormNeedsAttention = useMemo(() => {
    if (openingNestsNeedingWalletLock.length > 0) return true
    if (stakeTxPhase !== 'idle') return true
    if (openPositions.length === 0) return true
    return false
  }, [openingNestsNeedingWalletLock.length, stakeTxPhase, openPositions.length])

  const [openNestFormExpanded, setOpenNestFormExpanded] = useState(() => true)

  useEffect(() => {
    if (openNestFormNeedsAttention) setOpenNestFormExpanded(true)
  }, [openNestFormNeedsAttention])

  const openNestFormDescription = solePerch
    ? 'Everyone uses the same Owl Nest perch: 365-day lock, 1 OWL per day per NFT. Connect your wallet and pick one or more Owl Nest NFTs; each one is frozen in your wallet while it earns.'
    : lockedPerch
      ? 'This perch is tied to your nest—load what you are tucking in below, then confirm. Rates and lock stay on this perch only.'
      : `Token perches use an amount up top; Owl Nest NFT perches use the checklist below (tap Select all for up to ${NESTING_NFT_STAKE_MAX_PER_RUN} per confirm). Pick a perch from the list—each one keeps its own nests separate.`

  const openNestFormCollapsedSummary = useMemo(() => {
    const parts: string[] = []
    if (openingNestsNeedingWalletLock.length > 0) {
      parts.push(
        openingNestsNeedingWalletLock.length === 1
          ? '1 nest needs wallet lock'
          : `${openingNestsNeedingWalletLock.length} nests need wallet lock`
      )
    }
    if (stakeTxPhase !== 'idle') {
      parts.push(nestingTxPhaseLabel(stakeTxPhase))
    }
    if (selectedNftStakeAssetIds.length > 0) {
      parts.push(
        `${selectedNftStakeAssetIds.length} coin${selectedNftStakeAssetIds.length === 1 ? '' : 's'} selected`
      )
    } else if (stakeAmount.trim()) {
      parts.push(`${stakeAmount.trim()} ready to nest`)
    }
    if (parts.length > 0) return parts.join(' · ')
    return 'Tap to tuck in tokens or Owltopia coins'
  }, [
    openingNestsNeedingWalletLock.length,
    stakeTxPhase,
    selectedNftStakeAssetIds.length,
    stakeAmount,
  ])

  const resumeOpeningNest = useCallback(
    (position: StakingPositionRow) => {
      const mint = position.asset_identifier?.trim()
      if (!mint) return
      setStakeAssetId(mint)
      setStakeAssetIds([mint])
      setActionError(null)
      setOpenNestFormExpanded(true)
      if (typeof document !== 'undefined') {
        document.getElementById('nesting-open-nest-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    },
    []
  )

  const canOnlyResumeFreeze = useMemo(() => {
    const pid = selectedPerch?.id?.trim() ?? ''
    if (!nestingDisabled || !pid) return false
    const pool = poolById.get(pid)
    if (!pool || pool.asset_type !== 'nft' || pool.adapter_mode !== 'onchain_enabled') return false
    if (selectedNftStakeAssetIds.length === 0) return false
    return selectedNftStakeAssetIds.every((assetId) => {
      const id = assetId.trim()
      if (!id) return false
      return positions.some(
        (p) =>
          p.pool_id === pid &&
          p.asset_identifier?.trim() === id &&
          p.status === 'pending' &&
          !(p.external_reference ?? '').startsWith('nft_freeze_confirmed:')
      )
    })
  }, [nestingDisabled, selectedPerch?.id, poolById, selectedNftStakeAssetIds, positions])

  const confirmNestDisabledReason = useMemo(() => {
    if (stakeTxPhase !== 'idle') return null
    if (!selectedPerch) return 'Choose a perch first.'
    if (!securityAck) return 'Sign the nesting safeguards with your wallet above before confirming.'
    if (nestingDisabled && !canOnlyResumeFreeze) {
      return 'Nesting is paused — you can only finish nests that are already opening.'
    }
    if (nftMintRequired && selectedNftStakeAssetIds.length === 0) {
      return 'Select at least one Owltopia coin from the list.'
    }
    if (nftMintRequired && selectedNftStakeAssetIds.length > NESTING_NFT_STAKE_MAX_PER_RUN) {
      return `You can confirm up to ${NESTING_NFT_STAKE_MAX_PER_RUN} coins at a time (${selectedNftStakeAssetIds.length} selected).`
    }
    return null
  }, [
    stakeTxPhase,
    selectedPerch,
    securityAck,
    nestingDisabled,
    canOnlyResumeFreeze,
    nftMintRequired,
    selectedNftStakeAssetIds.length,
  ])

  const nestableOwlMintIds = useMemo(() => {
    const pool = selectedPerch?.asset_type === 'nft' ? selectedPerch : null
    if (!pool || owlNestMintScan.status !== 'done') return []
    return owlNestMintScan.mints
      .filter((row) => !nftMintBlocksDuplicateStakeExceptResume(row.mint, pool, positions))
      .map((m) => m.mint)
  }, [selectedPerch, owlNestMintScan.status, owlNestMintScan.mints, positions])

  const selectAllNestableOwlMints = useCallback(() => {
    const capped = capNftStakeAssetIds(nestableOwlMintIds)
    setStakeAssetIds(capped)
    setStakeAssetId(capped[0] ?? '')
    setActionError(null)
    setOpenNestFormExpanded(true)
  }, [nestableOwlMintIds])

  const openingNestMintIds = useMemo(
    () =>
      openingNestsNeedingWalletLock
        .map((p) => p.asset_identifier?.trim())
        .filter((m): m is string => Boolean(m)),
    [openingNestsNeedingWalletLock]
  )

  const selectOpeningNestsUpToMax = useCallback(() => {
    const capped = capNftStakeAssetIds(openingNestMintIds)
    if (capped.length === 0) return
    setStakeAssetIds(capped)
    setStakeAssetId(capped[0] ?? '')
    setActionError(null)
    setOpenNestFormExpanded(true)
    document.getElementById('nesting-open-nest-form')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }, [openingNestMintIds])

  const toggleSelectedOwlNestMint = useCallback(
    (mint: string) => {
      const pool = selectedPerch
      if (
        pool?.asset_type === 'nft' &&
        nftMintBlocksDuplicateStakeExceptResume(mint, pool, positions)
      ) {
        return
      }
      const exists = stakeAssetIds.includes(mint)
      if (!exists && stakeAssetIds.length >= NESTING_NFT_STAKE_MAX_PER_RUN) {
        setActionError(
          `Up to ${NESTING_NFT_STAKE_MAX_PER_RUN} coins per confirm — finish this batch in your wallet, then select more.`
        )
        return
      }
      setActionError(null)
      const next = exists ? stakeAssetIds.filter((id) => id !== mint) : [...stakeAssetIds, mint]
      setStakeAssetIds(next)
      setStakeAssetId(next[0] ?? '')
    },
    [stakeAssetIds, positions, selectedPerch]
  )

  useEffect(() => {
    setStakeAssetId(stakeAssetIds[0] ?? '')
  }, [stakeAssetIds])

  useEffect(() => {
    if (owlNestMintScan.status !== 'done') return
    if (!owlNestMintScan.configured) return
    const pool = selectedPerch?.asset_type === 'nft' ? selectedPerch : null
    if (owlNestMintScan.mints.length === 1) {
      const m0 = owlNestMintScan.mints[0].mint.trim()
      if (
        pool &&
        m0 &&
        nftMintBlocksDuplicateStakeExceptResume(m0, pool, positions)
      ) {
        setStakeAssetId('')
        setStakeAssetIds([])
      } else {
        setStakeAssetId(owlNestMintScan.mints[0].mint)
        setStakeAssetIds([owlNestMintScan.mints[0].mint])
      }
    } else if (owlNestMintScan.mints.length === 0) {
      setStakeAssetId('')
      setStakeAssetIds([])
    } else {
      const validMints = new Set(owlNestMintScan.mints.map((m) => m.mint))
      setStakeAssetIds((prev) =>
        prev.filter((id) => {
          const idtrim = id.trim()
          if (!validMints.has(id)) return false
          if (
            pool?.asset_type === 'nft' &&
            idtrim &&
            nftMintBlocksDuplicateStakeExceptResume(idtrim, pool, positions)
          ) {
            return false
          }
          return true
        })
      )
    }
    // Intentionally keyed on the stable mint key, not the array instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- owlNestEligibleMintsKey captures owlNestMintScan.mints
  }, [
    owlNestMintScan.status,
    owlNestMintScan.configured,
    owlNestEligibleMintsKey,
    selectedPerch,
    positions,
  ])

  const totals = useMemo(() => {
    let nested = 0
    let claimed = 0
    for (const pos of positions) {
      if (pos.status === 'active' || pos.status === 'pending') {
        nested += Number(pos.amount)
      }
      claimed += Number(pos.claimed_rewards)
    }
    const activeRows = positions.filter((p) => p.status === 'active')
    const est = buildOwlClaimAllPreview(activeRows, rewardsNowMs).totalOwl
    const accruingOwl = sumOwlPendingAccrualForPositions(activeRows, rewardsNowMs)
    const activeCount = activeRows.length
    return { nested, est, accruingOwl, claimed, activeCount }
  }, [positions, rewardsNowMs])

  const readyToClaimSubline = useMemo((): string | null => {
    const { est, accruingOwl } = totals
    if (accruingOwl <= 1e-12) return null
    if (est >= 1 - 1e-9) {
      if (accruingOwl > est + 1e-6) {
        return `${est.toLocaleString(undefined, { maximumFractionDigits: 6 })} OWL claimable now`
      }
      return null
    }
    return 'Updates live · Claim all from 1 OWL combined across nests'
  }, [totals])

  const pendingOpenCount = useMemo(
    () => openPositions.filter((p) => p.status === 'pending').length,
    [openPositions]
  )
  const activeOwlNestCount = useMemo(
    () => positions.filter((p) => p.status === 'active' && isOwlRewardPosition(p)).length,
    [positions]
  )
  const nestsPendingOnly = pendingOpenCount > 0 && totals.activeCount === 0

  const handleSignIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setSignInError('Your wallet does not support message signing.')
      return
    }
    setSignInError(null)
    setSigningIn(true)
    try {
      const addr = publicKey.toBase58()
      const nonceRes = await fetch(nestingClientApiUrl(`/api/auth/nonce?wallet=${encodeURIComponent(addr)}`), {
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

      const verifyRes = await fetch(nestingClientApiUrl('/api/auth/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: addr,
          message,
          signature: signatureBase64,
        }),
      })

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error((data as { error?: string })?.error || 'Sign-in verification failed')
      }

      await refreshAll()
    } catch (e) {
      setSignInError(formatNestingApiFetchError(e, 'generic'))
    } finally {
      setSigningIn(false)
    }
  }, [publicKey, signMessage, refreshAll])

  const sendOnChainTokenStakeTransfer = useCallback(
    async (pool: StakingPoolRow, amountUi: string): Promise<string> => {
      if (!publicKey || !sendTransaction) {
        throw new Error('Connect your wallet first.')
      }

      const owl = getTokenInfo('OWL')
      const mintAddress = pool.stake_mint?.trim() || pool.token_mint?.trim() || owl.mintAddress
      const vaultAddress = pool.vault_address?.trim()
      if (!mintAddress || !owl.mintAddress || mintAddress !== owl.mintAddress) {
        throw new Error('This on-chain perch must use the configured OWL mint.')
      }
      if (!vaultAddress) {
        throw new Error('This on-chain perch is missing a vault address.')
      }

      const amountRaw = decimalToRawBigint(amountUi, owl.decimals)
      if (amountRaw <= 0n) throw new Error('Enter a positive amount.')

      const mint = new PublicKey(mintAddress)
      const vaultOwner = new PublicKey(vaultAddress)
      const senderAta = await getAssociatedTokenAddress(
        mint,
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const recipientAta = await getAssociatedTokenAddress(
        mint,
        vaultOwner,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: publicKey })
      try {
        await getAccount(connection, recipientAta, 'confirmed', TOKEN_PROGRAM_ID)
      } catch {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            recipientAta,
            vaultOwner,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        )
      }
      transaction.add(createTransferInstruction(senderAta, recipientAta, publicKey, amountRaw, [], TOKEN_PROGRAM_ID))

      const signature = await sendTransaction(transaction, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      })
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
      return signature
    },
    [connection, publicKey, sendTransaction]
  )

  const sendStakingPlatformFee = useCallback(
    async (units: number): Promise<string> => {
      if (!publicKey || !sendTransaction) {
        throw new Error('Connect your wallet first.')
      }
      return sendStakingPlatformFeeTransaction({
        connection,
        sendTransaction,
        publicKey,
        units,
        feeConfig: platformFeeTxConfig,
      })
    },
    [connection, publicKey, sendTransaction, platformFeeTxConfig]
  )

  const sendMplCoreFreezeDelegateApproval = useCallback(
    async (
      assetId: string,
      delegateAddress: string,
      platformFee?: { treasury: string; lamports: number } | null
    ): Promise<string | null> => {
      const adapter = wallet?.adapter
      if (!adapter || !publicKey) {
        throw new Error('Connect your wallet first.')
      }
      return addMplCoreFreezeDelegate({
        connection,
        wallet: adapter,
        assetId,
        delegateAddress,
        platformFee,
      })
    },
    [connection, publicKey, wallet]
  )

  const sendBatchMplCoreFreezeDelegateApproval = useCallback(
    async (
      assetIds: string[],
      delegateAddress: string,
      platformFee?: { treasury: string; lamports: number } | null
    ): Promise<string | null> => {
      const adapter = wallet?.adapter
      if (!adapter || !publicKey) {
        throw new Error('Connect your wallet first.')
      }
      return batchRelockMplCoreNestAssetsInWallet({
        connection,
        wallet: adapter,
        assetIds,
        delegateAddress,
        platformFee,
      })
    },
    [connection, publicKey, wallet]
  )

  const chunkNestPlatformFee = useCallback(
    (nestCount: number): { treasury: string; lamports: number } | null => {
      if (!platformFeeActive || !platformFeeTxConfig || nestCount <= 0) return null
      return {
        treasury: platformFeeTxConfig.treasury,
        lamports: nestCount * platformFeeTxConfig.unitLamports,
      }
    },
    [platformFeeActive, platformFeeTxConfig]
  )

  const cancelOpeningNest = useCallback(() => {
    stakeTxAbortRef.current?.abort()
  }, [])

  const handleStake = async () => {
    if (!publicKey) return
    setActionError(null)
    setSuccessNotice(null)
    const pool = selectedPerch
    if (!pool) {
      setActionError('Choose a perch first.')
      return
    }
    const pool_id = pool.id
    const amountNum = Number(stakeAmount)
    const nftAssetIds = pool.asset_type === 'nft' ? selectedNftStakeAssetIds : []
    if (pool.asset_type === 'token') {
      if (Number.isNaN(amountNum) || amountNum <= 0) {
        setActionError('Enter a positive amount.')
        return
      }
    } else if (nftAssetIds.length === 0) {
      setActionError('Choose at least one Owltopia coin from the list.')
      return
    } else if (nftAssetIds.length > NESTING_NFT_STAKE_MAX_PER_RUN) {
      setActionError(
        `Choose up to ${NESTING_NFT_STAKE_MAX_PER_RUN} coins per confirm (${nftAssetIds.length} selected). Tap Select all or deselect extras.`
      )
      return
    }

    stakeTxAbortRef.current?.abort()
    const stakeFlowAbort = new AbortController()
    const signal = stakeFlowAbort.signal
    stakeTxAbortRef.current = stakeFlowAbort

    try {
      const result = await runNestingTxAction({
        signal,
        onPhase: setStakeTxPhase,
        async execute() {
          const stakeOne = async (
            assetId?: string,
            options?: { deferPlatformFee?: boolean }
          ) => {
            let platformFeeSig: string | null = null
            if (
              !options?.deferPlatformFee &&
              pool.adapter_mode !== 'onchain_enabled' &&
              platformFeeActive
            ) {
              setStakeTxPhase('awaiting_wallet_signature')
              platformFeeSig = await sendStakingPlatformFee(1)
            }

            const body: Record<string, unknown> = {
              pool_id,
              amount: pool.asset_type === 'token' ? amountNum : 1,
            }
            if (assetId) body.asset_identifier = assetId
            if (viewerIsAdmin === true && adminBypassSellout) {
              body.bypass_nesting_sellout_gate = true
            }
            if (platformFeeSig) body.platform_fee_signature = platformFeeSig

            throwIfNestingAborted(signal)
            const res = await fetch(nestingClientApiUrl('/api/me/staking/stake'), {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                'X-Connected-Wallet': publicKey.toBase58(),
              },
              body: JSON.stringify(body),
              signal,
            })
            const json = (await res.json().catch(() => ({}))) as {
              error?: string
              position?: StakingPositionRow
              execution?: { path?: string; freeze_delegate?: string | null }
            }
            if (!res.ok) {
              const err =
                res.status === 501
                  ? typeof json.error === 'string'
                    ? json.error
                    : 'This perch is not taking nests yet—try another perch or check back soon.'
                  : typeof json.error === 'string'
                    ? json.error
                    : 'Stake failed'
              throw new NestingStakeFlowError(err)
            }
            if (
              pool.asset_type === 'token' &&
              json.execution?.path === 'onchain_token_transfer_required'
            ) {
              const positionId = json.position?.id
              if (!positionId) {
                throw new NestingStakeFlowError('Stake was prepared, but the position id was missing.')
              }
              setStakeTxPhase('awaiting_wallet_signature')
              const signature = await sendOnChainTokenStakeTransfer(pool, stakeAmount)
              throwIfNestingAborted(signal)
              let platformFeeSig: string | null = null
              if (platformFeeActive) {
                setStakeTxPhase('awaiting_wallet_signature')
                platformFeeSig = await sendStakingPlatformFee(1)
              }
              setStakeTxPhase('syncing')
              const syncRes = await fetch(nestingClientApiUrl('/api/me/staking/sync'), {
                method: 'POST',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Connected-Wallet': publicKey.toBase58(),
                },
                body: JSON.stringify({
                  position_id: positionId,
                  signature,
                  kind: 'stake',
                  ...(platformFeeSig ? { platform_fee_signature: platformFeeSig } : {}),
                }),
                signal,
              })
              const syncJson = (await syncRes.json().catch(() => ({}))) as { error?: string }
              if (!syncRes.ok) {
                throw new NestingStakeFlowError(
                  typeof syncJson.error === 'string' ? syncJson.error : 'Could not confirm stake on-chain'
                )
              }
            }
            return json
          }

          type PreparedNftNest = {
            positionId: string
            assetId: string
            delegateAddress: string
            stakeSignature: string | null
            needsWalletFreeze: boolean
          }

          const confirmNftNestFreezeForPrep = async (
            prep: PreparedNftNest,
            freezeSignature?: string | null,
            platformFeeSignature?: string | null
          ) => {
            throwIfNestingAborted(signal)
            setStakeTxPhase('syncing')
            const freezeRes = await fetch(nestingClientApiUrl('/api/me/staking/freeze'), {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                'X-Connected-Wallet': publicKey.toBase58(),
              },
              body: JSON.stringify({
                position_id: prep.positionId,
                ...(freezeSignature?.trim() ? { signature: freezeSignature.trim() } : {}),
                ...(platformFeeSignature?.trim()
                  ? { platform_fee_signature: platformFeeSignature.trim() }
                  : {}),
              }),
              signal,
            })
            const freezeJson = (await freezeRes.json().catch(() => ({}))) as { error?: string }
            if (!freezeRes.ok) {
              throw new NestingStakeFlowError(
                typeof freezeJson.error === 'string' ? freezeJson.error : 'Could not confirm NFT freeze'
              )
            }
          }

          const prepareNftNest = async (assetId: string): Promise<PreparedNftNest> => {
            const json = await stakeOne(assetId, { deferPlatformFee: true })
            const positionId = json.position?.id
            const positionAssetId = json.position?.asset_identifier?.trim() || assetId.trim()
            if (!positionId || !positionAssetId) {
              throw new NestingStakeFlowError('Stake was prepared, but the NFT position was missing.')
            }
            const needsWalletFreeze = json.execution?.path === 'onchain_nft_freeze_required'
            const delegateAddress = json.execution?.freeze_delegate?.trim() || ''
            if (needsWalletFreeze && !delegateAddress) {
              throw new NestingStakeFlowError('Freeze delegate is not configured for this perch.')
            }
            return {
              positionId,
              assetId: positionAssetId,
              delegateAddress,
              stakeSignature: json.position?.stake_signature ?? null,
              needsWalletFreeze,
            }
          }

          const completeNftNestWithWalletSig = async (
            prep: PreparedNftNest,
            walletSig: string | null,
            platformFeeSignature?: string | null
          ) => {
            if (!prep.needsWalletFreeze) return
            await confirmNftNestFreezeForPrep(prep, walletSig ?? prep.stakeSignature, platformFeeSignature)
          }

          const freezeNftChunkInWallet = async (
            preps: PreparedNftNest[],
            delegateAddress: string,
            platformFee?: { treasury: string; lamports: number } | null
          ): Promise<{ signature: string | null; confirmedInFallback: boolean }> => {
            const assetIds = preps.map((p) => p.assetId)
            const perNestFeeLamports =
              platformFee && preps.length > 0 ? Math.floor(platformFee.lamports / preps.length) : 0
            try {
              const signature = await sendBatchMplCoreFreezeDelegateApproval(
                assetIds,
                delegateAddress,
                platformFee
              )
              return { signature, confirmedInFallback: false }
            } catch {
              let lastSig: string | null = null
              for (let i = 0; i < preps.length; i++) {
                const prep = preps[i]!
                throwIfNestingAborted(signal)
                if (preps.length > 1) {
                  setNftStakeBatchHint(
                    `Batch tx failed — locking ${shortenAddress(prep.assetId, 6)} individually (${i + 1} of ${preps.length})…`
                  )
                }
                setStakeTxPhase('awaiting_wallet_signature')
                const prepFee =
                  perNestFeeLamports > 0 && platformFee
                    ? { treasury: platformFee.treasury, lamports: perNestFeeLamports }
                    : null
                lastSig = await sendMplCoreFreezeDelegateApproval(
                  prep.assetId,
                  delegateAddress,
                  prepFee
                )
                setStakeTxPhase('syncing')
                await completeNftNestWithWalletSig(prep, lastSig, lastSig)
              }
              return { signature: lastSig, confirmedInFallback: true }
            }
          }

          const runNftBatchStake = async (assetIds: string[]) => {
            const totalNests = assetIds.length
            const prepared: PreparedNftNest[] = []

            setStakeTxPhase('preparing')
            for (let idx = 0; idx < assetIds.length; idx++) {
              const assetId = assetIds[idx]!
              throwIfNestingAborted(signal)
              if (totalNests > 1) {
                setNftStakeBatchHint(`Setting up nest ${idx + 1} of ${totalNests}…`)
              }
              try {
                prepared.push(await prepareNftNest(assetId))
              } catch (e) {
                if (e instanceof DOMException && e.name === 'AbortError') throw e
                if (e instanceof Error && e.name === 'AbortError') throw e
                const detail = isNestingStakeFlowError(e)
                  ? e.userMessage
                  : e instanceof Error
                    ? e.message
                    : 'Something went wrong while nesting.'
                const prefix =
                  prepared.length > 0
                    ? `Prepared ${prepared.length} of ${totalNests} before stopping — `
                    : ''
                setActionError(`${prefix}${detail}`)
                void loadPositions({ heal: true, silent: true })
                throw new Error('stake')
              }
            }

            const freezePreps = prepared.filter((p) => p.needsWalletFreeze)
            let completed = prepared.length - freezePreps.length

            if (freezePreps.length === 0) {
              return { nestedCount: completed }
            }

            const delegateAddress = freezePreps[0]!.delegateAddress
            const assetIdChunks = chunkNftFreezeAssetIds(freezePreps.map((p) => p.assetId))
            const prepByAssetId = new Map(freezePreps.map((p) => [p.assetId, p]))
            const walletApprovals =
              assetIdChunks.length === 1 && assetIdChunks[0]!.length === freezePreps.length
                ? 1
                : assetIdChunks.length

            for (let chunkIdx = 0; chunkIdx < assetIdChunks.length; chunkIdx++) {
              const chunkAssetIds = assetIdChunks[chunkIdx]!
              const chunkPreps = chunkAssetIds
                .map((id) => prepByAssetId.get(id))
                .filter((p): p is PreparedNftNest => Boolean(p))
              throwIfNestingAborted(signal)

              const chunkFeeLabel = formatStakingPlatformFeeTotalLabel(chunkPreps.length)
              setStakeTxPhase('awaiting_wallet_signature')
              if (totalNests > 1) {
                setNftStakeBatchHint(
                  walletApprovals > 1
                    ? `Approve nest batch ${chunkIdx + 1} of ${walletApprovals} in your wallet (${chunkPreps.length} coins${platformFeeActive ? `, ${chunkFeeLabel} included` : ''})…`
                    : `Approve in your wallet to confirm ${chunkPreps.length} nest${chunkPreps.length === 1 ? '' : 's'}${platformFeeActive ? ` (${chunkFeeLabel} included)` : ''}…`
                )
              } else if (platformFeeActive && chunkFeeLabel) {
                setNftStakeBatchHint(`Approve in your wallet to confirm your nest (${chunkFeeLabel} included)…`)
              }

              const platformFee = chunkNestPlatformFee(chunkPreps.length)
              const { signature: walletSig, confirmedInFallback } = await freezeNftChunkInWallet(
                chunkPreps,
                delegateAddress,
                platformFee
              )
              const feeSig = platformFee && walletSig ? walletSig : null

              if (!confirmedInFallback) {
                setStakeTxPhase('syncing')
                for (const prep of chunkPreps) {
                  throwIfNestingAborted(signal)
                  await completeNftNestWithWalletSig(prep, walletSig, feeSig)
                }
              }
              completed += chunkPreps.length
            }

            return { nestedCount: completed }
          }

          if (pool.asset_type === 'nft') {
            return await runNftBatchStake(nftAssetIds)
          }

          await stakeOne()
          return { nestedCount: 1 }
        },
        afterSuccess: async () => {
          setStakeAmount('')
          setStakeAssetId('')
          setStakeAssetIds([])
          await loadPositions()
          await loadPools()
        },
      })
      const nestedCount = result.nestedCount
      setSuccessNotice({
        placement: 'modal',
        title:
          pool.asset_type === 'nft'
            ? nestedCount === 1
              ? 'Nest opened successfully'
              : 'Nests opened successfully'
            : 'Nest opened successfully',
        message:
          pool.asset_type === 'nft'
            ? nestedCount === 1
              ? 'Your Owltopia coin is nested and the wallet lock is confirmed.'
              : `${nestedCount} Owltopia coins are nested and wallet locks are confirmed.`
            : 'Your stake is confirmed for this perch.',
        hint:
          pool.asset_type === 'nft'
            ? nestedCount === 1
              ? 'Your coin stays in your wallet while rewards accrue. Claim OWL anytime in Your nests below.'
              : 'Your coins stay in your wallet while rewards accrue. Claim OWL anytime in Your nests below.'
            : 'OWL rewards accrue on this perch. Claim anytime in Your nests below.',
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setActionError(null)
        setNftStakeBatchHint(null)
        void loadPositions()
        return
      }
      if (isNestingStakeFlowError(e)) {
        setActionError(e.userMessage)
        return
      }
      if (e instanceof Error && e.message === 'stake') return
      setActionError(formatNestingApiFetchError(e, 'generic'))
    } finally {
      setNftStakeBatchHint(null)
      if (stakeTxAbortRef.current === stakeFlowAbort) {
        stakeTxAbortRef.current = null
      }
    }
  }

  const handleUnstake = async (positionId: string) => {
    if (!publicKey) return
    setActionError(null)
    try {
      await runNestingTxAction({
        onPhase: (p) => setPosSubPhase(positionId, 'unstake', p),
        async execute() {
          let platformFeeSig: string | null = null
          if (platformFeeActive) {
            setPosSubPhase(positionId, 'unstake', 'awaiting_wallet_signature')
            platformFeeSig = await sendStakingPlatformFee(1)
          }
          const res = await fetch(nestingClientApiUrl('/api/me/staking/unstake'), {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-Connected-Wallet': publicKey.toBase58(),
            },
            body: JSON.stringify({
              position_id: positionId,
              ...(platformFeeSig ? { platform_fee_signature: platformFeeSig } : {}),
            }),
          })
          const json = (await res.json().catch(() => ({}))) as { error?: string }
          if (!res.ok) {
            const err =
              res.status === 501
                ? typeof json.error === 'string'
                  ? json.error
                  : 'This perch is not open yet.'
                : typeof json.error === 'string'
                  ? json.error
                  : 'Unstake failed'
            setActionError(err)
            throw new Error('unstake')
          }
        },
        afterSuccess: async () => {
          await loadPositions()
        },
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'unstake') throw e
      setActionError(formatNestingApiFetchError(e, 'generic'))
    }
  }

  const handleClaim = async (positionId: string, amount: number) => {
    if (!publicKey) return
    setActionError(null)
    setSuccessNotice(null)
    setClaimLedgerNotice(null)
    let claimedRewardsTotal: number | undefined
    try {
      const claimJson = await runNestingTxAction({
        skipPreparing: true,
        onPhase: (p) => setPosSubPhase(positionId, 'claim', p),
        async execute() {
          let platformFeeSig: string | null = null
          if (platformFeeActive) {
            setPosSubPhase(positionId, 'claim', 'awaiting_wallet_signature')
            platformFeeSig = await sendStakingPlatformFee(1)
          }
          const result = await fetchNestingJson<{
            error?: string
            claimed?: number
            claimed_rewards_total?: number
            transaction_signature?: string | null
            execution?: { path?: 'onchain_transfer' | 'database_only' }
          }>('/api/me/staking/claim', {
            method: 'POST',
            credentials: 'include',
            timeoutMs: NESTING_CLAIM_FETCH_TIMEOUT_MS,
            headers: {
              'Content-Type': 'application/json',
              'X-Connected-Wallet': publicKey.toBase58(),
            },
            body: JSON.stringify({
              position_id: positionId,
              amount,
              ...(platformFeeSig ? { platform_fee_signature: platformFeeSig } : {}),
            }),
          })
          if (result.status === 0 && !result.ok) {
            setActionError(
              result.clientTimeout
                ? nestingFetchTimeoutMessage('claim')
                : nestingFetchNetworkErrorMessage('claim')
            )
            throw new Error('claim')
          }
          const json = result.json ?? {}
          if (!result.ok) {
            const err =
              result.status === 501
                ? typeof json.error === 'string'
                  ? json.error
                  : 'This perch is not open yet.'
                : typeof json.error === 'string'
                  ? json.error
                  : 'Claim failed'
            setActionError(err)
            throw new Error('claim')
          }
          if (typeof json.claimed_rewards_total === 'number' && Number.isFinite(json.claimed_rewards_total)) {
            claimedRewardsTotal = json.claimed_rewards_total
          }
          return json
        },
        afterSuccess: async () => {
          if (typeof claimedRewardsTotal === 'number') {
            setPositions((prev) =>
              prev.map((p) =>
                p.id === positionId ? { ...p, claimed_rewards: claimedRewardsTotal! } : p
              )
            )
          }
          setRewardsNowMs(Date.now())
          void loadClaimLedger()
        },
      })

      const claimedAmount =
        typeof claimJson.claimed === 'number' && Number.isFinite(claimJson.claimed)
          ? claimJson.claimed
          : amount
      const claimedLabel = claimedAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })
      setSuccessNotice({
        placement: 'modal',
        title: 'Claim successful',
        message:
          claimJson.execution?.path === 'database_only'
            ? `${claimedLabel} OWL recorded for this nest.`
            : `${claimedLabel} OWL sent to your wallet.`,
        hint:
          claimJson.execution?.path === 'database_only'
            ? 'Your nest balance is updated. New rewards will accrue as usual.'
            : 'Check your wallet balance — the transfer may take a few seconds on mobile.',
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'claim') throw e
      setActionError(formatNestingApiFetchError(e, 'claim'))
    }
  }

  const syncClaimLedgerAfterPayout = useCallback(
    async (pending: PendingClaimLedgerSync): Promise<boolean> => {
      if (!publicKey) return false
      const res = await fetch(nestingClientApiUrl('/api/me/staking/claim-ledger-sync'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Connected-Wallet': publicKey.toBase58(),
        },
        body: JSON.stringify({
          transaction_signature: pending.transaction_signature,
          claims: pending.claims,
        }),
      })
      if (res.ok) {
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem(PENDING_CLAIM_LEDGER_STORAGE_KEY)
        }
        return true
      }
      return false
    },
    [publicKey]
  )

  const catchUpClaimLedgerAfterPayout = useCallback(async (): Promise<boolean> => {
    if (!publicKey) return false
    const res = await fetch(nestingClientApiUrl('/api/me/staking/claim-ledger-catchup'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Connected-Wallet': publicKey.toBase58(),
      },
      body: JSON.stringify({ confirm_owl_received: true }),
    })
    if (!res.ok) return false
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(PENDING_CLAIM_LEDGER_STORAGE_KEY)
    }
    return true
  }, [publicKey])

  const applyClaimLedgerToPositions = useCallback(
    (claims: Array<{ position_id: string; claimed_rewards_total: number }>) => {
      const byId = new Map(claims.map((c) => [c.position_id, c.claimed_rewards_total]))
      setPositions((prev) =>
        prev.map((p) => {
          const nextTotal = byId.get(p.id)
          return nextTotal != null ? { ...p, claimed_rewards: nextTotal } : p
        })
      )
    },
    []
  )

  useEffect(() => {
    if (!connected || !publicKey || typeof window === 'undefined') return
    const raw = sessionStorage.getItem(PENDING_CLAIM_LEDGER_STORAGE_KEY)
    if (!raw) return

    let pending: PendingClaimLedgerSync
    try {
      pending = JSON.parse(raw) as PendingClaimLedgerSync
    } catch {
      sessionStorage.removeItem(PENDING_CLAIM_LEDGER_STORAGE_KEY)
      return
    }
    if (!pending.transaction_signature?.trim() || !Array.isArray(pending.claims) || pending.claims.length === 0) {
      return
    }

    let cancelled = false
    void (async () => {
      setClaimAllTxPhase('syncing')
      let synced = await syncClaimLedgerAfterPayout(pending)
      if (!synced) {
        synced = await catchUpClaimLedgerAfterPayout()
      }
      if (cancelled) return
      setClaimAllTxPhase('idle')
      if (!synced) return

      applyClaimLedgerToPositions(
        pending.claims.map((c) => ({
          position_id: c.position_id,
          claimed_rewards_total: c.claimed_rewards_total,
        }))
      )
      setRewardsNowMs(Date.now())
      await loadPositions()
      await loadClaimLedger()
      const totalLabel = pending.total_claimed.toLocaleString(undefined, { maximumFractionDigits: 6 })
      setSuccessNotice({
        placement: 'modal',
        title: 'Claim successful',
        message: `Nest records updated — your ${totalLabel} OWL claim is recorded.`,
        hint: 'Your dashboard now matches the payout already in your wallet.',
      })
    })()

    return () => {
      cancelled = true
    }
  }, [
    connected,
    publicKey,
    syncClaimLedgerAfterPayout,
    catchUpClaimLedgerAfterPayout,
    applyClaimLedgerToPositions,
    loadPositions,
    loadClaimLedger,
  ])

  const handleHealClaimLedger = async () => {
    if (!publicKey) return
    setClaimLedgerHealBusy(true)
    setActionError(null)
    setClaimLedgerNotice(null)
    try {
      setClaimAllTxPhase('syncing')
      const ok = await catchUpClaimLedgerAfterPayout()
      setClaimAllTxPhase('idle')
      if (!ok) {
        setActionError(
          'Could not update nest records yet. Refresh the page and try again, or contact support with your wallet address.'
        )
        return
      }
      setRewardsNowMs(Date.now())
      await loadPositions()
      await loadClaimLedger()
      setSuccessNotice({
        placement: 'modal',
        title: 'Claim successful',
        message:
          'Nest records updated — your dashboard now matches the OWL already in your wallet.',
        hint: 'You can claim new rewards as they accrue.',
      })
    } finally {
      setClaimLedgerHealBusy(false)
    }
  }

  const showClaimLedgerHeal =
    claimAllReady &&
    (Boolean(
      actionError?.includes('OWL was sent') ||
        actionError?.includes('nest totals are still syncing') ||
        actionError?.includes('nest records did not finish')
    ) ||
      Boolean(claimLedgerNotice))

  const handleClaimAll = async () => {
    if (!publicKey || !claimAllReady) return
    setActionError(null)
    setSuccessNotice(null)
    setClaimLedgerNotice(null)
    const claimPlans = claimAllPreview.plans
    const ledgerClaims: Array<{ position_id: string; claimed_rewards_total: number }> = []
    try {
      const claimJson = await runNestingTxAction({
        skipPreparing: true,
        onPhase: setClaimAllTxPhase,
        async execute() {
          let platformFeeSig: string | null = null
          if (platformFeeActive) {
            setClaimAllTxPhase('awaiting_wallet_signature')
            platformFeeSig = await sendStakingPlatformFee(claimPlans.length)
          }
          const result = await fetchNestingJson<{
            error?: string
            ledger_sync_failed?: boolean
            total_claimed?: number
            claim_count?: number
            claims?: Array<{
              position_id: string
              claimed?: number
              claimed_rewards_total: number
            }>
            execution?: { path?: 'onchain_transfer' | 'database_only' }
            transaction_signature?: string | null
          }>('/api/me/staking/claim-all', {
            method: 'POST',
            credentials: 'include',
            timeoutMs: NESTING_CLAIM_FETCH_TIMEOUT_MS,
            headers: {
              'Content-Type': 'application/json',
              'X-Connected-Wallet': publicKey.toBase58(),
            },
            body: JSON.stringify(
              platformFeeSig ? { platform_fee_signature: platformFeeSig } : {}
            ),
          })
          if (result.status === 0 && !result.ok) {
            setActionError(
              result.clientTimeout
                ? nestingFetchTimeoutMessage('claim')
                : nestingFetchNetworkErrorMessage('claim')
            )
            throw new Error('claim-all')
          }
          const json = result.json ?? {}

          if (!result.ok && json.ledger_sync_failed && json.transaction_signature?.trim()) {
            const pending: PendingClaimLedgerSync = {
              transaction_signature: json.transaction_signature.trim(),
              total_claimed:
                typeof json.total_claimed === 'number' && Number.isFinite(json.total_claimed)
                  ? json.total_claimed
                  : claimPlans.reduce((s, p) => s + p.payoutAmount, 0),
              claims: (json.claims?.length ? json.claims : claimPlans).map((c) => ({
                position_id: 'positionId' in c ? c.positionId : c.position_id,
                amount:
                  'payoutAmount' in c
                    ? c.payoutAmount
                    : Number((c as { claimed?: number }).claimed ?? 0),
                claimed_rewards_total:
                  'newClaimedTotal' in c
                    ? c.newClaimedTotal
                    : Number(c.claimed_rewards_total),
              })),
            }
            if (typeof window !== 'undefined') {
              sessionStorage.setItem(PENDING_CLAIM_LEDGER_STORAGE_KEY, JSON.stringify(pending))
            }
            setClaimAllTxPhase('syncing')
            let synced = await syncClaimLedgerAfterPayout(pending)
            if (!synced) {
              synced = await catchUpClaimLedgerAfterPayout()
            }
            if (synced) {
              ledgerClaims.push(
                ...pending.claims.map((c) => ({
                  position_id: c.position_id,
                  claimed_rewards_total: c.claimed_rewards_total,
                }))
              )
              return {
                total_claimed: pending.total_claimed,
                claim_count: pending.claims.length,
                claims: pending.claims.map((c) => ({
                  position_id: c.position_id,
                  claimed: c.amount,
                  claimed_rewards_total: c.claimed_rewards_total,
                })),
                transaction_signature: pending.transaction_signature,
                execution: { path: 'onchain_transfer' as const },
                ledger_recovered: true,
              }
            }
            setActionError(
              'OWL was sent to your wallet, but nest totals are still syncing. Refresh the page in a few seconds — do not claim again yet.'
            )
            throw new Error('claim-all')
          }

          if (!result.ok) {
            const err = typeof json.error === 'string' ? json.error : 'Claim all failed'
            setActionError(err)
            throw new Error('claim-all')
          }
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem(PENDING_CLAIM_LEDGER_STORAGE_KEY)
          }
          const rows = (json.claims?.length ? json.claims : claimPlans).map((c) => ({
            position_id: 'positionId' in c ? c.positionId : c.position_id,
            claimed_rewards_total:
              'newClaimedTotal' in c
                ? c.newClaimedTotal
                : Number((c as { claimed_rewards_total?: number }).claimed_rewards_total),
          }))
          ledgerClaims.push(
            ...rows.filter((r) => r.position_id && Number.isFinite(r.claimed_rewards_total))
          )
          return json
        },
        afterSuccess: async () => {
          if (ledgerClaims.length > 0) {
            applyClaimLedgerToPositions(ledgerClaims)
          }
          setRewardsNowMs(Date.now())
          void loadClaimLedger()
        },
      })

      const total =
        typeof claimJson.total_claimed === 'number' && Number.isFinite(claimJson.total_claimed)
          ? claimJson.total_claimed
          : 0
      const count =
        typeof claimJson.claim_count === 'number' && Number.isFinite(claimJson.claim_count)
          ? claimJson.claim_count
          : claimableNestCount
      const totalLabel = total.toLocaleString(undefined, { maximumFractionDigits: 6 })
      setSuccessNotice({
        placement: 'modal',
        title: 'Claim successful',
        message:
          claimJson.execution?.path === 'database_only'
            ? `${totalLabel} OWL recorded from ${count} nests.`
            : `${totalLabel} OWL sent to your wallet from ${count} nests.`,
        hint:
          claimJson.execution?.path === 'database_only'
            ? 'Your nest balances are updated. New rewards will accrue as usual.'
            : 'Check your wallet balance — one combined payout for all nests.',
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'claim-all') throw e
      setActionError(formatNestingApiFetchError(e, 'claim'))
    }
  }

  const mobileConnectHint = nestingMobileConnectHint()

  if (!connected) {
    return (
      <main className="relative mx-auto max-w-2xl px-4 py-10 safe-area-bottom">
        <div className="rounded-2xl border border-border/60 bg-card/80 p-6 space-y-4">
          <Egg className="h-10 w-10 text-theme-prime" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">Your nest</h1>
          <p className="text-muted-foreground">
            Connect your wallet to browse perches and open a nest—Owltopia walks you through each step.
          </p>
          {mobileConnectHint ? (
            <p className="text-xs text-muted-foreground leading-relaxed border border-border/50 rounded-lg px-3 py-2">
              {mobileConnectHint}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className={cn(nestingMutedActionButtonClass, 'min-h-[52px] touch-manipulation w-full')}
            onClick={() => setVisible(true)}
          >
            Connect wallet
          </Button>
          <p className="text-xs text-muted-foreground">
            <Link href="/nesting" className="text-theme-prime underline-offset-4 hover:underline">
              See public perches
            </Link>
          </p>
        </div>
      </main>
    )
  }

  if (!publicKey) {
    return (
      <main className="container mx-auto px-4 py-10 max-w-2xl space-y-3 safe-area-bottom">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin shrink-0" aria-hidden />
          <p className="text-sm">Preparing your wallet…</p>
        </div>
        {isMobileDevice() ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isSolanaMobileEnvironment()
              ? 'On Seeker, if nothing happens in a few seconds, tap Connect wallet and choose Solana Mobile, or use Phantom/Solflare.'
              : 'The wallet can take a moment after you return from the wallet app. If this sticks, refresh once or tap Connect and open in Phantom or Solflare.'}
          </p>
        ) : null}
      </main>
    )
  }

  if (loading) {
    return (
      <main className="container mx-auto px-4 py-10 max-w-4xl">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Warming up your nest…
        </div>
      </main>
    )
  }

  if (needsSignIn) {
    return (
      <main className="container mx-auto px-4 py-10 max-w-2xl space-y-4">
        <Button variant="ghost" size="sm" asChild className="min-h-[44px] -ml-2">
          <Link href="/dashboard" className="gap-2">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to dashboard
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Almost there</h1>
        <p className="text-muted-foreground">
          Say hi with one wallet message so we can pull up your nests and show{' '}
          <span className="font-medium text-foreground">Claim all</span> when OWL is ready—no gas fees, just a
          signature.
        </p>
        {signInError && <p className="text-destructive text-sm">{signInError}</p>}
        <Button onClick={() => void handleSignIn()} disabled={signingIn || !signMessage}>
          {signingIn ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Signing in…
            </>
          ) : (
            'Say hi with wallet'
          )}
        </Button>
      </main>
    )
  }

  if (error) {
    return (
      <main className="container mx-auto px-4 py-10 max-w-2xl">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" className="mt-4 min-h-[44px]" onClick={() => void refreshAll()}>
          Retry
        </Button>
      </main>
    )
  }

  return (
    <main className="container mx-auto px-3 sm:px-4 py-6 sm:py-10 pb-16 max-w-4xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap gap-x-3 gap-y-2 mb-2">
            <Button variant="ghost" size="sm" asChild className="min-h-[44px] -ml-2">
              <Link href="/nesting#perches" className="gap-2 text-muted-foreground">
                <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
                Back to perch
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild className="min-h-[44px]">
              <Link href="/dashboard" className="gap-2 text-muted-foreground">
                <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden />
                Dashboard
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-display tracking-wide text-theme-prime">My nest</h1>
          <p className="text-sm text-muted-foreground">
            Rewards quietly stack while you roam—grab OWL whenever you are ready.
          </p>
          <p className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
            <Wallet className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
            <span className="font-mono break-all">{walletAddr}</span>
          </p>
          <NestingOwlCoinWalletProgressPanel
            pools={pools}
            preferredPoolId={owlCoinProgressPreferredPoolId}
            className="mt-3 max-w-md rounded-xl border border-emerald-500/20 bg-black/30 px-3 py-3"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] touch-manipulation"
          onClick={() => void refreshAll()}
        >
          <RefreshCw className="h-4 w-4 sm:mr-2" aria-hidden />
          Refresh
        </Button>
      </div>

      <NestingClaimAllPanel
        activeOwlNestCount={activeOwlNestCount}
        claimableNestCount={claimableNestCount}
        totalOwl={claimAllPreview.totalOwl}
        platformFeeLabel={claimAllPlatformFeeLabel}
        busy={claimAllBusy}
        disabled={claimAllButtonDisabled}
        disabledReason={claimAllDisabledReason}
        phase={claimAllTxPhase}
        onClaimAll={() => void handleClaimAll()}
      />

      {claimableNestCount < 1 && nestsPendingOnly ? (
        <div
          className="rounded-xl border border-amber-500/45 bg-amber-500/[0.08] px-4 py-3 text-sm leading-relaxed"
          role="status"
        >
          <p className="font-medium text-foreground">
            {pendingOpenCount === 1 ? '1 nest is still opening' : `${pendingOpenCount} nests are still opening`}
          </p>
          <p className="mt-1 text-muted-foreground text-xs sm:text-sm">
            <span className="font-medium text-foreground">Claim all</span> appears once your active nests total{' '}
            <span className="font-medium text-foreground">1+ OWL</span> combined. Finish opening below, then refresh.
          </p>
        </div>
      ) : null}

      {actionError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive space-y-3">
          <p>{actionError}</p>
          {showClaimLedgerHeal ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] w-full touch-manipulation"
              disabled={claimLedgerHealBusy || claimAllBusy}
              onClick={() => void handleHealClaimLedger()}
            >
              {claimLedgerHealBusy ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden />
              ) : null}
              {claimLedgerHealBusy ? 'Updating nest records…' : 'I received OWL — update my nest records'}
            </Button>
          ) : null}
        </div>
      )}

      {claimLedgerNotice ? (
        <div
          className="rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-4 py-3 text-sm text-foreground"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <p className="leading-relaxed text-foreground/95 min-w-0">{claimLedgerNotice}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] shrink-0 touch-manipulation self-start sm:self-center"
              onClick={() => setClaimLedgerNotice(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      {nestingDisabled ? (
        <div
          className="rounded-lg border border-amber-500/45 bg-amber-500/[0.08] px-4 py-3 text-sm text-foreground"
          role="status"
          aria-live="polite"
        >
          <p className="font-medium text-foreground">Nesting is paused</p>
          <p className="mt-1 text-muted-foreground leading-relaxed">
            {nestingPausedByDeployEnv ? (
              <>
                The <span className="font-mono">NESTING_DISABLED</span> deployment flag is on, so new nests, claims, and
                leaving a nest are blocked for everyone. The admin “pause holder actions” switch cannot override this.
                Remove the variable for this environment in Vercel (or <span className="font-mono">.env.local</span> when
                developing), deploy again, then refresh. If you were partway through opening a nest, select the same
                Owltopia coin in the nest form and use Confirm nest to finish the wallet lock (only for nests that are
                still opening).
              </>
            ) : nestingPausedByAdmin ? (
              <>
                New nests and leaving a nest are paused from Owl Nesting admin.{' '}
                <span className="font-medium text-foreground">Claim all</span> and per-nest{' '}
                <span className="font-medium text-foreground">Claim OWL</span> still work for rewards you already earned.
                Turn off “pause holder actions” in Admin → Nesting when you want to open or leave nests again. If you were
                partway through opening a nest, select the same Owltopia coin in the nest form and use Confirm nest to
                finish the wallet lock (only for nests that are still opening).
              </>
            ) : (
              <>
                New nests, claims, and leaving a nest are off for the moment. If you were partway through opening a nest,
                select the same Owltopia coin in the nest form and use Confirm nest to finish the wallet lock (only for
                nests that are still opening).
              </>
            )}
          </p>
        </div>
      ) : null}

      <NestingSecurityNotice
        id="nesting-security-notice"
        acknowledged={securityAck}
        onSignAcknowledgment={() => {
          clearSecurityAckError()
          void signSecurityAck()
        }}
        signing={securityAckSigning}
        signError={securityAckError}
        walletConnected={connected}
      />

      {viewerIsAdmin === true ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex flex-col gap-3 touch-manipulation sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 space-y-1">
              <p id="nest-admin-bypass-heading" className="text-sm font-semibold text-foreground">
                Admin test: bypass sellout gate
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Enables staking (e.g. amount <span className="font-mono">1</span> with a test NFT mint) before{' '}
                <span className="font-mono">NESTING_SELL_OUT_*</span> is satisfied. Stored in session storage for this browser
                only; public users never see this.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 min-h-[44px]">
              <Switch
                id="nest-admin-bypass-sellout"
                ariaLabel="Bypass nesting sellout gate for admin testing"
                aria-labelledby="nest-admin-bypass-heading"
                checked={adminBypassSellout}
                onCheckedChange={setAdminBypassSelloutPersisted}
                className="shrink-0"
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Total nestled',
            value: totals.nested.toLocaleString(undefined, { maximumFractionDigits: 6 }),
            subline: null as string | null,
          },
          { label: 'Open nests', value: String(totals.activeCount), subline: null },
          {
            label: 'Ready to claim',
            value: totals.accruingOwl.toLocaleString(undefined, { maximumFractionDigits: 6 }),
            subline: readyToClaimSubline,
          },
          {
            label: 'Rewards claimed',
            value: totals.claimed.toLocaleString(undefined, { maximumFractionDigits: 6 }),
            subline: null,
          },
        ].map(({ label, value, subline }) => (
          <Card key={label} className="rounded-xl border-border/60 bg-card/90">
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-lg font-mono tabular-nums">{value}</CardTitle>
              {subline ? (
                <p className="text-[11px] text-muted-foreground leading-snug pt-0.5">{subline}</p>
              ) : null}
            </CardHeader>
          </Card>
        ))}
      </div>

      {openingNestsNeedingWalletLock.length > 0 ? (
        <div
          className="rounded-xl border border-amber-500/45 bg-amber-500/[0.08] px-4 py-3 text-sm space-y-3"
          role="status"
          aria-live="polite"
        >
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              {openingNestsNeedingWalletLock.length === 1
                ? '1 nest is still opening'
                : `${openingNestsNeedingWalletLock.length} nests are still opening`}
            </p>
            <p className="text-muted-foreground leading-relaxed text-xs sm:text-sm">
              The wallet lock step did not finish. We try to fix this automatically when you load the page; if a nest
              still shows <span className="font-medium text-foreground/90">Opening…</span>, tap below and approve each
              prompt in your wallet — <span className="font-medium text-foreground/90">batched approvals</span> (up to{' '}
              {NESTING_MPL_CORE_FREEZE_WALLET_BATCH_MAX} coins per transaction on Backpack, Phantom, etc.). The count
              here updates as each batch completes; stay on this page until the list is clear.
            </p>
          </div>
          <Button
            type="button"
            variant="default"
            className="min-h-[48px] w-full touch-manipulation font-semibold"
            disabled={stakeTxPhase !== 'idle'}
            onClick={() => selectOpeningNestsUpToMax()}
          >
            {openingNestsNeedingWalletLock.length > NESTING_NFT_STAKE_MAX_PER_RUN
              ? `Finish opening — select up to ${NESTING_NFT_STAKE_MAX_PER_RUN}`
              : `Finish opening ${openingNestsNeedingWalletLock.length === 1 ? 'nest' : 'nests'}`}
          </Button>
          {openingNestsNeedingWalletLock.length > NESTING_NFT_STAKE_MAX_PER_RUN ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Up to {NESTING_NFT_STAKE_MAX_PER_RUN} per confirm — use Select all in the form below after each wallet
              batch.
            </p>
          ) : null}
        </div>
      ) : null}

      {!claimAllReady && totals.activeCount > 0 && !nestsPendingOnly ? (
        <div
          className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground leading-relaxed"
          role="status"
        >
          <p>
            <span className="font-medium text-foreground">OWL is accruing</span> on{' '}
            {totals.activeCount === 1 ? 'your nest' : `${totals.activeCount} nests`}. Claim all unlocks when your nests
            total at least <span className="font-medium text-foreground">1 OWL</span> combined (see{' '}
            <span className="font-medium text-foreground">Ready to claim</span> above).
          </p>
        </div>
      ) : null}

      <section id="nesting-open-nest-form" className="scroll-mt-24">
        <button
          type="button"
          className={cn(
            'flex w-full min-h-[44px] touch-manipulation items-start justify-between gap-3 rounded-lg text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-prime/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
          )}
          aria-expanded={openNestFormExpanded}
          aria-controls="nesting-open-nest-form-content"
          onClick={() => setOpenNestFormExpanded((v) => !v)}
        >
          <span className="sr-only">{openNestFormExpanded ? 'Collapse' : 'Expand'} Open a nest</span>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="font-display text-xl sm:text-2xl tracking-wide text-theme-prime drop-shadow-[0_0_12px_rgba(0,255,136,0.25)]">
              Open a nest
            </h2>
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              {openNestFormExpanded ? openNestFormDescription : openNestFormCollapsedSummary}
            </p>
            {!openNestFormExpanded && openingNestsNeedingWalletLock.length > 0 ? (
              <p className="text-xs text-amber-300/95 leading-relaxed">
                Expand to finish the wallet lock — use Confirm nest below.
              </p>
            ) : null}
          </div>
          <ChevronDown
            className={cn(
              'mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200',
              openNestFormExpanded && 'rotate-180'
            )}
            aria-hidden
          />
        </button>
        {openNestFormExpanded ? (
        <div id="nesting-open-nest-form-content" className="mt-4 space-y-4">
        <NestSwapFlowShell
          payPanel={
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {nftMintRequired ? (
                  <>
                    <p className="min-h-[48px] text-2xl font-semibold tabular-nums text-foreground sm:min-h-[52px] sm:text-[1.75rem]">
                      {selectedNftStakeAssetIds.length > 0
                        ? selectedNftStakeAssetIds.length
                        : '0'}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {selectedNftStakeAssetIds.length > 0
                        ? `nest${selectedNftStakeAssetIds.length === 1 ? '' : 's'} selected`
                        : 'Select Owltopia coins below'}
                    </p>
                  </>
                ) : (
                  <>
                    <Label htmlFor="stake-amt" className="sr-only">
                      Amount to nest
                    </Label>
                    <Input
                      id="stake-amt"
                      inputMode="decimal"
                      placeholder="0.0"
                      value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value)}
                      className="touch-manipulation min-h-[48px] border-0 bg-transparent px-0 text-2xl font-semibold tabular-nums text-foreground placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 sm:min-h-[52px] sm:text-[1.75rem]"
                    />
                  </>
                )}
                {tokenStakeRequired ? (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {!connected ? (
                          <>Connect wallet to see balance</>
                        ) : walletTokenScan.status === 'loading' ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                            Reading balance…
                          </span>
                        ) : walletTokenScan.status === 'done' && walletTokenScan.uiAmount !== null ? (
                          <>
                            <span className="text-muted-foreground">Balance </span>
                            <span className="font-medium tabular-nums text-foreground/90">
                              {walletTokenScan.uiAmount.toLocaleString(undefined, {
                                maximumFractionDigits: walletTokenScan.decimals ?? 6,
                              })}
                            </span>
                          </>
                        ) : walletTokenScan.status === 'done' && walletTokenScan.hint ? (
                          <span className="text-amber-400/90">Couldn’t read balance</span>
                        ) : (
                          <>Balance —</>
                        )}
                      </span>
                      {connected &&
                      walletTokenScan.status === 'done' &&
                      walletTokenScan.uiAmount !== null &&
                      walletTokenScan.uiAmount > 0 ? (
                        <button
                          type="button"
                          className="touch-manipulation rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-theme-prime hover:bg-emerald-500/25"
                          onClick={() => {
                            const ui = walletTokenScan.uiAmount
                            if (ui === null || ui <= 0) return
                            setStakeAmount(
                              ui.toLocaleString('en-US', {
                                useGrouping: false,
                                maximumFractionDigits: walletTokenScan.decimals ?? 6,
                              })
                            )
                          }}
                        >
                          Max
                        </button>
                      ) : connected &&
                        walletTokenScan.status === 'done' &&
                        walletTokenScan.uiAmount === null ? (
                        <button
                          type="button"
                          className="touch-manipulation rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-white/5"
                          onClick={() => void loadPerchTokenFromWallet()}
                        >
                          Retry
                        </button>
                      ) : null}
                    </div>
                    {walletTokenScan.status === 'done' &&
                    walletTokenScan.uiAmount === null &&
                    walletTokenScan.hint ? (
                      <p className="break-words text-[11px] leading-snug text-amber-400/85">
                        {walletTokenScan.hint}
                      </p>
                    ) : null}
                  </div>
                ) : !selectedPerch ? (
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    Choose a perch below to load assets from your wallet.
                  </p>
                ) : lockedPerch?.asset_type === 'nft' ? (
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    One coin = one nest. Load your wallet, then pick coins below.
                  </p>
                ) : null}
              </div>
              <NestSwapAssetChip
                label={nftMintRequired ? 'Owltopia coin' : tokenStakeSymbol}
                sublabel={
                  selectedPerch
                    ? perchAssetKindLabel(selectedPerch.asset_type)
                    : lockedPerch
                      ? perchAssetKindLabel(lockedPerch.asset_type)
                      : 'Pick perch'
                }
                icon={
                  nftMintRequired ? (
                    <Layers className="h-4 w-4 text-theme-prime" aria-hidden />
                  ) : (
                    <Coins className="h-4 w-4 text-theme-prime" aria-hidden />
                  )
                }
                aria-label="Asset you pay with"
              />
            </div>
          }
          receivePanel={
            lockedPerch ? (
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-semibold tabular-nums text-foreground sm:text-[1.75rem]">
                    <span className="text-theme-prime">
                      {formatRewardRate(Number(lockedPerch.reward_rate), lockedPerch.reward_rate_unit)}
                    </span>
                    {lockedPerch.reward_token ? (
                      <span className="ml-1.5 text-base font-medium text-muted-foreground sm:text-lg">
                        {lockedPerch.reward_token}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    {isNftStakingPool(lockedPerch) ? 'Per Owltopia coin nested' : 'Reward rate on this perch'}
                    {' · '}
                    Lock{' '}
                    <span className="font-medium text-foreground/85">
                      {lockedPerch.lock_period_days === 0 ? 'none' : `${lockedPerch.lock_period_days} days`}
                    </span>
                  </p>
                  {lockedPerch.description ? (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground/90 leading-relaxed">
                      {lockedPerch.description}
                    </p>
                  ) : null}
                </div>
                <NestSwapAssetChip
                  label={lockedPerch.name ?? 'Perch'}
                  sublabel={perchAssetKindLabel(lockedPerch.asset_type)}
                  icon={<Egg className="h-4 w-4 text-theme-prime" aria-hidden />}
                  aria-label="Earning perch"
                />
              </div>
            ) : preselectedPerchMissing ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Perch not found</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  That perch link may be outdated or turned off. Pick a live perch below or go back to{' '}
                  <Link href="/nesting#perches" className="font-medium text-theme-prime underline-offset-4 hover:underline">
                    Open perches
                  </Link>
                  .
                </p>
                <ul className="list-none space-y-2 p-0" role="list">
                  {pools.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/dashboard/nesting?pool=${encodeURIComponent(p.slug)}`}
                        className={cn(
                          'flex min-h-[48px] w-full touch-manipulation items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#1c2620]/80 px-3 py-3 text-left text-base font-medium text-foreground',
                          'hover:border-emerald-500/30 hover:bg-[#243328] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-prime/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121a15]'
                        )}
                      >
                        <span className="min-w-0 truncate">{p.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {perchAssetKindLabel(p.asset_type)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : showPerchPicker ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Choose a perch</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Each nest belongs to one perch. Pick one row—this page will stay on that perch only.
                </p>
                <ul className="list-none space-y-2 p-0" role="list">
                  {pools.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/dashboard/nesting?pool=${encodeURIComponent(p.slug)}`}
                        className={cn(
                          'flex min-h-[48px] w-full touch-manipulation items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#1c2620]/80 px-3 py-3 text-left text-base font-medium text-foreground',
                          'hover:border-emerald-500/30 hover:bg-[#243328] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-prime/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121a15]'
                        )}
                      >
                        <span className="min-w-0 truncate">{p.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {perchAssetKindLabel(p.asset_type)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select a perch to see what you earn.</p>
            )
          }
          details={
            lockedPerch && otherPerches.length > 0 ? (
              <p>
                Different perch?{' '}
                {otherPerches.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 ? ' · ' : null}
                    <Link
                      href={`/dashboard/nesting?pool=${encodeURIComponent(p.slug)}`}
                      className="font-medium text-theme-prime underline-offset-4 hover:underline"
                    >
                      {p.name}
                    </Link>
                  </span>
                ))}
              </p>
            ) : null
          }
          payFooter={
            <div className="space-y-2">
            {tokenStakeRequired ? (
              <>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Wallet · {tokenStakeSymbol}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Load balance from your connected wallet for this perch only.
                </p>

                {walletTokenScan.status === 'idle' ? (
                  <div className="space-y-2">
                    <Button
                      type="button"
                      variant="default"
                      className="min-h-[48px] w-full touch-manipulation font-semibold text-base shadow-[0_0_18px_rgba(0,255,136,0.12)]"
                      disabled={!connected || !tokenStakeMint}
                      onClick={() => void loadPerchTokenFromWallet()}
                    >
                      Load {tokenStakeSymbol} balance
                    </Button>
                    {!connected ? (
                      <p className="text-xs text-muted-foreground text-center">Connect your wallet first.</p>
                    ) : !tokenStakeMint ? (
                      <p className="text-xs text-amber-400/90 text-center">
                        This perch is missing a token mint—admin needs to set it.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {walletTokenScan.status === 'loading' ? (
                  <div className="flex min-h-[44px] items-center gap-2 text-xs text-muted-foreground touch-manipulation">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                    <span>Reading your {tokenStakeSymbol} balance from the network…</span>
                  </div>
                ) : null}

                {walletTokenScan.status === 'done' && walletTokenScan.hint ? (
                  <p className="text-xs text-amber-400/90 leading-relaxed">{walletTokenScan.hint}</p>
                ) : null}

                {walletTokenScan.status === 'done' && walletTokenScan.uiAmount !== null ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-black/25 p-3 touch-manipulation">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-muted-foreground">Wallet balance</p>
                        <p className="truncate text-base font-semibold tabular-nums text-foreground">
                          {walletTokenScan.uiAmount.toLocaleString(undefined, {
                            maximumFractionDigits: walletTokenScan.decimals ?? 6,
                          })}{' '}
                          <span className="text-sm font-normal text-muted-foreground">
                            {tokenStakeSymbol}
                          </span>
                        </p>
                        {tokenStakeMint ? (
                          <p className="truncate font-mono text-[11px] text-muted-foreground">
                            {shortenAddress(tokenStakeMint, 6)}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[40px] shrink-0 touch-manipulation border-emerald-500/40 text-xs font-semibold"
                        disabled={!walletTokenScan.uiAmount || walletTokenScan.uiAmount <= 0}
                        onClick={() => {
                          const ui = walletTokenScan.uiAmount
                          if (ui === null || ui <= 0) return
                          setStakeAmount(
                            ui.toLocaleString('en-US', {
                              useGrouping: false,
                              maximumFractionDigits: walletTokenScan.decimals ?? 6,
                            })
                          )
                        }}
                      >
                        Use max
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-[44px] w-full touch-manipulation gap-2 border-border/60 text-sm font-medium"
                      disabled={!connected}
                      onClick={() => void loadPerchTokenFromWallet()}
                    >
                      <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
                      Reload {tokenStakeSymbol} balance
                    </Button>
                  </div>
                ) : null}

                {walletTokenScan.status === 'done' &&
                walletTokenScan.uiAmount === null &&
                !walletTokenScan.hint ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px] w-full touch-manipulation gap-2 border-border/60 text-sm font-medium"
                    disabled={!connected}
                    onClick={() => void loadPerchTokenFromWallet()}
                  >
                    <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
                    Try again
                  </Button>
                ) : null}
              </>
            ) : !nftMintRequired ? (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Choose a perch above to load your token balance or Owltopia coins from this wallet.
              </p>
            ) : (
              <>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Wallet · Owltopia coins
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Load coins from this collection, then select one or more to nest.
                </p>

                {selectedNftStakeAssetIds.length > 0 ? (
                  <div className="space-y-2 rounded-lg border border-emerald-500/20 bg-black/25 p-3 touch-manipulation">
                    <p className="text-xs font-medium text-muted-foreground">
                      You&apos;re nesting {selectedNftStakeAssetIds.length}{' '}
                      {selectedNftStakeAssetIds.length === 1 ? 'coin' : 'coins'}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(selectedOwlNestMintRows.length > 0
                        ? selectedOwlNestMintRows
                        : selectedNftStakeAssetIds.map((mint) => ({ mint, name: null, image: null }))
                      ).map((m) => (
                        <div key={m.mint} className="flex min-w-0 items-center gap-3">
                          <NestingStakedAssetThumb
                            mint={m.mint}
                            hintImageUrl={m.image ?? null}
                            name={m.name ?? null}
                            size="md"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {m.name?.trim() || 'Owltopia coin'}
                            </p>
                            <p className="truncate font-mono text-[11px] text-muted-foreground">
                              {shortenAddress(m.mint, 6)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {owlNestMintScan.status === 'idle' ? (
                  <div className="space-y-2">
                    <Button
                      type="button"
                      variant="default"
                      className="min-h-[48px] w-full touch-manipulation font-semibold text-base shadow-[0_0_18px_rgba(0,255,136,0.12)]"
                      disabled={!connected || needsSignIn || loading || error !== null}
                      onClick={() => void loadOwlNestNftsFromWallet()}
                    >
                      Load Owltopia coins from wallet
                    </Button>
                    {!connected ? (
                      <p className="text-xs text-muted-foreground text-center">Connect your wallet first.</p>
                    ) : needsSignIn ? (
                      <p className="text-xs text-muted-foreground text-center">
                        Sign in with your wallet to load Owltopia coins.
                      </p>
                    ) : loading ? (
                      <p className="text-xs text-muted-foreground text-center">Loading dashboard…</p>
                    ) : error !== null ? (
                      <p className="text-xs text-destructive/90 text-center">{error}</p>
                    ) : null}
                  </div>
                ) : null}

                {owlNestMintScan.status === 'loading' ? (
                  <div className="flex min-h-[44px] items-center gap-2 text-xs text-muted-foreground touch-manipulation">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                    <span>Loading Owltopia coins from your wallet…</span>
                  </div>
                ) : null}

                {owlNestMintScan.hint ? (
                  <p className="text-xs text-amber-400/90 leading-relaxed">{owlNestMintScan.hint}</p>
                ) : null}

                {owlNestMintScan.status === 'done' && owlNestMintScan.mints.length > 1 ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label className="text-xs font-normal text-muted-foreground">
                        Choose one or more
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-[36px] h-auto px-2 text-xs text-theme-prime disabled:opacity-40"
                        disabled={
                          owlNestMintScan.mints.every((row) =>
                            selectedPerch?.asset_type === 'nft'
                              ? nftMintBlocksDuplicateStakeExceptResume(
                                  row.mint,
                                  selectedPerch,
                                  positions
                                )
                              : false
                          )
                        }
                        onClick={() => {
                          const pool = selectedPerch
                          const nestable =
                            pool?.asset_type === 'nft'
                              ? owlNestMintScan.mints.filter(
                                  (row) =>
                                    !nftMintBlocksDuplicateStakeExceptResume(
                                      row.mint,
                                      pool,
                                      positions
                                    )
                                )
                              : owlNestMintScan.mints
                          const all = nestable.map((m) => m.mint)
                          setStakeAssetIds(all)
                          setStakeAssetId(all[0] ?? '')
                        }}
                      >
                        Select all nestable
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground/85">Recommended:</span> select every coin you want,
                      then tap confirm below — your wallet signs{' '}
                      <span className="font-medium text-foreground/85">
                        up to {NESTING_MPL_CORE_FREEZE_WALLET_BATCH_MAX} coins per transaction
                      </span>{' '}
                      (large flocks may need a few approvals). Stay on this page until finished; the opening count
                      updates after each batch.
                    </p>
                    {selectedPerch?.asset_type === 'nft' &&
                    owlNestMintScan.mints.some((row) =>
                      nftMintBlocksDuplicateStakeExceptResume(row.mint, selectedPerch, positions)
                    ) ? (
                      <p className="text-xs text-muted-foreground/85 leading-relaxed">
                        Coins <span className="font-medium text-foreground/80">already nested</span> on this perch stay
                        listed for reference — they&apos;re skipped for new nests unless you&apos;re finishing a nest that
                        is still waiting on a wallet freeze step.
                      </p>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {owlNestMintScan.mints.map((m) => {
                        const alreadyNestedHere =
                          selectedPerch?.asset_type === 'nft' &&
                          nftMintBlocksDuplicateStakeExceptResume(m.mint, selectedPerch, positions)
                        const resumeFreezeOnly =
                          selectedPerch?.asset_type === 'nft' &&
                          !alreadyNestedHere &&
                          positions.some(
                            (p) =>
                              isOpeningNftNestAbortable(p, selectedPerch) &&
                              p.pool_id === selectedPerch.id &&
                              p.asset_identifier?.trim() === m.mint.trim()
                          )
                        const checked = stakeAssetIds.includes(m.mint)
                        return (
                          <button
                            key={m.mint}
                            type="button"
                            disabled={Boolean(alreadyNestedHere)}
                            aria-pressed={checked}
                            aria-disabled={alreadyNestedHere ? true : undefined}
                            onClick={() => toggleSelectedOwlNestMint(m.mint)}
                            className={cn(
                              'flex min-h-[56px] items-center gap-3 rounded-xl border px-3 py-2 text-left touch-manipulation transition-colors',
                              alreadyNestedHere
                                ? 'cursor-not-allowed border-white/[0.06] bg-black/20 opacity-70'
                                : checked
                                  ? 'border-emerald-500/50 bg-emerald-500/12'
                                  : 'border-white/[0.08] bg-[#1c2620]/60 hover:border-emerald-500/35 hover:bg-[#243328]/80'
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold',
                                alreadyNestedHere
                                  ? 'border-muted-foreground/30 bg-muted/40 text-muted-foreground/50'
                                  : checked
                                    ? 'border-emerald-400 bg-emerald-400 text-black'
                                    : 'border-muted-foreground/50 text-transparent'
                              )}
                              aria-hidden
                            >
                              x
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {(m.name?.trim() && m.name.trim().slice(0, 88)) || 'Owltopia coin'}
                              </span>
                              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                                {shortenAddress(m.mint, 6)}
                              </span>
                              {alreadyNestedHere ? (
                                <span className="mt-1 block truncate text-[11px] font-medium text-amber-400/95">
                                  Already nested
                                </span>
                              ) : resumeFreezeOnly ? (
                                <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                                  Open nest — finish freeze in wallet when you confirm below
                                </span>
                              ) : null}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                {owlNestMintScan.status === 'done' && owlNestMintScan.mints.length === 1 ? (
                  <div className="space-y-2">
                    {selectedPerch?.asset_type === 'nft' &&
                    nftMintBlocksDuplicateStakeExceptResume(
                      owlNestMintScan.mints[0].mint,
                      selectedPerch,
                      positions
                    ) ? (
                      <p className="text-xs text-amber-400/95 leading-relaxed">
                        This coin is{' '}
                        <span className="font-semibold text-foreground/90">already nested</span> on this perch. Manage or
                        claim rewards from{' '}
                        <span className="font-medium text-foreground/90">Your nests</span> below — you don&apos;t need to open
                        a new nest for it unless you left a nest halfway through and still need to finish the wallet freeze
                        step for this same coin.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        <span className="font-medium text-foreground/90">Ready to nest</span>
                        {' — '}
                        {owlNestMintScan.mints[0].name?.trim() ? (
                          <>{owlNestMintScan.mints[0].name.trim()}</>
                        ) : (
                          <>your Owltopia coin </>
                        )}
                        <span className="font-mono text-theme-prime/85">{` (${shortenAddress(owlNestMintScan.mints[0].mint, 5)})`}</span>
                        .
                      </p>
                    )}
                  </div>
                ) : null}

                {owlNestMintScan.status === 'done' && owlNestMintScan.configured && owlNestMintScan.mints.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      No Owltopia coins from this perch&apos;s collection showed up for the wallet we queried (
                      <span className="font-mono text-foreground/80">{shortenAddress(walletAddr, 5)}</span>
                      ){owlNestMintScan.resolvedCollectionAddress ? (
                        <>
                          {' '}
                          for collection{' '}
                          <span className="font-mono text-theme-prime/85">
                            {shortenAddress(owlNestMintScan.resolvedCollectionAddress, 6)}
                          </span>
                        </>
                      ) : null}
                      . Recheck you signed in with that wallet on the correct network, then reload the list.
                    </p>
                  </div>
                ) : null}

                {owlNestMintScan.status === 'done' ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px] w-full touch-manipulation gap-2 border-border/60 text-sm font-medium"
                    disabled={!connected || needsSignIn || loading || error !== null}
                    onClick={() => void loadOwlNestNftsFromWallet()}
                  >
                    <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
                    Reload Owltopia coins
                  </Button>
                ) : null}
              </>
            )}
            </div>
          }
          actions={
            <>
            <NestingActionStatusLine phase={stakeTxPhase} className="min-h-[1.25rem] text-center sm:text-left" />
            {nftStakeBatchHint ? (
              <p className="text-xs text-center text-muted-foreground leading-relaxed px-1" role="status">
                {nftStakeBatchHint}
              </p>
            ) : nftMintRequired && selectedNftStakeAssetIds.length > 1 && stakeTxPhase === 'idle' ? (
              <p className="text-xs text-center text-muted-foreground leading-relaxed px-1" role="note">
                Your wallet may ask{' '}
                {chunkNftFreezeAssetIds(selectedNftStakeAssetIds).length === 1
                  ? 'once'
                  : `${chunkNftFreezeAssetIds(selectedNftStakeAssetIds).length} times`}{' '}
                (up to {NESTING_MPL_CORE_FREEZE_WALLET_BATCH_MAX} coins per approval). Platform fee and nest lock
                are in the same transaction. Stay on this page until you see the success message.
              </p>
            ) : null}
            <Button
              type="button"
              variant="default"
              size="lg"
              className="min-h-[52px] w-full touch-manipulation rounded-xl font-semibold text-base shadow-[0_0_24px_rgba(0,255,136,0.2)] hover:shadow-[0_0_32px_rgba(0,255,136,0.28)] disabled:opacity-50"
              disabled={Boolean(confirmNestDisabledReason)}
              title={confirmNestDisabledReason ?? undefined}
              aria-describedby={confirmNestDisabledReason ? 'nesting-confirm-disabled-reason' : undefined}
              onClick={() => void handleStake()}
            >
              {stakeTxPhase !== 'idle' ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
              {stakeTxPhase === 'idle'
                ? nftMintRequired && selectedNftStakeAssetIds.length > 1
                  ? `Confirm ${selectedNftStakeAssetIds.length} nests`
                  : 'Confirm nest'
                : nestingTxPhaseLabel(stakeTxPhase)}
            </Button>
            {confirmNestDisabledReason ? (
              <p
                id="nesting-confirm-disabled-reason"
                className="text-xs text-center text-amber-400/95 leading-relaxed px-1"
                role="status"
              >
                {confirmNestDisabledReason}
              </p>
            ) : null}
            </>
          }
        />
        </div>
        ) : null}
      </section>

      <section>
        <SectionHeader
          title="Your nests"
          description="Claim OWL anytime—use it in raffles right away or let it stack. Many Owltopia coins on the same perch show in one card—tap the header to expand or collapse."
        />
        <NestingClaimAllPanel
          id="nesting-claim-all-inline"
          className="mb-4"
          activeOwlNestCount={activeOwlNestCount}
          claimableNestCount={claimableNestCount}
          totalOwl={claimAllPreview.totalOwl}
          platformFeeLabel={claimAllPlatformFeeLabel}
          busy={claimAllBusy}
          disabled={claimAllButtonDisabled}
          disabledReason={claimAllDisabledReason}
          phase={claimAllTxPhase}
          onClaimAll={() => void handleClaimAll()}
        />
        {openPositions.length === 0 ? (
          <EmptyState title="No nests yet." body="Open one above or skim the public perches on the nesting page." />
        ) : (
          <ul className="grid gap-4">
            {nftNestGroups.map((g) => (
              <li key={`nft-group-${g.poolId}`} className="scroll-mt-24">
                <NftPerchGroupedNestCard
                  pool={g.pool}
                  poolName={g.pool.name ?? `Perch ${g.poolId.slice(0, 8)}…`}
                  positions={g.positions}
                  nestingWalletMintHints={nestingWalletMintHints}
                  onUnstake={handleUnstake}
                  onClaim={handleClaim}
                  posPhases={posPhases}
                  freezeRequired={g.pool.asset_type === 'nft' && g.pool.adapter_mode === 'onchain_enabled'}
                  actionsEnabled={!claimAllBusy}
                  nestingPaused={nestingDisabled}
                  claimsPaused={nestingClaimsBlocked}
                  onResumeOpening={resumeOpeningNest}
                />
              </li>
            ))}
            {ungroupedOpenPositions.map((pos) => {
              const pool = poolById.get(pos.pool_id)
              return (
                <li key={pos.id} id={nestGalleryAnchorId(pos.id)} className="scroll-mt-24">
                  <PositionCard
                    position={pos}
                    poolName={pool?.name ?? `Perch ${pos.pool_id.slice(0, 8)}…`}
                    stakedAssetHint={
                      pos.asset_identifier?.trim()
                        ? nestingWalletMintHints.get(pos.asset_identifier.trim()) ?? null
                        : null
                    }
                    onUnstake={handleUnstake}
                    onClaim={handleClaim}
                    claimPhase={posPhases[pos.id]?.claim ?? 'idle'}
                    unstakePhase={posPhases[pos.id]?.unstake ?? 'idle'}
                    freezeRequired={
                      pool?.asset_type === 'nft' && pool?.adapter_mode === 'onchain_enabled'
                    }
                    cancelOpeningAllowed={pool ? isOpeningNftNestAbortable(pos, pool) : false}
                    actionsEnabled={!claimAllBusy}
                    nestingPaused={nestingDisabled}
                    claimsPaused={nestingClaimsBlocked}
                    onResumeOpening={() => resumeOpeningNest(pos)}
                  />
                </li>
              )
            })}
          </ul>
        )}
        <NestingClaimLedger events={claimLedgerEvents} className="mt-6" />
      </section>

      <p className="text-xs text-muted-foreground text-center">
        <Link href="/nesting" className="text-theme-prime underline-offset-4 hover:underline">
          What Owl Nesting is
        </Link>
      </p>

      {activeOwlNestCount >= 1 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:hidden">
          <Button
            type="button"
            variant={claimAllReady ? 'default' : 'outline'}
            className={cn(
              'min-h-[52px] w-full touch-manipulation text-base',
              claimAllReady ? nestingClaimReadyButtonClass : nestingClaimAccruingButtonClass
            )}
            disabled={claimAllButtonDisabled || !claimAllReady}
            onClick={() => void handleClaimAll()}
          >
            {claimAllBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
            {claimAllReady
              ? `Claim all · ${claimAllPreview.totalOwl.toLocaleString(undefined, { maximumFractionDigits: 6 })} OWL`
              : 'Claim all — accruing OWL'}
          </Button>
        </div>
      ) : null}

      <NestingClaimSuccessDialog
        open={successNotice !== null}
        onOpenChange={(open) => {
          if (!open) setSuccessNotice(null)
        }}
        title={successNotice?.title}
        message={successNotice?.message ?? ''}
        hint={successNotice?.hint}
      />
    </main>
  )
}

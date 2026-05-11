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
  ArrowDown,
  ChevronDown,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { estimateClaimableRewards } from '@/lib/staking/rewards'
import type { RewardRateUnit } from '@/lib/db/staking-pools'
import { PositionCard } from '@/components/nesting/PositionCard'
import { nestGalleryAnchorId, StakedNftNestGallery } from '@/components/nesting/StakedNftNestGallery'
import { NestingStakedAssetThumb } from '@/components/nesting/NestingStakedAssetThumb'
import { SectionHeader } from '@/components/council/SectionHeader'
import { EmptyState } from '@/components/council/EmptyState'
import { runNestingTxAction } from '@/lib/nesting/run-tx-action'
import { nestingTxPhaseLabel, type NestingTxPhase } from '@/lib/nesting/tx-states'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { NestingActionStatusLine } from '@/components/nesting/NestingActionStatusLine'
import { NestingSecurityNotice } from '@/components/nesting/NestingSecurityNotice'
import { NESTING_SECURITY_ACK_STORAGE_KEY } from '@/lib/nesting/security-notice-content'
import { formatRewardRate, perchAssetKindLabel, shortenAddress } from '@/lib/nesting/format'
import { nestingMutedActionButtonClass } from '@/lib/nesting/ui-classes'
import { getCachedAdmin, setCachedAdmin, type AdminRole } from '@/lib/admin-check-cache'
import { cn, isMobileDevice } from '@/lib/utils'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { decimalToRawBigint } from '@/lib/nesting/token-amount'
import { getTokenInfo } from '@/lib/tokens'

const MOBILE_401_RETRY_MS = 800
const NESTING_ADMIN_SELLOUT_BYPASS_STORAGE_KEY = 'owl_nesting_admin_bypass_sellout_v1'

function rpcEndpointLooksDevnet(endpoint: string | undefined): boolean {
  if (!endpoint?.trim()) return false
  return /devnet/i.test(endpoint)
}

export function DashboardNestingClient() {
  const { publicKey, connected, signMessage } = useWallet()
  const { connection } = useConnection()
  const sendTransaction = useSendTransactionForWallet()
  const { setVisible } = useWalletModal()
  const searchParams = useSearchParams()
  const preselectedPoolId = searchParams.get('pool')

  const [pools, setPools] = useState<StakingPoolRow[]>([])
  const [positions, setPositions] = useState<StakingPositionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [stakeSuccessMessage, setStakeSuccessMessage] = useState<string | null>(null)
  const [claimLedgerNotice, setClaimLedgerNotice] = useState<string | null>(null)

  const [stakePoolId, setStakePoolId] = useState('')
  const [stakeAmount, setStakeAmount] = useState('')
  const [stakeAssetId, setStakeAssetId] = useState('')
  const [stakeTxPhase, setStakeTxPhase] = useState<NestingTxPhase>('idle')
  const [posPhases, setPosPhases] = useState<
    Record<string, { claim: NestingTxPhase; unstake: NestingTxPhase }>
  >({})
  const [securityAck, setSecurityAck] = useState(false)
  const [viewerIsAdmin, setViewerIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && publicKey ? getCachedAdmin(publicKey.toBase58()) : null
  )
  const [adminBypassSellout, setAdminBypassSellout] = useState(false)
  /** Rare: user opens hidden field to paste a mint (indexer miss or custom setup) */
  const [manualMintOpen, setManualMintOpen] = useState(false)
  /** Same flag — kept so partial refreshes / older chunks that still read `nestMintManual` never throw. */
  const nestMintManual = manualMintOpen
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

  const walletAddr = publicKey?.toBase58() ?? ''

  const loadPools = useCallback(async () => {
    try {
      const res = await fetch('/api/staking/pools', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return
      setPools(Array.isArray(json.pools) ? json.pools : [])
    } catch {
      /* ignore */
    }
  }, [])

  const loadPositions = useCallback(async () => {
    if (!connected || !publicKey) return
    const addr = publicKey.toBase58()
    const res = await fetch('/api/me/staking/positions', {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'X-Connected-Wallet': addr },
    })
    if (res.status === 401) {
      setNeedsSignIn(true)
      setPositions([])
      return false
    }
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(typeof json?.error === 'string' ? json.error : 'Failed to load positions')
      return false
    }
    setNeedsSignIn(false)
    setPositions(Array.isArray(json.positions) ? json.positions : [])
    return true
  }, [connected, publicKey])

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
    const ok = await loadPositions()
    if (
      !ok &&
      typeof window !== 'undefined' &&
      isMobileDevice() &&
      document.visibilityState === 'visible'
    ) {
      await new Promise((r) => setTimeout(r, MOBILE_401_RETRY_MS))
      await loadPositions()
    }
    setLoading(false)
  }, [connected, publicKey, loadPools, loadPositions])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (!stakeSuccessMessage) return
    const t = window.setTimeout(() => setStakeSuccessMessage(null), 12_000)
    return () => window.clearTimeout(t)
  }, [stakeSuccessMessage])

  const [rewardsNowMs, setRewardsNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setRewardsNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    try {
      setSecurityAck(sessionStorage.getItem(NESTING_SECURITY_ACK_STORAGE_KEY) === '1')
    } catch {
      setSecurityAck(false)
    }
  }, [])

  useEffect(() => {
    try {
      setAdminBypassSellout(sessionStorage.getItem(NESTING_ADMIN_SELLOUT_BYPASS_STORAGE_KEY) === '1')
    } catch {
      setAdminBypassSellout(false)
    }
  }, [])

  const setSecurityAckPersisted = useCallback((next: boolean) => {
    setSecurityAck(next)
    try {
      sessionStorage.setItem(NESTING_SECURITY_ACK_STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* private mode / storage full */
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

  useEffect(() => {
    if (pools.length === 0) return
    if (preselectedPoolId && pools.some((p) => p.id === preselectedPoolId)) {
      setStakePoolId(preselectedPoolId)
      return
    }
    if (pools.length === 1) {
      setStakePoolId((id) => (id && pools.some((p) => p.id === id) ? id : pools[0].id))
    }
  }, [preselectedPoolId, pools])

  const poolById = useMemo(() => {
    const m = new Map<string, StakingPoolRow>()
    for (const p of pools) m.set(p.id, p)
    return m
  }, [pools])

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

  const stakedNftGalleryItems = useMemo(
    () =>
      positions
        .filter(
          (p) =>
            Boolean(p.asset_identifier?.trim()) &&
            (p.status === 'active' || p.status === 'pending')
        )
        .map((p) => {
          const mint = p.asset_identifier!.trim()
          return {
            position: p,
            poolName: poolById.get(p.pool_id)?.name ?? `Perch ${p.pool_id.slice(0, 8)}…`,
            walletHint: nestingWalletMintHints.get(mint) ?? null,
          }
        }),
    [positions, poolById, nestingWalletMintHints]
  )

  const selectedPerch = useMemo(
    () => (stakePoolId ? pools.find((p) => p.id === stakePoolId) : undefined),
    [pools, stakePoolId]
  )

  /** Single active staking row (canonical Owl Nest deployment). */
  const solePerch = pools.length === 1 ? pools[0] : null

  /**
   * Perch the UI should treat as fixed for this session—either the only
   * perch on the platform (`solePerch`) or one the user navigated to via
   * `?pool=<id>` (e.g. tapping "Nest here" on a specific perch card).
   * In either case we hide the perch picker so it can't be swapped out.
   */
  const lockedPerch = useMemo(() => {
    if (solePerch) return solePerch
    if (preselectedPoolId) {
      return pools.find((p) => p.id === preselectedPoolId) ?? null
    }
    return null
  }, [solePerch, preselectedPoolId, pools])

  const nftMintRequired = selectedPerch?.asset_type === 'nft'
  const tokenStakeRequired = selectedPerch?.asset_type === 'token'

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

  const selectedOwlNestMintRow = useMemo(() => {
    const id = stakeAssetId.trim()
    if (!id) return null
    return owlNestMintScan.mints.find((m) => m.mint === id) ?? null
  }, [stakeAssetId, owlNestMintScan.mints])

  useEffect(() => {
    setManualMintOpen(false)
    owlNestFetchAbortRef.current?.abort()
    owlNestLastLoadedPoolIdRef.current = null
    if (!nftMintRequired || !stakePoolId) {
      setOwlNestMintScan({ status: 'idle', mints: [], configured: true })
      return
    }
    setOwlNestMintScan({ status: 'idle', mints: [], configured: true })
    setStakeAssetId('')
  }, [nftMintRequired, stakePoolId])

  useEffect(() => {
    return () => owlNestFetchAbortRef.current?.abort()
  }, [])

  const loadOwlNestNftsFromWallet = useCallback(async () => {
    if (!connected || !publicKey || needsSignIn || loading || error !== null) return
    if (!nftMintRequired || !stakePoolId) return

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
        `/api/me/nesting/wallet-owl-nest-nfts?pool_id=${encodeURIComponent(stakePoolId)}`,
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
        owlNestLastLoadedPoolIdRef.current = stakePoolId
        setOwlNestMintScan({
          status: 'done',
          mints: [],
          configured: true,
          hint: typeof raw?.error === 'string' ? raw.error : 'Could not scan wallet for Owl Nest NFTs.',
          resolvedCollectionAddress: undefined,
        })
        return
      }
      if (raw?.configured === false) {
        owlNestLastLoadedPoolIdRef.current = stakePoolId
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
      owlNestLastLoadedPoolIdRef.current = stakePoolId
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
      owlNestLastLoadedPoolIdRef.current = stakePoolId
      setOwlNestMintScan({
        status: 'done',
        mints: [],
        configured: true,
        hint: 'Network error while loading Owl Nest NFTs.',
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
    stakePoolId,
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
    if (!nftMintRequired || !stakePoolId) return
    if (!connected || !publicKey || needsSignIn || loading || error !== null) return
    if (owlNestScanStatusRef.current !== 'done') return
    const loadedFor = owlNestLastLoadedPoolIdRef.current
    if (loadedFor !== stakePoolId) return
    void loadOwlNestNftsRef.current()
    // Intentionally keyed on nested set + perch only — avoids re-scan when `loading` flips during unrelated dashboard refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [nestedActiveMintKey, nftMintRequired, stakePoolId])

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

  const showManualMintInput =
    nftMintRequired &&
    (nestMintManual ||
      (owlNestMintScan.status === 'done' && !owlNestMintScan.configured))

  useEffect(() => {
    if (nestMintManual) return
    if (owlNestMintScan.status !== 'done') return
    if (!owlNestMintScan.configured) return
    if (owlNestMintScan.mints.length === 1) {
      setStakeAssetId(owlNestMintScan.mints[0].mint)
    } else if (owlNestMintScan.mints.length === 0) {
      setStakeAssetId('')
    }
    // Intentionally keyed on the stable mint key, not the array instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- owlNestEligibleMintsKey captures owlNestMintScan.mints
  }, [nestMintManual, owlNestMintScan.status, owlNestMintScan.configured, owlNestEligibleMintsKey])

  const totals = useMemo(() => {
    let nested = 0
    let estRaw = 0
    let claimed = 0
    for (const pos of positions) {
      nested += Number(pos.amount)
      claimed += Number(pos.claimed_rewards)
      if (pos.status === 'active') {
        estRaw += estimateClaimableRewards({
          amount: Number(pos.amount),
          rewardRateSnapshot: Number(pos.reward_rate_snapshot),
          rewardRateUnitSnapshot: pos.reward_rate_unit_snapshot as RewardRateUnit,
          claimedRewards: Number(pos.claimed_rewards),
          stakedAtMs: new Date(pos.staked_at).getTime(),
          asOfMs: rewardsNowMs,
        })
      }
    }
    const est = estRaw
    const activeCount = positions.filter((p) => p.status === 'active').length
    return { nested, est, claimed, activeCount }
  }, [positions, rewardsNowMs])

  const handleSignIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setSignInError('Your wallet does not support message signing.')
      return
    }
    setSignInError(null)
    setSigningIn(true)
    try {
      const addr = publicKey.toBase58()
      const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(addr)}`, {
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
      setSignInError(e instanceof Error ? e.message : 'Sign-in failed')
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

  const handleStake = async () => {
    if (!publicKey) return
    setActionError(null)
    setStakeSuccessMessage(null)
    const pool_id = stakePoolId.trim()
    const amountNum = Number(stakeAmount)
    const body: Record<string, unknown> = { pool_id }
    const pool = pools.find((p) => p.id === pool_id)
    if (!pool) {
      setActionError('Choose a perch first.')
      return
    }
    if (pool.asset_type === 'token') {
      if (Number.isNaN(amountNum) || amountNum <= 0) {
        setActionError('Enter a positive amount.')
        return
      }
      body.amount = amountNum
    } else {
      body.amount = Number.isFinite(amountNum) && amountNum > 0 ? amountNum : 1
    }
    if (stakeAssetId.trim()) body.asset_identifier = stakeAssetId.trim()
    if (viewerIsAdmin === true && adminBypassSellout) {
      body.bypass_nesting_sellout_gate = true
    }

    try {
      await runNestingTxAction({
        onPhase: setStakeTxPhase,
        async execute() {
          const res = await fetch('/api/me/staking/stake', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-Connected-Wallet': publicKey.toBase58(),
            },
            body: JSON.stringify(body),
          })
          const json = (await res.json().catch(() => ({}))) as {
            error?: string
            position?: StakingPositionRow
            execution?: { path?: string }
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
            setActionError(err)
            throw new Error('stake')
          }
          if (
            pool.asset_type === 'token' &&
            json.execution?.path === 'onchain_token_transfer_required'
          ) {
            const positionId = json.position?.id
            if (!positionId) {
              setActionError('Stake was prepared, but the position id was missing.')
              throw new Error('stake')
            }
            setStakeTxPhase('awaiting_wallet_signature')
            const signature = await sendOnChainTokenStakeTransfer(pool, stakeAmount)
            setStakeTxPhase('syncing')
            const syncRes = await fetch('/api/me/staking/sync', {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                'X-Connected-Wallet': publicKey.toBase58(),
              },
              body: JSON.stringify({ position_id: positionId, signature, kind: 'stake' }),
            })
            const syncJson = (await syncRes.json().catch(() => ({}))) as { error?: string }
            if (!syncRes.ok) {
              setActionError(typeof syncJson.error === 'string' ? syncJson.error : 'Could not confirm stake on-chain')
              throw new Error('stake')
            }
          }
          return json
        },
        afterSuccess: async () => {
          setStakeAmount('')
          setStakeAssetId('')
          await loadPositions()
          await loadPools()
        },
      })
      setStakeSuccessMessage(
        pool.asset_type === 'nft'
          ? 'Nest opened successfully — your Owl Nest NFT is on file and OWL rewards will accrue for this perch. Claim anytime from your nests below.'
          : 'Nest opened successfully — your stake is on file for this perch. Claim anytime from your nests below.'
      )
    } catch (e) {
      if (e instanceof Error && e.message === 'stake') return
      setActionError(e instanceof Error ? e.message : 'Stake failed')
    }
  }

  const handleUnstake = async (positionId: string) => {
    if (!publicKey) return
    setActionError(null)
    try {
      await runNestingTxAction({
        onPhase: (p) => setPosSubPhase(positionId, 'unstake', p),
        async execute() {
          const res = await fetch('/api/me/staking/unstake', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-Connected-Wallet': publicKey.toBase58(),
            },
            body: JSON.stringify({ position_id: positionId }),
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
      setActionError(e instanceof Error ? e.message : 'Unstake failed')
    }
  }

  const handleClaim = async (positionId: string, amount: number) => {
    if (!publicKey) return
    setActionError(null)
    setClaimLedgerNotice(null)
    try {
      const claimJson = await runNestingTxAction({
        onPhase: (p) => setPosSubPhase(positionId, 'claim', p),
        async execute() {
          const res = await fetch('/api/me/staking/claim', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-Connected-Wallet': publicKey.toBase58(),
            },
            body: JSON.stringify({ position_id: positionId, amount }),
          })
          const json = (await res.json().catch(() => ({}))) as {
            error?: string
            claimable?: number
            claimed_rewards_total?: number
            transaction_signature?: string | null
            execution?: { path?: 'onchain_transfer' | 'database_only' }
          }
          if (!res.ok) {
            const err =
              res.status === 501
                ? typeof json.error === 'string'
                  ? json.error
                  : 'This perch is not open yet.'
                : typeof json.error === 'string'
                  ? json.error
                  : 'Claim failed'
            setActionError(err)
            throw new Error('claim')
          }
          return json
        },
        afterSuccess: async () => {
          await loadPositions()
        },
      })

      const total = claimJson.claimed_rewards_total
      if (typeof total === 'number' && Number.isFinite(total)) {
        setPositions((prev) =>
          prev.map((p) => (p.id === positionId ? { ...p, claimed_rewards: total } : p))
        )
      }

      if (claimJson.execution?.path === 'database_only') {
        setClaimLedgerNotice(
          'This claim was recorded in the app only (no on-chain OWL transfer). Your wallet will not change until the reward treasury sends SPL, or you turn off local-only mode.'
        )
      }

      const sig =
        typeof claimJson.transaction_signature === 'string' ? claimJson.transaction_signature.trim() : ''
      if (sig) {
        const dev = /devnet/i.test(resolvePublicSolanaRpcUrl())
        window.open(
          `https://solscan.io/tx/${encodeURIComponent(sig)}${dev ? '?cluster=devnet' : ''}`,
          '_blank',
          'noopener,noreferrer'
        )
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'claim') throw e
      setActionError(e instanceof Error ? e.message : 'Claim failed')
    }
  }

  if (!connected) {
    return (
      <main className="relative mx-auto max-w-2xl px-4 py-10 safe-area-bottom">
        <div className="rounded-2xl border border-border/60 bg-card/80 p-6 space-y-4">
          <Egg className="h-10 w-10 text-theme-prime" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">Your nest</h1>
          <p className="text-muted-foreground">
            Connect your wallet to browse perches and open a nest—Owltopia walks you through each step.
          </p>
          <Button
            type="button"
            variant="outline"
            className={cn(nestingMutedActionButtonClass)}
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
      <main className="container mx-auto px-4 py-10 max-w-4xl flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
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
          Say hi with one wallet message so we can pull up your nests—no gas fees, just a signature.
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

      {actionError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError}
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

      {stakeSuccessMessage ? (
        <div
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.09] px-4 py-3 text-sm text-foreground shadow-[0_0_20px_rgba(0,255,136,0.08)]"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="flex min-w-0 flex-1 gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-theme-prime mt-0.5" aria-hidden />
              <p className="leading-relaxed text-foreground/95">{stakeSuccessMessage}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] shrink-0 touch-manipulation border-emerald-500/35 bg-background/80 sm:self-center"
              onClick={() => setStakeSuccessMessage(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <NestingSecurityNotice acknowledged={securityAck} onAcknowledgedChange={setSecurityAckPersisted} />

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
          },
          { label: 'Open nests', value: String(totals.activeCount) },
          { label: 'Ready to claim', value: totals.est.toFixed(6) },
          { label: 'Rewards claimed', value: totals.claimed.toFixed(6) },
        ].map(({ label, value }) => (
          <Card key={label} className="rounded-xl border-border/60 bg-card/90">
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-lg font-mono tabular-nums">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <section className="space-y-4">
        <SectionHeader
          title="Open a nest"
          description={
            solePerch
              ? 'Everyone uses the same Owl Nest perch: 365-day lock, 1 OWL per day per NFT. Connect your wallet, pick the Owl Nest NFT we find in your wallet for this collection, then confirm—the collection is fixed; no address hunt unless something is missing.'
              : 'Like a swap: you tuck in an amount, pick where it earns, then confirm. Owl Nest NFT perches load eligible NFTs from your wallet automatically; mint entry is only a fallback.'
          }
        />
        <div className="relative rounded-2xl border border-emerald-500/25 bg-gradient-to-b from-card/90 via-card/60 to-black/50 p-2 sm:p-3 shadow-[0_0_48px_rgba(0,255,136,0.07)]">
          {/* Top: amount in (swap "from") */}
          <div className="rounded-xl border border-emerald-500/20 bg-black/40 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>You tuck in</span>
              <span className="font-medium text-theme-prime/90">
                {selectedPerch
                  ? perchAssetKindLabel(selectedPerch.asset_type)
                  : lockedPerch
                    ? perchAssetKindLabel(lockedPerch.asset_type)
                    : 'Pick a perch below'}
              </span>
            </div>
            <Label htmlFor="stake-amt" className="sr-only">
              Amount to nest
            </Label>
            <Input
              id="stake-amt"
              inputMode="decimal"
              placeholder={
                selectedPerch?.asset_type === 'nft' ? '1 — usual for NFTs' : '0.0'
              }
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              className="touch-manipulation mt-2 min-h-[52px] border-0 bg-transparent px-0 text-2xl font-semibold tabular-nums text-foreground placeholder:text-muted-foreground/45 focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-3xl sm:min-h-[56px]"
            />
            {!stakePoolId && !lockedPerch ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Tip: pick your perch below—the rate and lock apply to whatever you tuck in up here.
              </p>
            ) : null}
            {lockedPerch && lockedPerch.asset_type === 'nft' ? (
              <p className="mt-2 text-xs text-muted-foreground">
                One Owl Nest NFT counts as a nest of size 1—you can still type 1 above or leave it blank.
              </p>
            ) : null}
            {tokenStakeRequired ? (
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {!connected ? (
                      <>Connect wallet to see your {tokenStakeSymbol} balance.</>
                    ) : walletTokenScan.status === 'loading' ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        Reading {tokenStakeSymbol} balance…
                      </span>
                    ) : walletTokenScan.status === 'done' && walletTokenScan.uiAmount !== null ? (
                      <>
                        Balance{' '}
                        <span className="font-medium tabular-nums text-foreground/85">
                          {walletTokenScan.uiAmount.toLocaleString(undefined, {
                            maximumFractionDigits: walletTokenScan.decimals ?? 6,
                          })}
                        </span>{' '}
                        {tokenStakeSymbol}
                      </>
                    ) : walletTokenScan.status === 'done' && walletTokenScan.hint ? (
                      <span className="text-amber-400/90">Couldn’t read {tokenStakeSymbol}</span>
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
                      className="touch-manipulation rounded-md border border-emerald-500/40 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-theme-prime/90 hover:bg-emerald-500/10"
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
                      className="touch-manipulation rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-foreground/5"
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
            ) : null}
          </div>

          <div className="relative z-[1] flex justify-center -my-3" aria-hidden>
            <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-emerald-500/45 bg-[linear-gradient(145deg,rgba(10,28,18,0.98),rgba(6,18,12,0.98))] shadow-[0_4px_28px_rgba(0,0,0,0.45)]">
              <ArrowDown className="h-5 w-5 text-theme-prime drop-shadow-[0_0_8px_rgba(0,255,136,0.45)]" />
            </div>
          </div>

          {/* Bottom: destination perch (swap "to") */}
          <div className="rounded-xl border border-emerald-500/20 bg-black/40 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>You earn on this perch</span>
              {selectedPerch?.name ? (
                <span className="max-w-[55%] truncate text-right font-medium text-foreground/90">{selectedPerch.name}</span>
              ) : null}
            </div>
            {lockedPerch ? (
              <>
                <p className="mt-3 text-sm font-medium text-foreground">{lockedPerch.name}</p>
                {lockedPerch.description ? (
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{lockedPerch.description}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-emerald-500/15 pt-3 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    Reward {lockedPerch.reward_token ? `${lockedPerch.reward_token} · ` : ''}
                    <span className="font-medium text-theme-prime/90">
                      {formatRewardRate(Number(lockedPerch.reward_rate), lockedPerch.reward_rate_unit)}
                    </span>
                    {lockedPerch.asset_type === 'nft' ? ' per NFT' : ''}
                  </span>
                  <span className="text-border" aria-hidden>
                    ·
                  </span>
                  <span>
                    Lock{' '}
                    <span className="font-medium text-foreground/85">
                      {lockedPerch.lock_period_days === 0 ? 'none' : `${lockedPerch.lock_period_days} days`}
                    </span>
                  </span>
                </div>
              </>
            ) : (
              <>
                <Label htmlFor="stake-pool" className="mt-3 block text-sm font-medium text-foreground">
                  Choose perch
                </Label>
                <div className="relative mt-1.5">
                  <select
                    id="stake-pool"
                    aria-label="Choose perch to nest on"
                    className={cn(
                      'flex min-h-[48px] w-full appearance-none rounded-lg border border-emerald-500/30 bg-background/85 py-3 pl-3 pr-11 text-left text-base font-medium text-foreground ring-offset-background',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-prime/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      'touch-manipulation disabled:opacity-50'
                    )}
                    value={stakePoolId}
                    onChange={(e) => setStakePoolId(e.target.value)}
                  >
                    <option value="">Select a perch…</option>
                    {pools.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {perchAssetKindLabel(p.asset_type)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                </div>
                {selectedPerch ? (
                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-emerald-500/15 pt-3 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      Reward {selectedPerch.reward_token ? `${selectedPerch.reward_token} · ` : ''}
                      <span className="font-medium text-theme-prime/90">
                        {formatRewardRate(Number(selectedPerch.reward_rate), selectedPerch.reward_rate_unit)}
                      </span>
                    </span>
                    <span className="text-border" aria-hidden>
                      ·
                    </span>
                    <span>
                      Lock{' '}
                      <span className="font-medium text-foreground/85">
                        {selectedPerch.lock_period_days === 0 ? 'none' : `${selectedPerch.lock_period_days} days`}
                      </span>
                    </span>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="mt-3 space-y-2 rounded-xl border border-border/50 bg-black/30 px-3 py-3 sm:px-4">
            {tokenStakeRequired ? (
              <>
                <p className="text-sm font-medium text-foreground">
                  {tokenStakeSymbol} from your wallet
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Tap below to read just this perch&apos;s {tokenStakeSymbol} balance from your connected
                  wallet—no other tokens are touched.
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
              <>
                <Label htmlFor="stake-asset" className="text-sm text-foreground">
                  NFT mint or memo{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="stake-asset"
                  placeholder="Only if this perch needs to know which NFT you nested"
                  value={stakeAssetId}
                  onChange={(e) => setStakeAssetId(e.target.value)}
                  className="min-h-[44px] border-border/60 bg-background/70 font-mono text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">Owl Nest from your wallet</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Tap below to load NFTs for this perch’s collection from your connected wallet, then pick one to add to staking.
                </p>

                {stakeAssetId.trim() ? (
                  <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-black/25 p-3 touch-manipulation">
                    <NestingStakedAssetThumb
                      mint={stakeAssetId.trim()}
                      hintImageUrl={selectedOwlNestMintRow?.image ?? null}
                      name={selectedOwlNestMintRow?.name ?? null}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-muted-foreground">You’re nesting</p>
                      <p className="truncate text-sm font-medium text-foreground">
                        {selectedOwlNestMintRow?.name?.trim() || 'Owl Nest NFT'}
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {shortenAddress(stakeAssetId.trim(), 6)}
                      </p>
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
                      Load NFTs from wallet
                    </Button>
                    {!connected ? (
                      <p className="text-xs text-muted-foreground text-center">Connect your wallet first.</p>
                    ) : needsSignIn ? (
                      <p className="text-xs text-muted-foreground text-center">Sign in with your wallet to load NFTs.</p>
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
                    <span>Loading NFTs for this perch from your wallet…</span>
                  </div>
                ) : null}

                {owlNestMintScan.hint ? (
                  <p className="text-xs text-amber-400/90 leading-relaxed">{owlNestMintScan.hint}</p>
                ) : null}

                {owlNestMintScan.status === 'done' && owlNestMintScan.mints.length > 1 ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="owl-nest-picker" className="text-xs font-normal text-muted-foreground">
                      Choose one
                    </Label>
                    <select
                      id="owl-nest-picker"
                      aria-label="Choose Owl Nest NFT from wallet"
                      className={cn(
                        'flex min-h-[48px] w-full rounded-lg border border-emerald-500/30 bg-background/85 px-3 py-2 text-sm font-medium text-foreground',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-prime/50 focus-visible:ring-offset-2',
                        'touch-manipulation'
                      )}
                      value={
                        owlNestMintScan.mints.some((m) => m.mint === stakeAssetId) ? stakeAssetId : ''
                      }
                      onChange={(e) => {
                        setManualMintOpen(false)
                        setStakeAssetId(e.target.value)
                      }}
                    >
                      <option value="">Choose an Owl Nest NFT…</option>
                      {owlNestMintScan.mints.map((m) => (
                        <option key={m.mint} value={m.mint}>
                          {(m.name?.trim() && m.name.trim().slice(0, 88)) ||
                            shortenAddress(m.mint, 5)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {owlNestMintScan.status === 'done' && owlNestMintScan.mints.length === 1 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground/90">Ready to nest</span>
                      {' — '}
                      {owlNestMintScan.mints[0].name?.trim() ? (
                        <>{owlNestMintScan.mints[0].name.trim()}</>
                      ) : (
                        <>your Owl Nest NFT </>
                      )}
                      <span className="font-mono text-theme-prime/85">{` (${shortenAddress(owlNestMintScan.mints[0].mint, 5)})`}</span>
                      .
                    </p>
                  </div>
                ) : null}

                {owlNestMintScan.status === 'done' && owlNestMintScan.configured && owlNestMintScan.mints.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      No NFT from this perch’s collection showed up in the wallet we queried (
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
                      . Recheck you signed in with that same wallet on Solana mainnet, try Reload NFT list, or paste the mint if the indexer is behind.
                    </p>
                    {!nestMintManual ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-[44px] w-full touch-manipulation border-border/60 text-sm font-medium"
                        onClick={() => setManualMintOpen(true)}
                      >
                        Paste mint manually
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {owlNestMintScan.status === 'done' && owlNestMintScan.configured && owlNestMintScan.mints.length > 0 && !nestMintManual ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-[44px] h-auto w-full justify-center touch-manipulation py-2 text-xs text-muted-foreground underline-offset-4 hover:bg-transparent hover:text-foreground hover:underline"
                    onClick={() => setManualMintOpen(true)}
                  >
                    NFT not listed — paste mint manually
                  </Button>
                ) : null}

                {showManualMintInput ? (
                  <div className="space-y-1.5 border-t border-border/40 pt-3">
                    <Label htmlFor="stake-asset" className="text-xs font-medium text-muted-foreground">
                      {owlNestMintScan.configured ? 'Mint address (manual)' : 'Mint address'}
                    </Label>
                    <Input
                      id="stake-asset"
                      placeholder={
                        owlNestMintScan.configured
                          ? owlNestMintScan.mints.length > 0
                            ? 'Different NFT mint than listed above'
                            : 'Owl Nest NFT mint address'
                          : 'Owl Nest NFT mint address'
                      }
                      value={stakeAssetId}
                      onChange={(e) => setStakeAssetId(e.target.value)}
                      className="min-h-[44px] border-border/60 bg-background/70 font-mono text-sm"
                      autoComplete="off"
                      spellCheck={false}
                    />
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
                    Reload NFT list
                  </Button>
                ) : null}
              </>
            )}
          </div>

          <div className="mt-4 space-y-3 px-1 pb-1">
            <NestingActionStatusLine phase={stakeTxPhase} className="min-h-[1.25rem] text-center sm:text-left" />
            <Button
              type="button"
              variant="default"
              size="lg"
              className="min-h-[48px] w-full font-semibold text-base shadow-[0_0_22px_rgba(0,255,136,0.18)] hover:shadow-[0_0_28px_rgba(0,255,136,0.24)]"
              disabled={
                !securityAck ||
                stakeTxPhase !== 'idle' ||
                !stakePoolId ||
                (nftMintRequired && !stakeAssetId.trim())
              }
              onClick={() => void handleStake()}
            >
              {stakeTxPhase !== 'idle' ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
              {stakeTxPhase === 'idle' ? 'Confirm nest' : nestingTxPhaseLabel(stakeTxPhase)}
            </Button>
          </div>
        </div>
      </section>

      <section>
        <SectionHeader
          title="Your nests"
          description="Claim OWL anytime—use it in raffles right away or let it stack. Finish the countdown before you leave a nest."
        />
        {stakedNftGalleryItems.length > 0 ? (
          <div className="mb-6">
            <StakedNftNestGallery items={stakedNftGalleryItems} />
          </div>
        ) : null}
        {positions.length === 0 ? (
          <EmptyState title="No nests yet." body="Open one above or skim the public perches on the nesting page." />
        ) : (
          <ul className="grid gap-4">
            {positions.map((pos) => (
              <li key={pos.id} id={nestGalleryAnchorId(pos.id)} className="scroll-mt-24">
                <PositionCard
                  position={pos}
                  poolName={poolById.get(pos.pool_id)?.name ?? `Perch ${pos.pool_id.slice(0, 8)}…`}
                  stakedAssetHint={
                    pos.asset_identifier?.trim()
                      ? nestingWalletMintHints.get(pos.asset_identifier.trim()) ?? null
                      : null
                  }
                  onUnstake={handleUnstake}
                  onClaim={handleClaim}
                  claimPhase={posPhases[pos.id]?.claim ?? 'idle'}
                  unstakePhase={posPhases[pos.id]?.unstake ?? 'idle'}
                  actionsEnabled={securityAck}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground text-center">
        <Link href="/nesting" className="text-theme-prime underline-offset-4 hover:underline">
          What Owl Nesting is
        </Link>
      </p>
    </main>
  )
}

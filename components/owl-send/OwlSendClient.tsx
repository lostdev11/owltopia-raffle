'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import {
  AlertTriangle,
  Bird,
  CheckCircle2,
  Loader2,
  Send,
  Shield,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WalletNftPicker } from '@/components/WalletNftPicker'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { OwlSendSuccessBanner } from '@/components/owl-send/OwlSendSuccessBanner'
import {
  OwlSendSuccessDialog,
  owlSendSuccessItemsFromNftLines,
  type OwlSendSuccessState,
} from '@/components/owl-send/OwlSendSuccessDialog'
import { fetchWalletNftsWithRetry } from '@/lib/solana/fetch-wallet-nfts-api'
import {
  getWalletNfts,
  getWalletTokens,
  walletTokenDisplayName,
  type WalletNft,
  type WalletToken,
} from '@/lib/solana/wallet-tokens'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { isValidSolanaPubkey } from '@/lib/solana/validate-pubkey'
import { mergeDasNftsWithOnChainLocks } from '@/lib/owl-send/merge-onchain-nft-locks'
import { fetchNftLockOverlayByDerivedAtas } from '@/lib/owl-send/overlay-derived-atas'
import { findFrozenOwlSendMints } from '@/lib/owl-send/attribute-batch-failure'
import { findOwlSendCoreOwnerFrozenMints } from '@/lib/owl-send/find-core-owner-frozen'
import {
  gateOwlSendSpecialAssetSelection,
  isOwlSendCompressedNft,
  owlSendCanAddToSelection,
  owlSendFilterCompatibleSelection,
  owlSendNftProblemLabel,
  owlSendSelectionApprovalSize,
  owlSendSkippedFrozenNotice,
  partitionLiveFrozenForOwlSend,
  partitionOwlSendByFrozen,
} from '@/lib/owl-send/picker-eligibility'
import { isWalletNftTransferLocked } from '@/lib/solana/nft-transfer-lock'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { owlSendTokenAccountHint } from '@/lib/owl-send/resolve-spl-holder'
import { owlSendRetryHint } from '@/lib/owl-send/retry-hint'
import {
  isOwlSendFrozenTransferError,
  isOwlSendWalletExtensionError,
  walletAdapterLooksLikeJupiter,
} from '@/lib/owl-send/wallet-send-errors'
import { isJupiterBrowser } from '@/lib/utils'
import {
  buildTokenScatterLines,
  chunkOwlSendBatches,
  chunkOwlSendNftLines,
  collapseRecipientsToNftScatterPaste,
  expandNftScatterEntries,
  pairScatterLines,
  parseNftScatterEntries,
  parseTokenScatterEntries,
  type OwlSendLine,
  type OwlSendTokenScatterLine,
} from '@/lib/owl-send/batch'
import {
  applyPartialOwlSendBatchSuccess,
  buildResumeRemainingPlan,
  buildResumeSkippingFrozenPlan,
  collectSentMintsFromBatches,
  collectSentMintsFromLedger,
  splitOversizedOwlSendBatch,
} from '@/lib/owl-send/resume'
import {
  clearOwlSendNftDraft,
  loadOwlSendNftDraft,
  saveOwlSendNftDraft,
  type OwlSendNftSessionDraft,
} from '@/lib/owl-send/session-draft'
import {
  OWL_SEND_CHAIN_APPROVAL_GAP_MS,
  OWL_SEND_MAX_PER_TX,
  OWL_SEND_MAX_SELECT,
  OWL_SEND_MAX_SPECIAL_PER_TX,
  type OwlSendAssetTab,
  type OwlSendMode,
} from '@/lib/owl-send/constants'
import { owlSendNftSendButtonLabel } from '@/lib/owl-send/send-button-label'
import { isOwlSendPacketSizeError } from '@/lib/owl-send/tx-size'
import { buildOwlSendCostEstimate } from '@/lib/owl-send/cost-estimate'
import { formatOwlSendFeeSol, getOwlSendFeeSol, getOwlSendFeeSolForDiscount } from '@/lib/owl-send/fee'
import type { OwlSendHolderRoleName } from '@/lib/owl-send/holder-discount'
import { sendOwlSendNftBatch } from '@/lib/owl-send/send-batch'
import {
  buildOwlSendSplNftTransaction,
  type OwlSendSendPhase,
} from '@/lib/owl-send/send-spl-nft-batch'
import {
  owlSendBatchesCanSignAll,
  sendOwlSendSignedBatchGroup,
  walletSupportsOwlSendSignAll,
} from '@/lib/owl-send/sign-all'
import {
  OWL_SEND_BUILD_TIMEOUT_HINT,
  OWL_SEND_BUILD_TIMEOUT_MS,
  withOwlSendTimeout,
} from '@/lib/owl-send/confirm'
import { sendOwlSendTokenLines, sendOwlSendTokensToOne } from '@/lib/owl-send/send-tokens'
import { recordOwlSendLedger } from '@/lib/owl-send/record-ledger'
import { useOwlSendAdminAccess } from '@/lib/owl-send/use-owl-send-admin-access'
import {
  canAccessOwlSendCsv,
  isOwlSendCsvPublicClient,
} from '@/lib/owl-send/access'
import { thawOwlSendCoreOwnerFreezes } from '@/lib/owl-send/thaw-core-owner-freeze'
import { isOwlSendCoreOwnerFreezeError } from '@/lib/owl-send/mpl-core-owner-freeze'
import { OwlSendLedgerPanel } from '@/components/owl-send/OwlSendLedgerPanel'
import { OwlSendCsvImport } from '@/components/owl-send/OwlSendCsvImport'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import { cn } from '@/lib/utils'

type HolderFeeQuote = {
  discountBps: number
  discountPercent: number
  roleName: OwlSendHolderRoleName | null
  gen1Count: number
  gen2Count: number
  checkAvailable: boolean
}

type Props = {
  /** Server session admin hint; client also verifies via SIWS + /api/admin/check. */
  initialViewerIsAdmin: boolean
  isPublic: boolean
}

type BatchProgress = {
  index: number
  total: number
  status: 'pending' | 'ready' | 'sending' | 'done' | 'failed'
  signature?: string
  error?: string
  failedMints?: string[]
}

function shorten(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

export function OwlSendClient({ initialViewerIsAdmin, isPublic }: Props) {
  const { connection } = useConnection()
  const { publicKey, connected, wallet } = useWallet()
  const walletName = wallet?.adapter?.name ? String(wallet.adapter.name) : 'wallet'
  const usingJupiter =
    walletAdapterLooksLikeJupiter(walletName) ||
    (typeof window !== 'undefined' && isJupiterBrowser())
  const sendTransaction = useSendTransactionForWallet()
  const access = useOwlSendAdminAccess({ initialViewerIsAdmin, isPublic })
  const { signIn: siwsSignIn } = useSiwsSignIn()
  const ensureLedgerSiws = useCallback(() => siwsSignIn(), [siwsSignIn])

  const [assetTab, setAssetTab] = useState<OwlSendAssetTab>('nfts')
  const [mode, setMode] = useState<OwlSendMode>('send_to_one')
  const [nfts, setNfts] = useState<WalletNft[]>([])
  const [tokens, setTokens] = useState<WalletToken[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set())
  const [nftSearchQuery, setNftSearchQuery] = useState('')
  const [destination, setDestination] = useState('')
  const [scatterRaw, setScatterRaw] = useState('')
  /** Per-NFT recipient when randomize is off (keyed by mint). */
  const [scatterByMint, setScatterByMint] = useState<Record<string, string>>({})
  const [randomizeScatter, setRandomizeScatter] = useState(true)
  /** When randomize is off: false = one wallet for the whole selection (grouped). */
  const [pairPerNft, setPairPerNft] = useState(false)
  const [preparedLines, setPreparedLines] = useState<OwlSendLine[] | null>(null)
  const [batches, setBatches] = useState<OwlSendLine[][]>([])
  const [batchProgress, setBatchProgress] = useState<BatchProgress[]>([])
  const [activeBatch, setActiveBatch] = useState(0)
  const [retryMints, setRetryMints] = useState<string[]>([])
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [thawing, setThawing] = useState(false)
  const [cnftGate, setCnftGate] = useState<{
    title: string
    detail: string
    cnftMints: string[]
  } | null>(null)

  // Tokens tab
  const [tokenMode, setTokenMode] = useState<OwlSendMode>('send_to_one')
  const [tokenAmounts, setTokenAmounts] = useState<Record<string, string>>({})
  const [tokenDestination, setTokenDestination] = useState('')
  const [tokenScatterMint, setTokenScatterMint] = useState<string | null>(null)
  const [tokenScatterDefaultAmount, setTokenScatterDefaultAmount] = useState('')
  const [tokenScatterRaw, setTokenScatterRaw] = useState('')
  const [tokenBatches, setTokenBatches] = useState<OwlSendTokenScatterLine[][]>([])
  const [tokenBatchProgress, setTokenBatchProgress] = useState<BatchProgress[]>([])
  const [tokenActiveBatch, setTokenActiveBatch] = useState(0)
  const [tokenBusy, setTokenBusy] = useState(false)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [tokenSuccessSig, setTokenSuccessSig] = useState<string | null>(null)
  const [tokenSuccessDetail, setTokenSuccessDetail] = useState<string | null>(null)
  const [successPopup, setSuccessPopup] = useState<OwlSendSuccessState>(null)
  const [ledgerRefreshKey, setLedgerRefreshKey] = useState(0)
  const [sendPhase, setSendPhase] = useState<OwlSendSendPhase | null>(null)
  const [sendPhaseStartedAt, setSendPhaseStartedAt] = useState<number | null>(null)
  const [sendElapsedSec, setSendElapsedSec] = useState(0)
  const [pendingDraft, setPendingDraft] = useState<OwlSendNftSessionDraft | null>(null)
  const [resuming, setResuming] = useState(false)
  const [holderFee, setHolderFee] = useState<HolderFeeQuote | null>(null)
  const [holderFeeLoading, setHolderFeeLoading] = useState(false)

  const sendCancelledRef = useRef(false)

  const discountBps = holderFee?.discountBps ?? 0
  const feeSol = getOwlSendFeeSolForDiscount(discountBps)
  const baseFeeSol = getOwlSendFeeSol()
  const showAdminPreview = access.isAdmin && !isPublic
  const allowed = access.allowed
  const csvPublic = isOwlSendCsvPublicClient()
  const canUseCsv = canAccessOwlSendCsv({
    isAdmin: access.isAdmin,
    publicOverride: csvPublic,
  })
  /** Admins see CSV lint on production before the public flag; everyone sees it when public. */
  const csvImportVisible = canUseCsv

  const loadAssets = useCallback(async (): Promise<WalletNft[]> => {
    if (!publicKey) return []
    setLoadingAssets(true)
    setLoadError(null)
    try {
      const walletAddr = publicKey.toBase58()
      const api = await fetchWalletNftsWithRetry(walletAddr)
      // Derived ATA overlay — owner-scan getParsedTokenAccountsByOwner truncates on large
      // wallets and was wiping Gen2 freezes (tokenAccount stayed mint, frozen=false).
      const onChainLocks =
        api.nfts.length > 0
          ? await fetchNftLockOverlayByDerivedAtas({
              connection,
              owner: publicKey,
              mints: api.nfts.map((n) => n.mint),
            })
          : await getWalletNfts(connection, publicKey, {
              includeLocked: true,
              fetchMetadata: true,
            })
      const list =
        api.nfts.length > 0
          ? onChainLocks.length > 0
            ? mergeDasNftsWithOnChainLocks(api.nfts, onChainLocks, { treatMissingAsThawed: true })
            : api.nfts
          : onChainLocks
      setNfts(list)
      setSelectedMints((prev) => {
        if (prev.size === 0) return prev
        const allowed = new Set(list.map((n) => n.mint))
        const next = new Set([...prev].filter((m) => allowed.has(m)))
        return next.size === prev.size ? prev : next
      })
      const toks = await getWalletTokens(connection, publicKey)
      setTokens(toks)
      return list
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load wallet assets')
      return []
    } finally {
      setLoadingAssets(false)
    }
  }, [connection, publicKey])

  useEffect(() => {
    if (connected && publicKey) void loadAssets()
    else {
      setNfts([])
      setTokens([])
      setSelectedMints(new Set())
      setPendingDraft(null)
    }
  }, [connected, publicKey, loadAssets])

  useEffect(() => {
    if (!connected || !publicKey) {
      setHolderFee(null)
      setHolderFeeLoading(false)
      return
    }
    const wallet = publicKey.toBase58()
    let cancelled = false
    setHolderFeeLoading(true)
    void (async () => {
      try {
        const res = await fetch(
          `/api/owl-send/holder-fee?wallet=${encodeURIComponent(wallet)}&lines=1`,
          { cache: 'no-store' }
        )
        if (!res.ok) {
          if (!cancelled) setHolderFee(null)
          return
        }
        const data = (await res.json()) as Partial<HolderFeeQuote>
        if (cancelled) return
        setHolderFee({
          discountBps: typeof data.discountBps === 'number' ? data.discountBps : 0,
          discountPercent: typeof data.discountPercent === 'number' ? data.discountPercent : 0,
          roleName: (data.roleName as OwlSendHolderRoleName | null) ?? null,
          gen1Count: typeof data.gen1Count === 'number' ? data.gen1Count : 0,
          gen2Count: typeof data.gen2Count === 'number' ? data.gen2Count : 0,
          checkAvailable: data.checkAvailable !== false,
        })
      } catch {
        if (!cancelled) setHolderFee(null)
      } finally {
        if (!cancelled) setHolderFeeLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connected, publicKey])

  useEffect(() => {
    if (!publicKey || batches.length > 0) return
    const draft = loadOwlSendNftDraft(publicKey.toBase58())
    setPendingDraft(draft)
  }, [publicKey, batches.length])

  useEffect(() => {
    if (!publicKey || !preparedLines || batches.length < 1) return
    const incomplete = batchProgress.some((b) => b.status !== 'done')
    if (!incomplete) {
      clearOwlSendNftDraft()
      return
    }
    saveOwlSendNftDraft({
      version: 1,
      fromWallet: publicKey.toBase58(),
      mode,
      preparedLines,
      batches,
      batchProgress,
      activeBatch,
      updatedAt: Date.now(),
    })
  }, [publicKey, preparedLines, batches, batchProgress, activeBatch, mode])

  const selectedNfts = useMemo(
    () => nfts.filter((n) => selectedMints.has(n.mint)),
    [nfts, selectedMints]
  )
  const retryMintSet = useMemo(() => new Set(retryMints), [retryMints])
  const retryNftLabels = useMemo(() => {
    return retryMints.map((mint) => {
      const nft = nfts.find((n) => n.mint === mint)
      return nft?.name?.trim() || shorten(mint)
    })
  }, [retryMints, nfts])

  const nftScatterEntries = useMemo(() => parseNftScatterEntries(scatterRaw), [scatterRaw])
  const scatterRecipients = useMemo(
    () =>
      nftScatterEntries.some((e) => e.count != null && Number.isFinite(e.count))
        ? expandNftScatterEntries(nftScatterEntries)
        : nftScatterEntries.map((e) => e.recipient),
    [nftScatterEntries]
  )
  const pairedScatterRecipients = useMemo(
    () => selectedNfts.map((n) => (scatterByMint[n.mint] ?? '').trim()).filter(Boolean),
    [selectedNfts, scatterByMint]
  )
  const activeScatterRecipients = randomizeScatter ? scatterRecipients : pairedScatterRecipients
  const groupedPairWallet = useMemo(() => {
    for (const n of selectedNfts) {
      const v = scatterByMint[n.mint]
      if (v?.trim()) return v
    }
    return ''
  }, [selectedNfts, scatterByMint])
  const uniquePairedWallets = useMemo(() => {
    const seen = new Set<string>()
    for (const n of selectedNfts) {
      const w = (scatterByMint[n.mint] ?? '').trim()
      if (w) seen.add(w)
    }
    return [...seen]
  }, [selectedNfts, scatterByMint])
  const tokenScatterEntries = useMemo(
    () => parseTokenScatterEntries(tokenScatterRaw),
    [tokenScatterRaw]
  )

  const applyWalletToAllSelected = useCallback(
    (value: string) => {
      setScatterByMint((prev) => {
        const nextMap: Record<string, string> = { ...prev }
        for (const n of selectedNfts) nextMap[n.mint] = value
        return nextMap
      })
      setPreparedLines(null)
    },
    [selectedNfts]
  )

  // Keep newly selected NFTs on the shared wallet while grouped.
  useEffect(() => {
    if (mode !== 'scatter' || randomizeScatter || pairPerNft) return
    if (selectedNfts.length === 0) return
    const shared = groupedPairWallet.trim()
    if (!shared) return
    let needsFill = false
    for (const n of selectedNfts) {
      if (!(scatterByMint[n.mint] ?? '').trim()) {
        needsFill = true
        break
      }
    }
    if (!needsFill) return
    applyWalletToAllSelected(groupedPairWallet)
  }, [
    mode,
    randomizeScatter,
    pairPerNft,
    selectedNfts,
    groupedPairWallet,
    scatterByMint,
    applyWalletToAllSelected,
  ])

  const setRandomizeScatterMode = (next: boolean) => {
    setPreparedLines(null)
    setBatches([])
    setBatchProgress([])
    if (next) {
      // Bulk paste: fold per-NFT fields into wallet / wallet,N list.
      const fromFields = selectedNfts
        .map((n) => (scatterByMint[n.mint] ?? '').trim())
        .filter(Boolean)
      if (fromFields.length > 0) {
        setScatterRaw(collapseRecipientsToNftScatterPaste(fromFields))
      }
    } else {
      // Explicit pairing: expand wallet,N allotments onto each selected NFT.
      const addrs = expandNftScatterEntries(parseNftScatterEntries(scatterRaw))
      setScatterByMint((prev) => {
        const nextMap: Record<string, string> = { ...prev }
        selectedNfts.forEach((n, i) => {
          if (addrs[i]) nextMap[n.mint] = addrs[i]!
        })
        return nextMap
      })
      const unique = [...new Set(addrs.map((a) => a.trim()).filter(Boolean))]
      // Multiple distinct wallets from paste → per-NFT fields; one (or none) → grouped.
      setPairPerNft(unique.length > 1)
    }
    setRandomizeScatter(next)
  }

  const nftApprovalSize = useMemo(() => {
    const unique =
      mode === 'scatter'
        ? new Set(activeScatterRecipients.filter(Boolean)).size || 3
        : 1
    return owlSendSelectionApprovalSize(selectedNfts, { uniqueRecipients: unique })
  }, [selectedNfts, mode, activeScatterRecipients])

  const cost = useMemo(() => {
    if (preparedLines && preparedLines.length > 0) {
      return buildOwlSendCostEstimate({
        nftCount: preparedLines.length,
        batchCount: Math.max(1, batches.length),
        discountBps,
      })
    }
    const count = selectedNfts.length
    if (count < 1) return null
    return buildOwlSendCostEstimate({
      nftCount: count,
      batchCount: Math.ceil(count / nftApprovalSize),
      discountBps,
    })
  }, [preparedLines, batches.length, selectedNfts, discountBps, nftApprovalSize])

  const cancelInFlightSend = () => {
    sendCancelledRef.current = true
    setSendPhase(null)
    setSendPhaseStartedAt(null)
    setBatchProgress((prev) =>
      prev.map((b) =>
        b.status === 'sending'
          ? {
              ...b,
              status: 'failed',
              error:
                'Cancelled — approve may still complete in your wallet; check Solscan before retrying or use Resume remaining.',
            }
          : b
      )
    )
    setTokenBatchProgress((prev) =>
      prev.map((b) =>
        b.status === 'sending'
          ? {
              ...b,
              status: 'failed',
              error: 'Cancelled — approve may still complete in your wallet; check Solscan before retrying.',
            }
          : b
      )
    )
    setTokenBusy(false)
    setSessionError('Send cancelled. If a wallet popup is still open, reject it — then Retry or Resume remaining.')
    setTokenError('Send cancelled. If a wallet popup is still open, reject it.')
  }

  const toggleNft = (nft: WalletNft) => {
    setPreparedLines(null)
    setBatches([])
    setBatchProgress([])
    setSessionError(null)

    setSelectedMints((prev) => {
      const next = new Set(prev)
      if (next.has(nft.mint)) {
        next.delete(nft.mint)
        setCnftGate(null)
        return next
      }
      if (next.size >= OWL_SEND_MAX_SELECT) return prev

      const already = nfts.filter((n) => next.has(n.mint))
      const mix = owlSendCanAddToSelection({ selected: already, candidate: nft })
      if (!mix.ok) {
        setCnftGate({
          title: mix.title,
          detail: mix.detail,
          cnftMints: mix.cnftMints,
        })
        return prev
      }
      setCnftGate(null)
      next.add(nft.mint)
      return next
    })
  }

  const selectMints = (mints: string[]) => {
    setPreparedLines(null)
    setBatches([])
    setBatchProgress([])
    setSessionError(null)

    const currentSelected = nfts.filter((n) => selectedMints.has(n.mint))
    const mintSet = new Set(mints.map((m) => m.trim()).filter(Boolean))
    const candidates = nfts.filter((n) => mintSet.has(n.mint))
    const filtered = owlSendFilterCompatibleSelection({
      currentSelected,
      candidates,
    })
    if (filtered.gate && !filtered.gate.ok) {
      setCnftGate({
        title: filtered.gate.title,
        detail: filtered.gate.detail,
        cnftMints: filtered.gate.cnftMints,
      })
    } else {
      setCnftGate(null)
    }
    setSelectedMints(new Set(filtered.mints.slice(0, OWL_SEND_MAX_SELECT)))
  }

  /**
   * Thaw leftover nest locks: MPL Core Owner FreezeDelegate (wallet) and/or Gen2 SPL/CM (server).
   * Requires SIWS only for the Gen2 server path.
   */
  const thawFrozenMints = useCallback(
    async (
      mints: string[],
      opts?: { silent?: boolean }
    ): Promise<{ ok: boolean; thawedCount: number; error?: string }> => {
      if (!publicKey || mints.length < 1) return { ok: false, thawedCount: 0, error: 'Nothing to thaw.' }
      const adapter = wallet?.adapter
      setThawing(true)
      if (!opts?.silent) {
        setSessionError(null)
        setSessionNotice(null)
      }
      try {
        let thawedCount = 0
        const remainingForGen2: string[] = []

        // 1) Core Owner freeze (admin force-leave leftover) — holder wallet only.
        if (adapter) {
          const core = await thawOwlSendCoreOwnerFreezes({
            connection,
            wallet: adapter,
            sendTransaction,
            mints,
          })
          thawedCount += core.thawedCount
          for (const r of core.results) {
            if (r.skipToGen2) remainingForGen2.push(r.mint)
          }
          const coreHardErrors = core.results.filter((r) => r.error && !r.skipToGen2)
          if (coreHardErrors.length > 0 && remainingForGen2.length < 1 && core.thawedCount < 1) {
            const err = coreHardErrors[0]!.error!
            if (!opts?.silent) setSessionError(err)
            return { ok: false, thawedCount: 0, error: err }
          }
          if (coreHardErrors.length > 0 && !opts?.silent && core.thawedCount > 0) {
            setSessionNotice(
              `Thawed ${core.thawedCount} Core nest lock${core.thawedCount === 1 ? '' : 's'}. ${coreHardErrors.length} still need another try (RPC/wallet).`
            )
          }
        } else {
          remainingForGen2.push(...mints)
        }

        // 2) Gen2 nest / Candy Machine freeze — server thaw.
        if (remainingForGen2.length > 0) {
          const signedIn = await ensureLedgerSiws()
          if (!signedIn) {
            if (thawedCount > 0) {
              // Partial Core success is still useful.
              if (!opts?.silent) {
                setSessionNotice(
                  `Thawed ${thawedCount} Core nest lock${thawedCount === 1 ? '' : 's'}. Sign in to thaw any remaining Gen2 locks.`
                )
              }
              return { ok: true, thawedCount }
            }
            return { ok: false, thawedCount: 0, error: 'Sign in with your wallet to thaw frozen Gen2s.' }
          }
          const res = await fetch('/api/owl-send/thaw', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': 'application/json',
              'x-connected-wallet': publicKey.toBase58(),
            },
            body: JSON.stringify({ mints: remainingForGen2 }),
          })
          const data = (await res.json().catch(() => null)) as {
            ok?: boolean
            thawedCount?: number
            error?: string
            results?: Array<{ mint: string; ok: boolean; kind: string; error?: string }>
          } | null
          if (!res.ok) {
            const err = data?.error || 'Thaw request failed.'
            if (thawedCount < 1 && !opts?.silent) setSessionError(err)
            return { ok: thawedCount > 0, thawedCount, error: err }
          }
          thawedCount += data?.thawedCount ?? 0
          const activeNest = (data?.results ?? []).find((r) => r.kind === 'active_nest')
          if (activeNest?.error && !opts?.silent) {
            setSessionError(activeNest.error)
          } else if (thawedCount > 0 && !opts?.silent) {
            setSessionNotice(
              `Thawed ${thawedCount} lock${thawedCount === 1 ? '' : 's'}. Tap Retry to send.`
            )
            setRetryMints([])
          } else if (!data?.ok && data?.error && thawedCount < 1 && !opts?.silent) {
            setSessionError(data.error)
          }
          return {
            ok: thawedCount > 0 || data?.ok === true,
            thawedCount,
            error: data?.error,
          }
        }

        if (thawedCount > 0 && !opts?.silent) {
          setSessionNotice(
            `Thawed ${thawedCount} Core nest lock${thawedCount === 1 ? '' : 's'}. Tap Retry to send.`
          )
          setRetryMints([])
        }
        return { ok: thawedCount > 0, thawedCount }
      } catch (e) {
        const err = e instanceof Error ? e.message : 'Thaw failed.'
        if (!opts?.silent) setSessionError(err)
        return { ok: false, thawedCount: 0, error: err }
      } finally {
        setThawing(false)
      }
    },
    [publicKey, wallet?.adapter, connection, sendTransaction, ensureLedgerSiws]
  )

  const prepareNftSend = async () => {
    setSessionError(null)
    setSessionNotice(null)
    setRetryMints([])
    setCnftGate(null)
    if (!publicKey) {
      setSessionError('Connect your wallet first.')
      return
    }
    if (selectedNfts.length < 1) {
      setSessionError('Select at least one NFT.')
      return
    }
    if (selectedNfts.length > OWL_SEND_MAX_SELECT) {
      setSessionError(`Select at most ${OWL_SEND_MAX_SELECT} NFTs.`)
      return
    }

    // Auto-exclude nested/frozen Gen2s AND MPL Core Owner FreezeDelegate leftovers so they
    // cannot poison a multi-send batch. Prefer picker flags, then live ATA freeze + Core
    // FreezeDelegate reads (SPL ATA scans miss Core nest locks entirely).
    let { sendable, frozen: frozenSelected } = partitionOwlSendByFrozen(selectedNfts)
    try {
      const liveFrozen = await findFrozenOwlSendMints({
        connection,
        owner: publicKey,
        lines: sendable.map((n) => ({
          mint: n.mint,
          recipient: publicKey.toBase58(),
          tokenAccount: n.tokenAccount,
          name: n.name,
        })),
      })
      if (liveFrozen.length > 0) {
        // Do not treat pNFT rule-set freeze (no lock delegate) as nested Gen2 locks.
        const livePart = partitionLiveFrozenForOwlSend({
          candidates: sendable,
          liveFrozenMints: liveFrozen,
        })
        sendable = livePart.sendable
        if (livePart.frozen.length > 0) {
          frozenSelected = [...frozenSelected, ...livePart.frozen]
          const nestLocked = new Set(livePart.frozen.map((n) => n.mint))
          setNfts((prev) =>
            prev.map((n) => (nestLocked.has(n.mint) ? { ...n, frozen: true } : n))
          )
        }
      }
    } catch {
      /* keep partition flags */
    }
    try {
      const coreFrozenMints = await findOwlSendCoreOwnerFrozenMints({
        connection,
        lines: sendable.map((n) => ({
          mint: n.mint,
          compressed: n.compressed,
          interface: n.interface,
        })),
      })
      if (coreFrozenMints.length > 0) {
        const coreSet = new Set(coreFrozenMints.map((m) => m.trim()).filter(Boolean))
        const stillSendable: typeof sendable = []
        const coreFrozen: typeof frozenSelected = []
        for (const n of sendable) {
          if (coreSet.has(n.mint.trim())) coreFrozen.push({ ...n, frozen: true })
          else stillSendable.push(n)
        }
        sendable = stillSendable
        if (coreFrozen.length > 0) {
          frozenSelected = [...frozenSelected, ...coreFrozen]
          setNfts((prev) =>
            prev.map((n) => (coreSet.has(n.mint) ? { ...n, frozen: true } : n))
          )
        }
      }
    } catch {
      /* send path still surfaces Core Owner freeze with Thaw locks */
    }

    if (frozenSelected.length > 0) {
      setSelectedMints(new Set(sendable.map((n) => n.mint)))
      if (sendable.length < 1) {
        setSessionError(owlSendSkippedFrozenNotice(frozenSelected.length, 0))
        return
      }
      setSessionNotice(owlSendSkippedFrozenNotice(frozenSelected.length, sendable.length))
    }

    const specialGate = gateOwlSendSpecialAssetSelection(sendable)
    if (!specialGate.ok) {
      setCnftGate({
        title: specialGate.title,
        detail: specialGate.detail,
        cnftMints: specialGate.cnftMints,
      })
      return
    }

    let lines: OwlSendLine[]
    if (mode === 'send_to_one') {
      const dest = destination.trim()
      if (!isValidSolanaPubkey(dest)) {
        setSessionError('Enter a valid destination wallet.')
        return
      }
      if (dest === publicKey.toBase58()) {
        setSessionError('Destination is your own wallet.')
        return
      }
      lines = sendable.map((n) => ({
        mint: n.mint,
        name: n.name,
        tokenAccount: owlSendTokenAccountHint({
          mint: n.mint,
          owner: publicKey,
          tokenAccount: n.tokenAccount,
        }),
        image: n.image,
        compressed: n.compressed,
        interface: n.interface,
        recipient: dest,
      }))
    } else {
      const entries = randomizeScatter
        ? nftScatterEntries
        : sendable.map((n) => ({
            recipient: (scatterByMint[n.mint] ?? '').trim(),
            count: null as number | null,
          }))
      if (!randomizeScatter) {
        const missing = sendable.find((n) => !(scatterByMint[n.mint] ?? '').trim())
        if (missing) {
          setSessionError(
            `Enter a wallet for ${missing.name?.trim() || shorten(missing.mint)}.`
          )
          return
        }
      }
      const paired = pairScatterLines({
        mints: sendable.map((n) => ({
          mint: n.mint,
          name: n.name,
          tokenAccount: owlSendTokenAccountHint({
            mint: n.mint,
            owner: publicKey,
            tokenAccount: n.tokenAccount,
          }),
          image: n.image,
          compressed: n.compressed,
          interface: n.interface,
        })),
        entries,
        randomize: randomizeScatter,
      })
      if (!paired.ok) {
        setSessionError(paired.error)
        return
      }
      for (const r of paired.lines.map((l) => l.recipient)) {
        if (!isValidSolanaPubkey(r)) {
          setSessionError(`Invalid recipient wallet: ${r}`)
          return
        }
      }
      lines = paired.lines
    }

    setPreparing(true)
    try {
      const chunked = chunkOwlSendNftLines(lines)
      setPreparedLines(lines)
      setBatches(chunked)
      setBatchProgress(
        chunked.map((_, i) => ({
          index: i,
          total: chunked.length,
          status: i === 0 ? 'ready' : 'pending',
        }))
      )
      setActiveBatch(0)
    } finally {
      setPreparing(false)
    }
  }

  const runBatch = async (batchIndex: number) => {
    if (!publicKey || !preparedLines) return
    let workingPrepared = preparedLines
    let workingBatches = batches
    let workingProgress = batchProgress
    let workingIndex = batchIndex
    let lines = workingBatches[workingIndex]
    if (!lines?.length) return

    // Before every attempt (including Retry): drop nested/frozen so we never replay the
    // same poison batch. Covers Gen2 SPL freezes AND MPL Core Owner FreezeDelegate leftovers
    // (admin force-leave / closed nest) — SPL ATA scans miss Core locks entirely.
    try {
      const allPendingLines = workingBatches.flatMap((batch, i) => {
        const st = workingProgress[i]?.status
        if (st === 'done') return []
        return batch
      })
      const frozenInPlan =
        allPendingLines.length > 0
          ? await findFrozenOwlSendMints({
              connection,
              owner: publicKey,
              lines: allPendingLines,
            })
          : []
      const coreFrozenInPlan =
        allPendingLines.length > 0
          ? await findOwlSendCoreOwnerFrozenMints({
              connection,
              lines: allPendingLines,
            })
          : []
      const pickerFrozen = nfts.filter((n) => isWalletNftTransferLocked(n)).map((n) => n.mint)
      // Known poison from the failed approval card (Core freeze failedMints).
      const failedFreezeMints = workingProgress.flatMap((b) =>
        b.status === 'failed' && isOwlSendFrozenTransferError(b.error ?? '')
          ? (b.failedMints ?? [])
          : []
      )
      const frozenSet = new Set(
        [...frozenInPlan, ...coreFrozenInPlan, ...pickerFrozen, ...failedFreezeMints]
          .map((m) => m.trim())
          .filter(Boolean)
      )
      if (frozenSet.size > 0) {
        const plan = buildResumeSkippingFrozenPlan({
          preparedLines: workingPrepared,
          batches: workingBatches,
          batchProgress: workingProgress,
          frozenMints: frozenSet,
        })
        if (!plan.ok) {
          setBatchProgress((prev) =>
            prev.map((b) =>
              b.index === workingIndex
                ? { ...b, status: 'failed', error: plan.error, failedMints: [...frozenSet] }
                : b
            )
          )
          setRetryMints([...frozenSet])
          setSessionError(plan.error)
          return
        }
        if (plan.skippedFrozen > 0) {
          workingPrepared = plan.remaining
          workingBatches = plan.batches
          workingProgress = plan.batchProgress
          workingIndex = 0
          lines = workingBatches[0] ?? []
          setPreparedLines(workingPrepared)
          setBatches(workingBatches)
          setBatchProgress(workingProgress)
          setActiveBatch(0)
          setSelectedMints(new Set(workingPrepared.map((l) => l.mint)))
          setRetryMints([...frozenSet])
          setSessionNotice(
            `Skipped ${plan.skippedFrozen} nested/frozen NFT${plan.skippedFrozen === 1 ? '' : 's'} (incl. Core nest locks) — sending the rest. Use Thaw locks / Nesting for those separately.`
          )
          setNfts((prev) =>
            prev.map((n) => (frozenSet.has(n.mint) ? { ...n, frozen: true } : n))
          )
          if (!lines.length) return
        }
      }
    } catch {
      /* proceed with original lines */
    }

    sendCancelledRef.current = false
    setSessionError(null)
    setSuccessPopup(null)

    const remainingForSignAll = workingBatches.slice(workingIndex)
    const useSignAll =
      walletSupportsOwlSendSignAll(wallet?.adapter ?? null) &&
      owlSendBatchesCanSignAll(remainingForSignAll)

    if (useSignAll) {
      setActiveBatch(workingIndex)
      setSendPhase('building')
      setSendPhaseStartedAt(Date.now())
      workingProgress = workingProgress.map((b) =>
        b.index >= workingIndex && b.status !== 'done'
          ? { ...b, status: 'sending' as const, error: undefined }
          : b
      )
      setBatchProgress(workingProgress)

      try {
        const built: Array<{
          tx: import('@solana/web3.js').Transaction
          lines: OwlSendLine[]
          newAtaCount: number
        }> = []
        const queue = remainingForSignAll.map((batch) => [...batch])
        while (queue.length > 0) {
          if (sendCancelledRef.current) {
            setSendPhase(null)
            setSendPhaseStartedAt(null)
            return
          }
          const nextLines = queue.shift()!
          const builtOne = await withOwlSendTimeout(
            buildOwlSendSplNftTransaction({
              connection,
              owner: publicKey,
              lines: nextLines,
              feeDiscountBps: discountBps,
            }),
            OWL_SEND_BUILD_TIMEOUT_MS,
            OWL_SEND_BUILD_TIMEOUT_HINT
          )
          if (!builtOne.ok) {
            throw new Error(builtOne.error)
          }
          built.push({
            tx: builtOne.tx,
            lines: nextLines.slice(0, builtOne.includedCount),
            newAtaCount: builtOne.newAtaCount,
          })
          if (builtOne.includedCount < nextLines.length) {
            queue.unshift(nextLines.slice(builtOne.includedCount))
          }
        }

        const group = await sendOwlSendSignedBatchGroup({
          connection,
          owner: publicKey,
          walletAdapter: wallet?.adapter ?? null,
          built,
          onPhase: (phase) => {
            if (!sendCancelledRef.current) setSendPhase(phase)
          },
        })

        if (sendCancelledRef.current) {
          setSendPhase(null)
          setSendPhaseStartedAt(null)
          return
        }

        const accumulatedItems = group.flatMap((g, i) =>
          owlSendSuccessItemsFromNftLines(built[i]!.lines, { showRecipient: mode === 'scatter' })
        )
        workingProgress = workingProgress.map((b) => {
          if (b.index < workingIndex) return b
          const offset = b.index - workingIndex
          const row = group[offset]
          if (!row) return { ...b, status: 'pending' as const }
          return { ...b, status: 'done' as const, signature: row.signature }
        })
        if (built.length !== remainingForSignAll.length) {
          const rebuiltLines = [
            ...workingBatches.slice(0, workingIndex).flat(),
            ...built.flatMap((b) => b.lines),
          ]
          const rebuiltBatches = [
            ...workingBatches.slice(0, workingIndex),
            ...built.map((b) => b.lines),
          ]
          workingBatches = rebuiltBatches
          workingPrepared = rebuiltLines
          workingProgress = rebuiltBatches.map((_, i) => ({
            index: i,
            total: rebuiltBatches.length,
            status: (i < workingIndex
              ? workingProgress[i]?.status
              : 'done') as 'pending' | 'ready' | 'sending' | 'done' | 'failed',
            signature:
              i < workingIndex
                ? workingProgress[i]?.signature
                : group[i - workingIndex]?.signature,
          }))
        }
        setBatches(workingBatches)
        setPreparedLines(workingPrepared)
        setBatchProgress(workingProgress)
        setRetryMints([])
        setSendPhase(null)
        setSendPhaseStartedAt(null)
        for (let i = 0; i < group.length; i++) {
          const row = group[i]!
          void recordOwlSendLedger({
            fromWallet: publicKey.toBase58(),
            mode: mode === 'scatter' ? 'nft_scatter' : 'nft_one',
            assetKind: 'nft',
            txSignature: row.signature,
            batchIndex: workingIndex + i,
            feeDiscountBps: discountBps,
            lines: built[i]!.lines.map((l) => ({
              recipient: l.recipient,
              mint: l.mint,
              name: l.name ?? null,
            })),
            ensureSiws: ensureLedgerSiws,
          }).then(() => setLedgerRefreshKey((k) => k + 1))
        }
        setSuccessPopup({
          title:
            group.length > 1
              ? `All ${group.length} batches sent`
              : 'NFTs sent successfully',
          detail:
            mode === 'scatter'
              ? `${accumulatedItems.length} NFT${accumulatedItems.length === 1 ? '' : 's'} transferred in one wallet approval.`
              : `${accumulatedItems.length} NFT${accumulatedItems.length === 1 ? '' : 's'} transferred in one wallet approval.`,
          signature: group[group.length - 1]!.signature,
          items: accumulatedItems,
        })
        void loadAssets()
        return
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setSendPhase(null)
        setSendPhaseStartedAt(null)
        setBatchProgress((prev) =>
          prev.map((b) =>
            b.index === workingIndex
              ? { ...b, status: 'failed' as const, error: msg }
              : b.index > workingIndex && b.status === 'sending'
                ? { ...b, status: 'pending' as const }
                : b
          )
        )
        setActiveBatch(workingIndex)
        setSessionError(msg)
        return
      }
    }

    const chainStartIndex = workingIndex
    const accumulatedItems: ReturnType<typeof owlSendSuccessItemsFromNftLines> = []
    let lastSignature = ''
    let sentInChain = 0

    while (workingIndex < workingBatches.length) {
      lines = workingBatches[workingIndex]
      if (!lines?.length) break

      setActiveBatch(workingIndex)
      setSendPhase('building')
      setSendPhaseStartedAt(Date.now())
      workingProgress = workingProgress.map((b) =>
        b.index === workingIndex ? { ...b, status: 'sending', error: undefined } : b
      )
      setBatchProgress(workingProgress)
      setBatches(workingBatches)
      setPreparedLines(workingPrepared)

      const result = await sendOwlSendNftBatch({
        connection,
        owner: publicKey,
        walletAdapter: wallet?.adapter ?? null,
        sendTransaction,
        lines,
        feeDiscountBps: discountBps,
        onPhase: (phase) => {
          if (!sendCancelledRef.current) setSendPhase(phase)
        },
      })

      if (sendCancelledRef.current) {
        setSendPhase(null)
        setSendPhaseStartedAt(null)
        return
      }

      if (!result.ok) {
        const sizeSplit =
          isOwlSendPacketSizeError(result.error) || /too large/i.test(result.error)
            ? splitOversizedOwlSendBatch({
                batches: workingBatches,
                batchProgress: workingProgress,
                batchIndex: workingIndex,
                error: result.error,
              })
            : null
        setSendPhase(null)
        setSendPhaseStartedAt(null)
        if (sizeSplit) {
          setBatches(sizeSplit.batches)
          setPreparedLines(sizeSplit.batches.flat())
          setBatchProgress(sizeSplit.batchProgress)
          setSessionNotice(
            sentInChain > 0
              ? `${sentInChain} approval${sentInChain === 1 ? '' : 's'} already confirmed — this one was split so Retry can finish the rest.`
              : 'Split this approval so the next Retry fits in one Solana transaction.'
          )
          setActiveBatch(workingIndex)
          if (result.failedMints?.length) {
            setRetryMints((prev) => [...new Set([...prev, ...result.failedMints!])])
          }
          setSessionError(result.error)
          if (sentInChain > 0 && lastSignature) {
            setSuccessPopup({
              title:
                sentInChain === 1
                  ? 'Partial send — first approval ok'
                  : `Partial send — ${sentInChain} approvals ok`,
              detail: 'Remaining approvals were not sent. Tap Retry to continue the rest in one shot.',
              signature: lastSignature,
              items: accumulatedItems,
            })
          }
          return
        }

        const failedProgress = workingProgress.map((b) =>
          b.index === workingIndex
            ? {
                ...b,
                status: 'failed' as const,
                error: result.error,
                failedMints: result.failedMints,
              }
            : b
        )

        // Mid-chain: auto-skip nested/frozen (incl. Core Owner FreezeDelegate) and continue
        // remaining approvals — same outcome as "Skip frozen & retry" without a dead stop.
        if (isOwlSendFrozenTransferError(result.error)) {
          const poison = new Set(
            [...(result.failedMints ?? []), ...lines.map((l) => l.mint)]
              .map((m) => m.trim())
              .filter(Boolean)
          )
          try {
            const pendingTail = workingBatches.flatMap((batch, i) => {
              if (i < workingIndex) return []
              if (i === workingIndex) return batch
              const st = failedProgress[i]?.status
              if (st === 'done') return []
              return batch
            })
            const moreCore = await findOwlSendCoreOwnerFrozenMints({
              connection,
              lines: pendingTail,
            })
            for (const m of moreCore) poison.add(m)
          } catch {
            /* poison from failedMints is enough to unblock this approval */
          }

          const plan = buildResumeSkippingFrozenPlan({
            preparedLines: workingPrepared,
            batches: workingBatches,
            batchProgress: failedProgress,
            frozenMints: poison,
          })
          if (plan.ok && plan.skippedFrozen > 0) {
            workingPrepared = plan.remaining
            workingBatches = plan.batches
            workingProgress = plan.batchProgress
            workingIndex = 0
            setPreparedLines(workingPrepared)
            setBatches(workingBatches)
            setBatchProgress(workingProgress)
            setActiveBatch(0)
            setSelectedMints(new Set(workingPrepared.map((l) => l.mint)))
            setRetryMints([...poison])
            setSessionError(null)
            setSessionNotice(
              `Skipped ${plan.skippedFrozen} nested/frozen NFT${plan.skippedFrozen === 1 ? '' : 's'} (incl. Core nest locks) — continuing the rest. Use Thaw locks / Nesting for those separately.`
            )
            setNfts((prev) =>
              prev.map((n) => (poison.has(n.mint) ? { ...n, frozen: true } : n))
            )
            continue
          }
        }

        setBatches(workingBatches)
        setPreparedLines(workingPrepared)
        setBatchProgress(failedProgress)
        setActiveBatch(workingIndex)
        if (result.failedMints?.length) {
          setRetryMints((prev) => [...new Set([...prev, ...result.failedMints!])])
        }
        setSessionError(result.error)
        if (sentInChain > 0 && lastSignature) {
          setSuccessPopup({
            title:
              sentInChain === 1
                ? 'Partial send — first approval ok'
                : `Partial send — ${sentInChain} approvals ok`,
            detail: 'Remaining approvals were not sent. Tap Retry to continue the rest in one shot.',
            signature: lastSignature,
            items: accumulatedItems,
          })
        }
        return
      }

      const sentMintSet = new Set(result.sentMints?.length ? result.sentMints : lines.map((l) => l.mint))
      const sentLines = lines.filter((l) => sentMintSet.has(l.mint))
      const deferredLines = lines.filter((l) => !sentMintSet.has(l.mint))

      if (deferredLines.length > 0 && sentLines.length > 0) {
        const split = applyPartialOwlSendBatchSuccess({
          preparedLines: workingPrepared,
          batches: workingBatches,
          batchProgress: workingProgress,
          batchIndex: workingIndex,
          sentLines,
          deferredLines,
          signature: result.signature,
        })
        workingBatches = split.batches
        workingProgress = split.batchProgress
        workingPrepared = split.preparedLines
        setBatches(workingBatches)
        setBatchProgress(workingProgress)
        setPreparedLines(workingPrepared)
      } else {
        workingProgress = workingProgress.map((b) =>
          b.index === workingIndex
            ? { ...b, status: 'done' as const, signature: result.signature }
            : b.index === workingIndex + 1 && b.status === 'pending'
              ? { ...b, status: 'ready' as const }
              : b
        )
        setBatchProgress(workingProgress)
      }

      const sent = new Set(sentLines.map((l) => l.mint))
      setRetryMints((prev) => prev.filter((m) => !sent.has(m)))
      accumulatedItems.push(
        ...owlSendSuccessItemsFromNftLines(sentLines, {
          showRecipient: mode === 'scatter',
        })
      )
      lastSignature = result.signature
      sentInChain += 1

      void recordOwlSendLedger({
        fromWallet: publicKey.toBase58(),
        mode: mode === 'scatter' ? 'nft_scatter' : 'nft_one',
        assetKind: 'nft',
        txSignature: result.signature,
        batchIndex: workingIndex,
        feeDiscountBps: discountBps,
        lines: sentLines.map((l) => ({
          recipient: l.recipient,
          mint: l.mint,
          name: l.name ?? null,
        })),
        ensureSiws: ensureLedgerSiws,
      }).then(() => setLedgerRefreshKey((k) => k + 1))

      const hasMore = workingIndex + 1 < workingBatches.length
      if (!hasMore || sendCancelledRef.current) break

      workingIndex += 1
      setActiveBatch(workingIndex)
      await new Promise<void>((resolve) => setTimeout(resolve, OWL_SEND_CHAIN_APPROVAL_GAP_MS))
      if (sendCancelledRef.current) {
        setSendPhase(null)
        setSendPhaseStartedAt(null)
        return
      }
    }

    setSendPhase(null)
    setSendPhaseStartedAt(null)
    setBatches(workingBatches)
    setPreparedLines(workingPrepared)
    if (workingIndex + 1 < workingBatches.length) setActiveBatch(workingIndex + 1)

    const totalApprovals = workingBatches.length
    const remainingAtStart = totalApprovals - chainStartIndex
    const finishedRemaining = sentInChain >= remainingAtStart
    setSuccessPopup({
      title:
        finishedRemaining && chainStartIndex === 0 && totalApprovals > 1
          ? `All ${totalApprovals} approvals sent`
          : finishedRemaining && totalApprovals === 1
            ? 'NFTs sent successfully'
            : sentInChain > 1
              ? `${sentInChain} approvals sent`
              : totalApprovals > 1
                ? `Approval ${workingIndex + 1} of ${totalApprovals} sent`
                : 'NFTs sent successfully',
      detail:
        mode === 'scatter'
          ? `${accumulatedItems.length} NFT${accumulatedItems.length === 1 ? '' : 's'} transferred. Fee paid to Owltopia treasury.`
          : `${accumulatedItems.length} NFT${accumulatedItems.length === 1 ? '' : 's'} → ${shorten(workingBatches[chainStartIndex]?.[0]?.recipient ?? lines[0]?.recipient ?? '')}. Fee paid to Owltopia treasury.`,
      signature: lastSignature,
      items: accumulatedItems,
    })
    void loadAssets()
  }

  const fetchLedgerSentMints = async (wallet: string): Promise<Set<string>> => {
    try {
      const res = await fetch('/api/owl-send/ledger?limit=40', {
        credentials: 'include',
        headers: { 'x-connected-wallet': wallet },
        cache: 'no-store',
      })
      if (!res.ok) return new Set()
      const data = (await res.json()) as {
        sends?: Array<{
          asset_kind: string
          created_at: string
          lines: Array<{ mint?: string | null }>
        }>
      }
      return collectSentMintsFromLedger(data.sends ?? [])
    } catch {
      return new Set()
    }
  }

  const applyResumePlan = (plan: Extract<ReturnType<typeof buildResumeRemainingPlan>, { ok: true }>) => {
    setPreparedLines(plan.remaining)
    setBatches(plan.batches)
    setBatchProgress(plan.batchProgress)
    setActiveBatch(0)
    setSelectedMints(new Set(plan.remaining.map((l) => l.mint)))
    setRetryMints([])
    setSessionError(null)
    setPendingDraft(null)
    const skipped = plan.skippedSent + plan.skippedNotHeld
    setSessionNotice(
      skipped > 0
        ? `Resumed ${plan.remaining.length} NFT${plan.remaining.length === 1 ? '' : 's'} · skipped ${skipped} already sent or gone from wallet.`
        : `Ready to send ${plan.remaining.length} remaining NFT${plan.remaining.length === 1 ? '' : 's'}.`
    )
  }

  const resumeRemaining = async () => {
    if (!publicKey || !preparedLines?.length) return
    setResuming(true)
    setSessionError(null)
    setSessionNotice(null)
    try {
      const heldList = await loadAssets()
      const held = new Set(heldList.map((n) => n.mint))
      const sessionSent = collectSentMintsFromBatches(batches, batchProgress)
      const ledgerSent = await fetchLedgerSentMints(publicKey.toBase58())
      const sent = new Set([...sessionSent, ...ledgerSent])
      const plan = buildResumeRemainingPlan({
        preparedLines,
        sentMints: sent,
        stillHeldMints: held,
      })
      if (!plan.ok) {
        setSessionError(plan.error)
        return
      }
      applyResumePlan(plan)
    } finally {
      setResuming(false)
    }
  }

  const frozenNftCount = useMemo(() => nfts.filter((n) => isWalletNftTransferLocked(n)).length, [nfts])

  const deselectFrozenNfts = () => {
    setSelectedMints((prev) => {
      const next = new Set(prev)
      for (const n of nfts) {
        if (isWalletNftTransferLocked(n)) next.delete(n.mint)
      }
      return next
    })
    setRetryMints((prev) =>
      prev.filter((m) => !nfts.some((n) => n.mint === m && isWalletNftTransferLocked(n)))
    )
    setSessionNotice(
      frozenNftCount > 0
        ? `Deselected ${frozenNftCount} nested/frozen NFT${frozenNftCount === 1 ? '' : 's'}. Send the rest, or Thaw locks / unnest those first.`
        : null
    )
  }

  const restorePendingDraft = async () => {
    if (!pendingDraft || !publicKey) return
    const draft = pendingDraft

    // Drop nested/frozen mints from old drafts — restoring them used to replay the same
    // no-popup failures after Gen2 freeze flags were fixed. Include Core Owner freezes.
    let remainingLines = draft.preparedLines
    try {
      const liveFrozen = new Set(
        await findFrozenOwlSendMints({
          connection,
          owner: publicKey,
          lines: draft.preparedLines,
        })
      )
      for (const n of nfts) {
        if (isWalletNftTransferLocked(n)) liveFrozen.add(n.mint)
      }
      try {
        for (const m of await findOwlSendCoreOwnerFrozenMints({
          connection,
          lines: draft.preparedLines,
        })) {
          liveFrozen.add(m)
        }
      } catch {
        /* Gen2 + picker flags still apply */
      }
      if (liveFrozen.size > 0) {
        remainingLines = draft.preparedLines.filter((l) => !liveFrozen.has(l.mint.trim()))
      }
    } catch {
      const frozenSet = new Set(nfts.filter((n) => isWalletNftTransferLocked(n)).map((n) => n.mint))
      if (frozenSet.size > 0) {
        remainingLines = draft.preparedLines.filter((l) => !frozenSet.has(l.mint.trim()))
      }
    }

    if (remainingLines.length < 1) {
      clearOwlSendNftDraft()
      setPendingDraft(null)
      setSessionError(
        'That unfinished send only had nested/frozen NFTs left. Thaw locks or unnest them, then start a new send.'
      )
      return
    }

    const skippedFrozen = draft.preparedLines.length - remainingLines.length
    const newBatches = chunkOwlSendNftLines(remainingLines)
    const newProgress = newBatches.map((_, index) => ({
      index,
      total: newBatches.length,
      status: (index === 0 ? 'ready' : 'pending') as 'ready' | 'pending',
    }))

    setMode(draft.mode)
    setPreparedLines(remainingLines)
    setBatches(newBatches)
    setBatchProgress(newProgress)
    setActiveBatch(0)
    setSelectedMints(new Set(remainingLines.map((l) => l.mint)))
    setPendingDraft(null)
    setAssetTab('nfts')
    setSessionError(null)
    setSessionNotice(
      skippedFrozen > 0
        ? `Restored ${remainingLines.length} sendable NFT${remainingLines.length === 1 ? '' : 's'} · skipped ${skippedFrozen} nested/frozen. Use Resume remaining if some already left the wallet.`
        : 'Restored unfinished send. Use Resume remaining if some NFTs already left the wallet.'
    )
  }

  const dismissPendingDraft = () => {
    clearOwlSendNftDraft()
    setPendingDraft(null)
  }

  const prepareTokenScatter = () => {
    setTokenError(null)
    setTokenSuccessSig(null)
    setTokenBatches([])
    setTokenBatchProgress([])
    if (!publicKey) {
      setTokenError('Connect your wallet first.')
      return
    }
    const tok = tokens.find((t) => t.mint === tokenScatterMint)
    if (!tok) {
      setTokenError('Select a token to scatter.')
      return
    }
    const built = buildTokenScatterLines({
      mint: tok.mint,
      tokenAccount: tok.tokenAccount,
      decimals: tok.decimals,
      symbol: walletTokenDisplayName(tok),
      defaultAmountUi: tokenScatterDefaultAmount,
      entries: tokenScatterEntries,
    })
    if (!built.ok) {
      setTokenError(built.error)
      return
    }
    for (const line of built.lines) {
      if (!isValidSolanaPubkey(line.recipient)) {
        setTokenError(`Invalid recipient wallet: ${line.recipient}`)
        return
      }
    }
    const totalRaw = built.lines.reduce((sum, l) => sum + l.amountRaw, 0n)
    if (totalRaw > BigInt(tok.balance)) {
      setTokenError(`Insufficient balance for ${walletTokenDisplayName(tok)}.`)
      return
    }
    const chunked = chunkOwlSendBatches(built.lines)
    setTokenBatches(chunked)
    setTokenBatchProgress(
      chunked.map((_, i) => ({
        index: i,
        total: chunked.length,
        status: i === 0 ? 'ready' : 'pending',
      }))
    )
    setTokenActiveBatch(0)
  }

  const runTokenBatch = async (batchIndex: number) => {
    if (!publicKey) return
    const lines = tokenBatches[batchIndex]
    if (!lines?.length) return

    sendCancelledRef.current = false
    setTokenBusy(true)
    setTokenError(null)
    setTokenBatchProgress((prev) =>
      prev.map((b) => (b.index === batchIndex ? { ...b, status: 'sending', error: undefined } : b))
    )

    try {
      const result = await sendOwlSendTokenLines({
        connection,
        owner: publicKey,
        sendTransaction,
        lines,
        feeDiscountBps: discountBps,
      })
      if (sendCancelledRef.current) return
      if (result.ok) {
        setTokenBatchProgress((prev) =>
          prev.map((b) =>
            b.index === batchIndex
              ? { ...b, status: 'done', signature: result.signature }
              : b.index === batchIndex + 1 && b.status === 'pending'
                ? { ...b, status: 'ready' }
                : b
          )
        )
        if (batchIndex + 1 < tokenBatches.length) setTokenActiveBatch(batchIndex + 1)
        setSuccessPopup({
          title:
            tokenBatches.length > 1
              ? `Token batch ${batchIndex + 1} of ${tokenBatches.length} sent`
              : 'Tokens sent successfully',
          detail: `${lines.length} transfer${lines.length === 1 ? '' : 's'} · fee paid to Owltopia treasury.`,
          signature: result.signature,
        })
        void recordOwlSendLedger({
          fromWallet: publicKey.toBase58(),
          mode: 'token_scatter',
          assetKind: 'token',
          txSignature: result.signature,
          batchIndex,
          feeDiscountBps: discountBps,
          lines: lines.map((l) => ({
            recipient: l.recipient,
            mint: l.mint,
            symbol: l.symbol ?? null,
            amount_raw: l.amountRaw.toString(),
            decimals: l.decimals,
          })),
          ensureSiws: ensureLedgerSiws,
        }).then(() => setLedgerRefreshKey((k) => k + 1))
        void loadAssets()
      } else {
        setTokenBatchProgress((prev) =>
          prev.map((b) =>
            b.index === batchIndex ? { ...b, status: 'failed', error: result.error } : b
          )
        )
        setTokenError(result.error)
      }
    } finally {
      if (!sendCancelledRef.current) setTokenBusy(false)
    }
  }

  const sendTokensToOne = async () => {
    if (!publicKey) return
    setTokenError(null)
    setTokenSuccessSig(null)
    setTokenSuccessDetail(null)
    if (!isValidSolanaPubkey(tokenDestination)) {
      setTokenError('Enter a valid destination wallet.')
      return
    }
    const lines = []
    for (const t of tokens) {
      const raw = tokenAmounts[t.mint]?.trim()
      if (!raw) continue
      const ui = Number(raw)
      if (!Number.isFinite(ui) || ui <= 0) {
        setTokenError(`Invalid amount for ${walletTokenDisplayName(t)}`)
        return
      }
      const amountRaw = BigInt(Math.round(ui * 10 ** t.decimals))
      const bal = BigInt(t.balance)
      if (amountRaw > bal) {
        setTokenError(`Insufficient balance for ${walletTokenDisplayName(t)}`)
        return
      }
      lines.push({
        mint: t.mint,
        tokenAccount: t.tokenAccount,
        amountRaw,
        decimals: t.decimals,
        symbol: walletTokenDisplayName(t),
      })
    }
    if (lines.length < 1) {
      setTokenError('Enter an amount for at least one token.')
      return
    }
    if (lines.length > OWL_SEND_MAX_PER_TX) {
      setTokenError(`Max ${OWL_SEND_MAX_PER_TX} token lines per approval — clear some amounts.`)
      return
    }

    sendCancelledRef.current = false
    setTokenBusy(true)
    try {
      const result = await sendOwlSendTokensToOne({
        connection,
        owner: publicKey,
        recipient: tokenDestination.trim(),
        sendTransaction,
        lines,
        feeDiscountBps: discountBps,
      })
      if (sendCancelledRef.current) return
      if (result.ok) {
        const names = lines.map((l) => l.symbol).filter(Boolean)
        setTokenSuccessSig(result.signature)
        setTokenSuccessDetail(
          names.length === 1
            ? `Sent ${names[0]} to ${shorten(tokenDestination.trim())}.`
            : `Sent ${lines.length} tokens to ${shorten(tokenDestination.trim())}.`
        )
        setSuccessPopup({
          title: 'Tokens sent successfully',
          detail:
            names.length === 1
              ? `Sent ${names[0]} to ${shorten(tokenDestination.trim())}. Fee paid to Owltopia treasury.`
              : `Sent ${lines.length} tokens to ${shorten(tokenDestination.trim())}. Fee paid to Owltopia treasury.`,
          signature: result.signature,
        })
        void recordOwlSendLedger({
          fromWallet: publicKey.toBase58(),
          mode: 'token_one',
          assetKind: 'token',
          txSignature: result.signature,
          feeDiscountBps: discountBps,
          lines: lines.map((l) => ({
            recipient: tokenDestination.trim(),
            mint: l.mint,
            symbol: l.symbol ?? null,
            amount_raw: l.amountRaw.toString(),
            decimals: l.decimals,
          })),
          ensureSiws: ensureLedgerSiws,
        }).then(() => setLedgerRefreshKey((k) => k + 1))
        setTokenAmounts({})
        void loadAssets()
      } else {
        setTokenError(result.error)
      }
    } finally {
      if (!sendCancelledRef.current) setTokenBusy(false)
    }
  }

  const currentBatchCost = useMemo(() => {
    const lines = batches[activeBatch]
    if (!lines?.length) return null
    return buildOwlSendCostEstimate({ nftCount: lines.length, batchCount: 1, discountBps })
  }, [batches, activeBatch, discountBps])

  const doneCount = batchProgress.filter((b) => b.status === 'done').length
  const allDone = batches.length > 0 && doneCount === batches.length
  const nftSending = batchProgress.some((b) => b.status === 'sending')
  const canResumeRemaining =
    Boolean(preparedLines?.length) &&
    batches.length > 0 &&
    !allDone &&
    !nftSending &&
    (doneCount > 0 || batchProgress.some((b) => b.status === 'failed'))

  useEffect(() => {
    if (!nftSending || sendPhaseStartedAt == null) {
      setSendElapsedSec(0)
      return
    }
    const tick = () => setSendElapsedSec(Math.floor((Date.now() - sendPhaseStartedAt) / 1000))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [nftSending, sendPhaseStartedAt])

  const sendPhaseLabel =
    sendPhase === 'building'
      ? 'Building transaction (RPC)…'
      : sendPhase === 'approving'
        ? 'Approve in your wallet…'
        : sendPhase === 'confirming'
          ? 'Confirming on-chain…'
          : 'Waiting on wallet / network…'
  const tokenSending =
    tokenBusy || tokenBatchProgress.some((b) => b.status === 'sending')
  const tokenDoneCount = tokenBatchProgress.filter((b) => b.status === 'done').length
  const tokenAllDone = tokenBatches.length > 0 && tokenDoneCount === tokenBatches.length

  if (access.loading) {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    )
  }

  if (!allowed) {
    if (!connected || !publicKey) {
      return (
        <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
          <Bird className="h-10 w-10 text-theme-prime" />
          <h1 className="font-display text-3xl tracking-wide text-white">OwlSend</h1>
          <p className="text-sm text-muted-foreground">
            {isPublic
              ? 'Connect a wallet to send NFTs and tokens.'
              : 'Admin preview — connect an admin wallet to continue.'}
          </p>
          <WalletConnectButton />
        </div>
      )
    }
    if (access.denied) {
      return (
        <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
          <Bird className="h-10 w-10 text-theme-prime" />
          <h1 className="font-display text-3xl tracking-wide text-white">OwlSend</h1>
          <p className="text-sm text-muted-foreground">
            Coming soon. Only site admins can preview OwlSend before public launch.
          </p>
        </div>
      )
    }
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-3 py-6 sm:px-4 sm:py-10">
      <OwlSendSuccessDialog success={successPopup} onClose={() => setSuccessPopup(null)} />
      <Dialog
        open={Boolean(cnftGate)}
        onOpenChange={(open) => {
          if (!open) setCnftGate(null)
        }}
      >
        <DialogContent className="border-sky-500/30 bg-[#0c100e] sm:max-w-md">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="text-lg text-sky-100">
              {cnftGate?.title ?? 'Send separately'}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {cnftGate?.detail}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              type="button"
              className="min-h-[44px] w-full touch-manipulation"
              onClick={() => {
                const drop = new Set(cnftGate?.cnftMints ?? [])
                setSelectedMints((prev) => new Set([...prev].filter((m) => !drop.has(m))))
                setCnftGate(null)
                setPreparedLines(null)
                setBatches([])
                setBatchProgress([])
              }}
            >
              Deselect conflicting NFTs
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-[44px] w-full touch-manipulation"
              onClick={() => setCnftGate(null)}
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-theme-prime">
          <Bird className="h-6 w-6" />
          <p className="font-display text-3xl tracking-wide text-white sm:text-4xl">OwlSend</p>
        </div>
        <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
          Send NFTs and tokens for{' '}
          <span className="font-semibold text-theme-prime">{formatOwlSendFeeSol(feeSol)}</span> Owl
          fee each
          {discountBps > 0 ? (
            <>
              {' '}
              <span className="text-theme-prime/90">
                ({holderFee?.discountPercent ?? discountBps / 100}% holder discount
                {holderFee?.roleName ? ` · ${holderFee.roleName}` : ''})
              </span>
            </>
          ) : null}
          . Owltopia Gen1/Gen2 holders get up to 50% off. Solana rent is shown separately when a
          recipient needs a new token account.
        </p>
        {connected && publicKey && (holderFeeLoading || holderFee) ? (
          <p className="text-xs text-muted-foreground">
            {holderFeeLoading
              ? 'Checking Owltopia holder discount…'
              : holderFee && discountBps > 0
                ? `Holder rate: ${formatOwlSendFeeSol(feeSol)} / send (was ${formatOwlSendFeeSol(baseFeeSol)}) · Gen1 ${holderFee.gen1Count} · Gen2 ${holderFee.gen2Count}`
                : holderFee && !holderFee.checkAvailable
                  ? 'Holder discount check unavailable — standard Owl fee applies.'
                  : `Standard Owl fee ${formatOwlSendFeeSol(baseFeeSol)} / send · hold Gen1 or Gen2 for up to 50% off.`}
          </p>
        ) : null}
        {showAdminPreview ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            <Shield className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <span className="font-semibold">Admin preview</span> — not live for everyone yet. Test
              here, then set <code className="text-xs">OWL_SEND_PUBLIC=true</code> to open it up.
            </p>
          </div>
        ) : null}
      </header>

      {!connected || !publicKey ? (
        <Card className="border-white/10 bg-black/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wallet className="h-5 w-5" /> Connect wallet
            </CardTitle>
            <CardDescription>
              {access.isAdmin
                ? 'Admin session active — reconnect to load NFTs and start a transfer.'
                : 'Connect to load NFTs and start a transfer.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WalletConnectButton />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 rounded-lg border border-white/10 bg-black/30 p-1">
            {(
              [
                ['nfts', 'NFTs'],
                ['tokens', 'Tokens'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setAssetTab(id)}
                className={cn(
                  'min-h-[44px] flex-1 touch-manipulation rounded-md px-3 py-2 text-sm font-semibold transition',
                  assetTab === id
                    ? 'bg-emerald-500/20 text-theme-prime'
                    : 'text-muted-foreground hover:text-white'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {assetTab === 'nfts' ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="flex gap-2 rounded-lg border border-white/10 bg-black/30 p-1">
                  {(
                    [
                      ['send_to_one', 'One wallet'],
                      ['scatter', 'Many wallets'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setMode(id)
                        setPreparedLines(null)
                        setBatches([])
                        setBatchProgress([])
                      }}
                      className={cn(
                        'min-h-[44px] flex-1 touch-manipulation rounded-md px-3 py-2 text-sm font-semibold transition',
                        mode === id
                          ? 'bg-emerald-500/20 text-theme-prime'
                          : 'text-muted-foreground hover:text-white'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {mode === 'send_to_one'
                    ? 'All selected NFTs go to one destination (batches of 5).'
                    : 'Airdrop mode — paste wallets or wallet,N counts (must sum to selected NFTs).'}
                </p>
                {mode === 'send_to_one' && selectedNfts.length >= 2 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('scatter')
                      setPreparedLines(null)
                      setBatches([])
                      setBatchProgress([])
                    }}
                    className="w-full touch-manipulation rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-left text-xs text-sky-100 min-h-[44px]"
                  >
                    Sending to different wallets? Switch to <span className="font-semibold">Many wallets</span>{' '}
                    (Scatter) — paste {selectedNfts.length} addresses.
                  </button>
                ) : null}
              </div>

              <Card className="border-white/10 bg-black/40">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">Select NFTs</CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-[44px] touch-manipulation"
                      onClick={() => void loadAssets()}
                      disabled={loadingAssets}
                    >
                      {loadingAssets ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reload'}
                    </Button>
                  </div>
                  <CardDescription>
                    Up to {OWL_SEND_MAX_SELECT} NFTs ·{' '}
                    {nftApprovalSize === OWL_SEND_MAX_SPECIAL_PER_TX
                      ? `${OWL_SEND_MAX_SPECIAL_PER_TX} cNFT/pNFT per wallet approval (sequential)`
                      : `${nftApprovalSize} classic NFTs per wallet approval`}
                    {' · '}
                    cNFTs and classic NFTs can’t mix — you’ll get a prompt if you try
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadError ? (
                    <p className="mb-3 text-sm text-red-400">{loadError}</p>
                  ) : null}
                  {!loadingAssets && nfts.length > 0 ? (
                    <p className="mb-3 text-xs text-muted-foreground">
                      {nfts.length} NFT{nfts.length === 1 ? '' : 's'} in wallet
                      {frozenNftCount > 0 ? ` · ${frozenNftCount} nested/frozen` : ''}
                      {nfts.some(isOwlSendCompressedNft)
                        ? ` · ${nfts.filter(isOwlSendCompressedNft).length} cNFT`
                        : ''}
                      {retryMints.length > 0
                        ? ` · ${retryMints.length} highlighted from last failed send`
                        : ''}
                    </p>
                  ) : null}
                  {frozenNftCount > 0 ? (
                    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-50 sm:flex-row sm:items-center sm:justify-between">
                      <p>
                        <span className="font-semibold">{frozenNftCount} nested/frozen</span>{' '}
                        (often Gen2 nest locks) will be skipped at Review — they cannot open a
                        wallet approve. Deselect them, or Thaw locks / unnest first. Leftover CM
                        delegates alone are fine.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="min-h-[40px] shrink-0 touch-manipulation"
                        onClick={deselectFrozenNfts}
                      >
                        Deselect nested/frozen
                      </Button>
                    </div>
                  ) : null}
                  {loadingAssets && nfts.length === 0 ? (
                    <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading NFTs…
                    </div>
                  ) : (
                    <fieldset
                      disabled={nftSending}
                      className="min-w-0 disabled:opacity-60"
                    >
                      <WalletNftPicker
                        nfts={nfts}
                        searchQuery={nftSearchQuery}
                        onSearchQueryChange={setNftSearchQuery}
                        selectionMode="multi"
                        selectedMints={selectedMints}
                        onToggle={toggleNft}
                        maxSelect={OWL_SEND_MAX_SELECT}
                        onSelectFilteredMints={selectMints}
                        searchInputId="owl-send-nft-search"
                        dialogTitle="Select NFTs to send"
                        dialogDescription="Filter by collection, switch to list view, or search by name or mint — same controls as create raffle. Failed sends are highlighted in amber."
                        problemMints={retryMintSet}
                        statusLabel={(nft) => owlSendNftProblemLabel(nft, retryMintSet)}
                      />
                    </fieldset>
                  )}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-black/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {mode === 'send_to_one' ? 'Destination' : 'Recipient wallets'}
                  </CardTitle>
                  <CardDescription>
                    {mode === 'send_to_one'
                      ? nftApprovalSize === OWL_SEND_MAX_SPECIAL_PER_TX
                        ? 'All selected NFTs go to this wallet (1 cNFT/pNFT per approval).'
                        : `All selected NFTs go to this wallet (batches of ${nftApprovalSize}).`
                      : randomizeScatter
                        ? 'Paste wallets (one per line), or wallet,N for exact counts — e.g. walletA,5 then walletB,1. Counts must sum to selected NFTs; otherwise split evenly.'
                        : pairPerNft
                          ? 'Enter one wallet under each NFT for an exact 1:1 send.'
                          : 'One wallet for all selected NFTs — they stay grouped under that destination.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {mode === 'send_to_one' ? (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="owl-send-dest">Wallet address</Label>
                        <Input
                          id="owl-send-dest"
                          value={destination}
                          onChange={(e) => {
                            setDestination(e.target.value)
                            setPreparedLines(null)
                          }}
                          placeholder="Recipient Solana address"
                          className="min-h-[44px] bg-black/40 font-mono text-sm"
                        />
                      </div>
                      {selectedNfts.length > 0 ? (
                        <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-3">
                          <p className="mb-2 text-xs text-muted-foreground">
                            {selectedNfts.length} NFT{selectedNfts.length === 1 ? '' : 's'} → this
                            wallet
                          </p>
                          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {selectedNfts.map((n) => {
                              const label = n.name?.trim() || shorten(n.mint)
                              const collection = n.collectionName?.trim()
                              return (
                                <li key={n.mint} className="flex min-w-0 items-center gap-2">
                                  {n.image ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={n.image}
                                      alt=""
                                      className="h-11 w-11 shrink-0 rounded-md object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/5 text-xs text-muted-foreground">
                                      NFT
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-white">{label}</p>
                                    {collection ? (
                                      <p className="truncate text-xs text-muted-foreground">
                                        {collection}
                                      </p>
                                    ) : null}
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {csvImportVisible ? (
                        <OwlSendCsvImport
                          kind="nft"
                          disabled={nftSending}
                          onApply={(paste) => {
                            setScatterRaw(paste)
                            setPreparedLines(null)
                            // Keep Randomize on for wallet,count airdrops (ARC format).
                            if (!randomizeScatter) {
                              setRandomizeScatterMode(true)
                            }
                          }}
                        />
                      ) : null}
                      <label className="flex min-h-[44px] items-center gap-2 text-sm text-muted-foreground touch-manipulation">
                        <input
                          type="checkbox"
                          checked={randomizeScatter}
                          onChange={(e) => setRandomizeScatterMode(e.target.checked)}
                          className="h-5 w-5 rounded border-white/20"
                        />
                        Randomize which NFT goes to which wallet
                      </label>

                      {randomizeScatter ? (
                        <div className="space-y-1.5">
                          <Label htmlFor="owl-send-scatter">Recipient wallets</Label>
                          <textarea
                            id="owl-send-scatter"
                            value={scatterRaw}
                            onChange={(e) => {
                              setScatterRaw(e.target.value)
                              setPreparedLines(null)
                            }}
                            rows={5}
                            placeholder={
                              '6JKC…86UjU,2\nFpW7…4FMnR,3\n(no header — wallet,count per line)'
                            }
                            className="w-full min-h-[120px] rounded-md border border-input bg-black/40 px-3 py-2 font-mono text-sm touch-manipulation"
                          />
                          <p
                            className={cn(
                              'text-xs',
                              (() => {
                                const n = selectedNfts.length
                                if (nftScatterEntries.length < 1 || n < 1) return 'text-muted-foreground'
                                const hasInvalid = nftScatterEntries.some(
                                  (e) => e.count != null && !Number.isFinite(e.count)
                                )
                                if (hasInvalid) return 'text-amber-300'
                                const hasCounts = nftScatterEntries.some(
                                  (e) => e.count != null && Number.isFinite(e.count)
                                )
                                if (hasCounts) {
                                  const total = nftScatterEntries.reduce(
                                    (sum, e) => sum + (e.count == null ? 1 : e.count),
                                    0
                                  )
                                  return total === n ? 'text-emerald-300' : 'text-amber-300'
                                }
                                const w = new Set(nftScatterEntries.map((e) => e.recipient)).size
                                return w > n ? 'text-amber-300' : 'text-emerald-300'
                              })()
                            )}
                          >
                            {(() => {
                              const n = selectedNfts.length
                              const hasCounts = nftScatterEntries.some(
                                (e) => e.count != null && Number.isFinite(e.count)
                              )
                              const hasInvalid = nftScatterEntries.some(
                                (e) => e.count != null && !Number.isFinite(e.count)
                              )
                              if (hasInvalid) {
                                return 'NFT counts must be whole numbers (e.g. wallet,5)'
                              }
                              if (nftScatterEntries.length < 1 || n < 1) {
                                return `${nftScatterEntries.length} line${nftScatterEntries.length === 1 ? '' : 's'} · select NFTs to distribute`
                              }
                              if (hasCounts) {
                                const total = nftScatterEntries.reduce(
                                  (sum, e) => sum + (e.count == null ? 1 : e.count),
                                  0
                                )
                                const parts = nftScatterEntries
                                  .map((e) => `${shorten(e.recipient)}×${e.count == null ? 1 : e.count}`)
                                  .join(' · ')
                                if (total !== n) {
                                  return `${parts} · counts ${total} ≠ ${n} NFTs selected`
                                }
                                return `${parts} · ${n} NFT${n === 1 ? '' : 's'} shuffled into allotments`
                              }
                              const unique = [...new Set(nftScatterEntries.map((e) => e.recipient))]
                              const w = unique.length
                              if (w > n) {
                                return `${w} wallets · only ${n} NFT${n === 1 ? '' : 's'} selected (too many wallets)`
                              }
                              const base = Math.floor(n / w)
                              const rem = n % w
                              const spread =
                                rem === 0
                                  ? `~${base} each`
                                  : `${base}–${base + 1} each`
                              return `${w} wallet${w === 1 ? '' : 's'} · ${n} NFT${n === 1 ? '' : 's'} shuffled · ${spread}`
                            })()}
                          </p>
                        </div>
                      ) : selectedNfts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Select NFTs above to assign a wallet.
                        </p>
                      ) : !pairPerNft ? (
                        <div className="space-y-3">
                          <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 px-3 py-3">
                            <div className="space-y-1.5">
                              <Label htmlFor="owl-send-scatter-grouped">Wallet address</Label>
                              <Input
                                id="owl-send-scatter-grouped"
                                value={groupedPairWallet}
                                onChange={(e) => applyWalletToAllSelected(e.target.value)}
                                placeholder="Recipient Solana address"
                                className="min-h-[44px] bg-black/40 font-mono text-sm"
                                autoComplete="off"
                              />
                            </div>
                            <div>
                              <p className="mb-2 text-xs text-muted-foreground">
                                {selectedNfts.length} NFT{selectedNfts.length === 1 ? '' : 's'} →
                                this wallet
                              </p>
                              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {selectedNfts.map((n) => {
                                  const label = n.name?.trim() || shorten(n.mint)
                                  const collection = n.collectionName?.trim()
                                  return (
                                    <li key={n.mint} className="flex min-w-0 items-center gap-2">
                                      {n.image ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={n.image}
                                          alt=""
                                          className="h-11 w-11 shrink-0 rounded-md object-cover"
                                        />
                                      ) : (
                                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/5 text-xs text-muted-foreground">
                                          NFT
                                        </div>
                                      )}
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-white">
                                          {label}
                                        </p>
                                        {collection ? (
                                          <p className="truncate text-xs text-muted-foreground">
                                            {collection}
                                          </p>
                                        ) : null}
                                      </div>
                                    </li>
                                  )
                                })}
                              </ul>
                            </div>
                          </div>
                          {selectedNfts.length >= 2 ? (
                            <button
                              type="button"
                              onClick={() => setPairPerNft(true)}
                              className="w-full touch-manipulation rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-left text-xs text-muted-foreground min-h-[44px] hover:text-white"
                            >
                              Sending to different wallets?{' '}
                              <span className="font-semibold text-sky-100">
                                Assign a wallet per NFT
                              </span>
                            </button>
                          ) : null}
                          <p
                            className={cn(
                              'text-xs',
                              groupedPairWallet.trim()
                                ? 'text-emerald-300'
                                : 'text-muted-foreground'
                            )}
                          >
                            {groupedPairWallet.trim()
                              ? `${selectedNfts.length} NFT${selectedNfts.length === 1 ? '' : 's'} grouped under 1 wallet`
                              : `Enter a wallet for ${selectedNfts.length} NFT${selectedNfts.length === 1 ? '' : 's'}`}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {uniquePairedWallets.length <= 1 && selectedNfts.length >= 2 ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (uniquePairedWallets[0]) {
                                  applyWalletToAllSelected(uniquePairedWallets[0])
                                }
                                setPairPerNft(false)
                              }}
                              className="w-full touch-manipulation rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-left text-xs text-emerald-100 min-h-[44px]"
                            >
                              Same destination for every NFT —{' '}
                              <span className="font-semibold">group under one wallet</span>
                            </button>
                          ) : null}
                          <ul className="space-y-3">
                            {selectedNfts.map((n) => {
                              const label = n.name?.trim() || shorten(n.mint)
                              const collection = n.collectionName?.trim()
                              return (
                                <li
                                  key={n.mint}
                                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-3"
                                >
                                  <div className="mb-2 flex items-center gap-3">
                                    {n.image ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={n.image}
                                        alt=""
                                        className="h-11 w-11 shrink-0 rounded-md object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/5 text-xs text-muted-foreground">
                                        NFT
                                      </div>
                                    )}
                                    <div className="min-w-0">
                                      <Label
                                        htmlFor={`owl-send-scatter-${n.mint}`}
                                        className="truncate text-sm font-medium text-white"
                                      >
                                        {label}
                                      </Label>
                                      {collection ? (
                                        <p className="truncate text-xs text-muted-foreground">
                                          {collection}
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                  <Input
                                    id={`owl-send-scatter-${n.mint}`}
                                    value={scatterByMint[n.mint] ?? ''}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      setScatterByMint((prev) => ({ ...prev, [n.mint]: value }))
                                      setPreparedLines(null)
                                    }}
                                    placeholder="Recipient Solana address"
                                    className="min-h-[44px] bg-black/40 font-mono text-sm"
                                    autoComplete="off"
                                  />
                                </li>
                              )
                            })}
                            <p
                              className={cn(
                                'text-xs',
                                activeScatterRecipients.length === selectedNfts.length
                                  ? 'text-emerald-300'
                                  : 'text-muted-foreground'
                              )}
                            >
                              {activeScatterRecipients.length} of {selectedNfts.length} wallets
                              filled
                            </p>
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {cost ? (
                    <div className="space-y-1 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm">
                      <p className="font-medium text-theme-prime">{cost.feeLabel}</p>
                      <p className="text-muted-foreground">{cost.rentLabel}</p>
                      <p className="text-muted-foreground">{cost.networkLabel}</p>
                      <p className="pt-1 font-semibold text-white">Total {cost.totalLabel}</p>
                      {cost.batchCount > 1 ? (
                        <p className="text-xs text-muted-foreground">
                          {cost.batchCount} wallet approvals ·{' '}
                          {nftApprovalSize === OWL_SEND_MAX_SPECIAL_PER_TX
                            ? `${OWL_SEND_MAX_SPECIAL_PER_TX} cNFT/pNFT each`
                            : `${nftApprovalSize} NFTs each`}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <Button
                    type="button"
                    className="min-h-[44px] w-full touch-manipulation"
                    onClick={() => void prepareNftSend()}
                    disabled={selectedNfts.length < 1 || preparing || nftSending}
                  >
                    {preparing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Review send'
                    )}
                  </Button>
                </CardContent>
              </Card>

              {pendingDraft && batches.length === 0 ? (
                <div className="flex flex-col gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-3 text-sm text-sky-50 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs sm:text-sm">
                    Unfinished send found ({pendingDraft.preparedLines.length} NFTs ·{' '}
                    {pendingDraft.batchProgress.filter((b) => b.status === 'done').length}/
                    {pendingDraft.batches.length} batches done). Restore strips nested/frozen Gen2s
                    automatically — or Dismiss and start fresh after a hard refresh.
                  </p>
                  <div className="flex min-h-[44px] gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-[44px] flex-1 touch-manipulation sm:flex-none"
                      onClick={() => void restorePendingDraft()}
                    >
                      Restore
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-[44px] flex-1 touch-manipulation sm:flex-none"
                      onClick={dismissPendingDraft}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ) : null}

              {batches.length > 0 ? (
                <Card className="border-white/10 bg-black/40">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Confirm send</CardTitle>
                    <CardDescription>
                      {preparedLines?.length} NFT{preparedLines?.length === 1 ? '' : 's'} ·{' '}
                      {batches.length} wallet approval{batches.length === 1 ? '' : 's'}
                      {batches.length > 1
                        ? ' · one click chains the rest after the first confirm'
                        : ''}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ol className="space-y-2">
                      {batchProgress.map((b) => {
                        const lines = batches[b.index] ?? []
                        const uniqueWallets = new Set(
                          lines.map((l) => l.recipient.trim()).filter(Boolean)
                        ).size
                        return (
                          <li
                            key={b.index}
                            className={cn(
                              'rounded-lg border px-3 py-2 text-sm',
                              b.status === 'done' && 'border-emerald-500/40 bg-emerald-500/10',
                              b.status === 'failed' && 'border-red-500/40 bg-red-500/10',
                              b.status === 'ready' && 'border-theme-prime/40 bg-white/[0.03]',
                              b.status === 'pending' && 'border-white/10 opacity-70',
                              b.status === 'sending' && 'border-sky-500/40 bg-sky-500/10'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold">
                                Approval {b.index + 1} of {b.total}
                              </span>
                              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                {b.status === 'sending' && sendPhase
                                  ? sendPhase
                                  : b.status}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {lines.length} NFT{lines.length === 1 ? '' : 's'}
                              {mode === 'scatter'
                                ? ` → ${uniqueWallets} wallet${uniqueWallets === 1 ? '' : 's'}`
                                : ` → ${shorten(lines[0]?.recipient ?? '')}`}
                              {' · '}
                              {formatOwlSendFeeSol(feeSol * lines.length)} fee
                            </p>
                            {b.status === 'sending' ? (
                              <p className="mt-1 text-xs text-sky-200">
                                {sendPhaseLabel}
                                {sendElapsedSec > 0 ? ` · ${sendElapsedSec}s` : ''}
                              </p>
                            ) : null}
                            {b.signature ? (
                              <div className="mt-2">
                                <OwlSendSuccessBanner
                                  title={
                                    b.status === 'done'
                                      ? `Approval ${b.index + 1} sent successfully`
                                      : 'Transaction confirmed'
                                  }
                                  signature={b.signature}
                                  detail={`${lines.length} NFT${lines.length === 1 ? '' : 's'} transferred.`}
                                  items={owlSendSuccessItemsFromNftLines(lines, {
                                    showRecipient: mode === 'scatter',
                                  })}
                                />
                              </div>
                            ) : null}
                            {b.error ? (
                              <p className="mt-1 text-xs text-red-300">{b.error}</p>
                            ) : null}
                          </li>
                        )
                      })}
                    </ol>

                    {currentBatchCost && !allDone ? (
                      <p className="text-xs text-muted-foreground">
                        This approval: {currentBatchCost.feeLabel}. {currentBatchCost.rentLabel}.
                      </p>
                    ) : null}

                    {usingJupiter && !allDone ? (
                      <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-50">
                        Connected with <span className="font-semibold">Jupiter</span>. Approve in
                        the Jupiter sheet (Mobile: keep owltopia.xyz open in the Jupiter globe
                        browser). Gen2 may show revoke + transfer — that clears leftover mint
                        locks, not a stake.
                      </p>
                    ) : null}

                    {(sessionError || batchProgress[activeBatch]?.error) &&
                    batchProgress[activeBatch]?.status === 'failed' ? (
                      <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100 break-words">
                        {(sessionError || batchProgress[activeBatch]?.error || '')
                          .split('\n')
                          .filter(Boolean)
                          .slice(0, 4)
                          .join(' · ')}
                      </p>
                    ) : null}

                    {allDone ? (
                      <div className="flex items-center gap-2 text-sm text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" /> All approvals confirmed — open Solscan
                        above for each tx.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button
                            type="button"
                            className="min-h-[44px] flex-1 gap-2 touch-manipulation"
                            disabled={
                              !batchProgress[activeBatch] ||
                              batchProgress[activeBatch]?.status === 'sending' ||
                              batchProgress[activeBatch]?.status === 'done' ||
                              (batchProgress[activeBatch]?.status !== 'ready' &&
                                batchProgress[activeBatch]?.status !== 'failed')
                            }
                            onClick={() => void runBatch(activeBatch)}
                          >
                            {batchProgress[activeBatch]?.status === 'sending' ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                            {batchProgress[activeBatch]?.status === 'failed' &&
                            isOwlSendFrozenTransferError(sessionError ?? '')
                              ? `Skip frozen & retry ${activeBatch + 1}`
                              : owlSendNftSendButtonLabel({
                                  batchesTotal: batches.length,
                                  activeIndex: activeBatch,
                                  status: batchProgress[activeBatch]?.status,
                                  sendPhase,
                                  remainingFromActive: batchProgress.filter(
                                    (b, i) => i >= activeBatch && b.status !== 'done'
                                  ).length,
                                  signAll:
                                    walletSupportsOwlSendSignAll(wallet?.adapter ?? null) &&
                                    owlSendBatchesCanSignAll(
                                      batches.filter(
                                        (_, i) =>
                                          i >= activeBatch && batchProgress[i]?.status !== 'done'
                                      )
                                    ),
                                })}
                          </Button>
                          {nftSending ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="min-h-[44px] touch-manipulation sm:w-auto"
                              onClick={cancelInFlightSend}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                        {!nftSending && batchProgress[activeBatch]?.status !== 'failed' ? (
                          <p className="text-xs text-muted-foreground">
                            {batches.length > 1
                              ? walletSupportsOwlSendSignAll(wallet?.adapter ?? null) &&
                                owlSendBatchesCanSignAll(
                                  batches.filter(
                                    (_, i) =>
                                      i >= activeBatch && batchProgress[i]?.status !== 'done'
                                  )
                                )
                                ? 'One wallet sheet signs every batch. Solana still sends them as separate transactions — you only approve once.'
                                : 'This wallet signs one batch at a time. Phantom can sign all batches in one sheet. Solana cannot fit all 20 in a single transaction.'
                              : 'Opens your wallet for this transfer.'}
                          </p>
                        ) : null}
                        {canResumeRemaining ? (
                          <Button
                            type="button"
                            variant="secondary"
                            className="min-h-[44px] w-full gap-2 touch-manipulation"
                            disabled={resuming}
                            onClick={() => void resumeRemaining()}
                          >
                            {resuming ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                            Resume remaining (skip sent)
                          </Button>
                        ) : null}
                      </div>
                    )}
                    {nftSending ? (
                      <p className="text-xs text-muted-foreground">
                        {sendPhase === 'building'
                          ? 'Preparing the transaction (RPC). Your wallet popup opens next — usually within a few seconds.'
                          : sendPhase === 'approving'
                            ? usingJupiter
                              ? 'Check Jupiter for the approve prompt (Mobile: stay in the Jupiter globe browser). If nothing appears, Cancel, reconnect Jupiter, then Retry.'
                              : `Check ${walletName} for the approve prompt (mobile: open the wallet app). If nothing appears, Cancel and Retry.`
                            : 'Confirming on-chain can take up to ~90s on mobile/busy RPC.'}{' '}
                        Cancel stops the remaining batches — reject any open wallet popup, check
                        Solscan, then Retry to send the rest in one shot.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              {retryMints.length > 0 ||
              batchProgress[activeBatch]?.status === 'failed' ||
              sessionError ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold">
                      {retryMints.length > 0 ? 'Retry list' : 'Send failed'}
                    </p>
                    {retryMints.length > 0 ? (
                      <p className="text-xs font-medium text-amber-50">
                        {retryNftLabels.join(', ')}
                      </p>
                    ) : null}
                    <p className="text-xs text-amber-100/80">
                      {owlSendRetryHint(
                        sessionError ||
                          batchProgress[activeBatch]?.error ||
                          (usingJupiter
                            ? 'Jupiter did not approve — open Jupiter, unlock, hard-refresh owltopia.xyz in the Jupiter globe browser, reconnect, then Retry.'
                            : `Wallet did not approve — open ${walletName}, unlock, refresh this page, reconnect, then Retry.`)
                      )}
                    </p>
                    {usingJupiter ? (
                      <p className="text-[11px] text-amber-100/60">
                        Using Jupiter: Gen2 leftover Candy Machine delegates can look scary in the
                        preview — OwlSend revokes them in the same approval, then transfers. Stay on
                        owltopia.xyz inside Jupiter&apos;s in-app browser.
                      </p>
                    ) : isOwlSendWalletExtensionError(
                      sessionError || batchProgress[activeBatch]?.error || ''
                    ) ? (
                      <p className="text-[11px] text-amber-100/60">
                        This is a wallet-extension problem, not a bad Gen2. Leftover Candy Machine
                        delegates are cleared automatically on the next Retry.
                      </p>
                    ) : isOwlSendFrozenTransferError(
                        sessionError || batchProgress[activeBatch]?.error || ''
                      ) ? (
                      <p className="text-[11px] text-amber-100/60">
                        {isOwlSendCoreOwnerFreezeError(
                          sessionError || batchProgress[activeBatch]?.error || ''
                        )
                          ? 'These Metaplex Core NFTs were force-released from nesting but are still Owner-frozen on-chain. Tap Thaw locks (wallet approve), or open Nesting → Thaw leftover nest locks, then Retry.'
                          : 'Only truly nested/frozen Gen2s need Thaw locks or Unnest. Leftover CM delegates alone are fine and are revoked in the send transaction. Core nest leftovers also use Thaw locks here.'}
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-100/60">
                        Gen2 leftover delegates are revoked in the same approval as the transfer.
                        If the wallet popup still does not open: unlock {walletName}, hard-refresh,
                        reconnect, then Retry.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {isOwlSendFrozenTransferError(
                        sessionError || batchProgress[activeBatch]?.error || ''
                      ) &&
                      !isOwlSendWalletExtensionError(
                        sessionError || batchProgress[activeBatch]?.error || ''
                      ) ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-10 min-h-[40px] touch-manipulation gap-2"
                          disabled={thawing || nftSending}
                          onClick={() => {
                            void (async () => {
                              const res = await thawFrozenMints(retryMints)
                              if (res.thawedCount > 0 || res.ok) {
                                await loadAssets()
                                setSessionNotice(
                                  res.thawedCount > 0
                                    ? `Thawed ${res.thawedCount} NFT${res.thawedCount === 1 ? '' : 's'}. Tap Retry to send the rest (frozen ones are skipped automatically).`
                                    : 'Those NFTs were already thawed on-chain. Tap Retry — nested/frozen ones are skipped automatically.'
                                )
                                setSessionError(null)
                              } else if (res.error) {
                                setSessionError(res.error)
                              }
                            })()
                          }}
                        >
                          {thawing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Thaw locks &amp; retry
                        </Button>
                      ) : null}
                      {retryMints.length > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-10 min-h-[40px] touch-manipulation px-2 text-amber-100"
                          disabled={thawing}
                          onClick={() => {
                            setSelectedMints((prev) => {
                              const next = new Set(prev)
                              for (const m of retryMints) next.delete(m)
                              return next
                            })
                            setRetryMints([])
                            setPreparedLines(null)
                            setBatches([])
                            setBatchProgress([])
                          }}
                        >
                          Deselect problem NFTs
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="flex gap-2 rounded-lg border border-white/10 bg-black/30 p-1">
                  {(
                    [
                      ['send_to_one', 'One wallet'],
                      ['scatter', 'Many wallets'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setTokenMode(id)
                        setTokenBatches([])
                        setTokenBatchProgress([])
                        setTokenError(null)
                      }}
                      className={cn(
                        'min-h-[44px] flex-1 touch-manipulation rounded-md px-3 py-2 text-sm font-semibold transition',
                        tokenMode === id
                          ? 'bg-emerald-500/20 text-theme-prime'
                          : 'text-muted-foreground hover:text-white'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {tokenMode === 'send_to_one'
                    ? `Up to ${OWL_SEND_MAX_PER_TX} token lines per approval · ${formatOwlSendFeeSol(feeSol)} each.`
                    : `Airdrop one token to many wallets · ${OWL_SEND_MAX_PER_TX} per approval · ${formatOwlSendFeeSol(feeSol)} per line.`}
                </p>
              </div>

              {tokenMode === 'send_to_one' ? (
                <Card className="border-white/10 bg-black/40">
                  <CardHeader>
                    <CardTitle className="text-base">Tokens — one wallet</CardTitle>
                    <CardDescription>
                      Enter amounts, then send up to {OWL_SEND_MAX_PER_TX} lines in one approval.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="owl-send-token-dest">Destination</Label>
                      <Input
                        id="owl-send-token-dest"
                        value={tokenDestination}
                        onChange={(e) => setTokenDestination(e.target.value)}
                        placeholder="Recipient Solana address"
                        className="min-h-[44px] bg-black/40 font-mono text-sm"
                      />
                    </div>
                    {loadingAssets && tokens.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Loading tokens…</p>
                    ) : tokens.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No fungible tokens found in this wallet.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {tokens.slice(0, 40).map((t) => {
                          const uiBal = Number(t.balance) / 10 ** t.decimals
                          const label = walletTokenDisplayName(t)
                          const showTicker =
                            Boolean(t.symbol) &&
                            !/^Token \(/i.test(t.symbol) &&
                            t.symbol.trim().toLowerCase() !== label.trim().toLowerCase()
                          return (
                            <li
                              key={`${t.tokenAccount}-${t.mint}`}
                              className="flex flex-col gap-1 rounded-lg border border-white/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{label}</p>
                                <p className="text-xs text-muted-foreground">
                                  {showTicker ? `${t.symbol} · ` : ''}
                                  Balance{' '}
                                  {uiBal.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                                </p>
                              </div>
                              <Input
                                value={tokenAmounts[t.mint] ?? ''}
                                onChange={(e) =>
                                  setTokenAmounts((prev) => ({ ...prev, [t.mint]: e.target.value }))
                                }
                                placeholder="Amount"
                                className="h-11 w-full bg-black/40 sm:w-36"
                                inputMode="decimal"
                              />
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {tokenSuccessSig ? (
                      <OwlSendSuccessBanner
                        title="Tokens sent successfully"
                        signature={tokenSuccessSig}
                        detail={tokenSuccessDetail ?? undefined}
                      />
                    ) : null}
                    {tokenError ? <p className="text-sm text-red-300">{tokenError}</p> : null}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        type="button"
                        className="min-h-[44px] flex-1 gap-2 touch-manipulation"
                        disabled={tokenBusy}
                        onClick={() => void sendTokensToOne()}
                      >
                        {tokenBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        Send tokens
                      </Button>
                      {tokenBusy ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-[44px] touch-manipulation"
                          onClick={cancelInFlightSend}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-white/10 bg-black/40">
                  <CardHeader>
                    <CardTitle className="text-base">Tokens — many wallets</CardTitle>
                    <CardDescription>
                      Pick one token, set a default amount, paste wallets (or wallet,amount per
                      line).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {loadingAssets && tokens.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Loading tokens…</p>
                    ) : tokens.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No fungible tokens found in this wallet.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        <Label htmlFor="owl-send-token-scatter-mint">Token</Label>
                        <select
                          id="owl-send-token-scatter-mint"
                          value={tokenScatterMint ?? ''}
                          onChange={(e) => {
                            setTokenScatterMint(e.target.value || null)
                            setTokenBatches([])
                            setTokenBatchProgress([])
                          }}
                          className="min-h-[44px] w-full touch-manipulation rounded-md border border-input bg-black/40 px-3 text-sm"
                        >
                          <option value="">Select token…</option>
                          {tokens.slice(0, 40).map((t) => {
                            const uiBal = Number(t.balance) / 10 ** t.decimals
                            return (
                              <option key={`${t.tokenAccount}-${t.mint}`} value={t.mint}>
                                {walletTokenDisplayName(t)} ·{' '}
                                {uiBal.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                              </option>
                            )
                          })}
                        </select>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="owl-send-token-scatter-amt">Default amount each</Label>
                      <Input
                        id="owl-send-token-scatter-amt"
                        value={tokenScatterDefaultAmount}
                        onChange={(e) => {
                          setTokenScatterDefaultAmount(e.target.value)
                          setTokenBatches([])
                          setTokenBatchProgress([])
                        }}
                        placeholder="e.g. 100"
                        className="min-h-[44px] bg-black/40"
                        inputMode="decimal"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="owl-send-token-scatter">Recipients</Label>
                      {csvImportVisible ? (
                        <OwlSendCsvImport
                          kind="token"
                          disabled={tokenSending}
                          className="mb-2"
                          onApply={(paste) => {
                            setTokenScatterRaw(paste)
                            setTokenBatches([])
                            setTokenBatchProgress([])
                          }}
                        />
                      ) : null}
                      <textarea
                        id="owl-send-token-scatter"
                        value={tokenScatterRaw}
                        onChange={(e) => {
                          setTokenScatterRaw(e.target.value)
                          setTokenBatches([])
                          setTokenBatchProgress([])
                        }}
                        rows={5}
                        placeholder={'wallet1\nwallet2,50\nwallet3 25'}
                        className="w-full rounded-md border border-input bg-black/40 px-3 py-2 font-mono text-sm touch-manipulation"
                      />
                      <p className="text-xs text-muted-foreground">
                        {tokenScatterEntries.length} recipient
                        {tokenScatterEntries.length === 1 ? '' : 's'} · max {OWL_SEND_MAX_SELECT} ·{' '}
                        {Math.ceil(Math.max(1, tokenScatterEntries.length) / OWL_SEND_MAX_PER_TX)}{' '}
                        approval
                        {Math.ceil(Math.max(1, tokenScatterEntries.length) / OWL_SEND_MAX_PER_TX) ===
                        1
                          ? ''
                          : 's'}{' '}
                        if prepared
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="min-h-[44px] w-full touch-manipulation"
                      onClick={prepareTokenScatter}
                      disabled={!tokenScatterMint || tokenScatterEntries.length < 1 || tokenSending}
                    >
                      Review send
                    </Button>

                    {tokenBatches.length > 0 ? (
                      <div className="space-y-3">
                        <ol className="space-y-2">
                          {tokenBatchProgress.map((b) => {
                            const lines = tokenBatches[b.index] ?? []
                            return (
                              <li
                                key={b.index}
                                className={cn(
                                  'rounded-lg border px-3 py-2 text-sm',
                                  b.status === 'done' && 'border-emerald-500/40 bg-emerald-500/10',
                                  b.status === 'failed' && 'border-red-500/40 bg-red-500/10',
                                  b.status === 'ready' && 'border-theme-prime/40 bg-white/[0.03]',
                                  b.status === 'pending' && 'border-white/10 opacity-70',
                                  b.status === 'sending' && 'border-sky-500/40 bg-sky-500/10'
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold">
                                    Approval {b.index + 1} of {b.total}
                                  </span>
                                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                    {b.status}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {lines.length} wallet{lines.length === 1 ? '' : 's'} ·{' '}
                                  {formatOwlSendFeeSol(feeSol * lines.length)} fee
                                </p>
                                {b.signature ? (
                                  <div className="mt-2">
                                    <OwlSendSuccessBanner
                                      title={`Approval ${b.index + 1} sent`}
                                      signature={b.signature}
                                    />
                                  </div>
                                ) : null}
                                {b.error ? (
                                  <p className="mt-1 text-xs text-red-300">{b.error}</p>
                                ) : null}
                              </li>
                            )
                          })}
                        </ol>
                        {tokenAllDone ? (
                          <div className="flex items-center gap-2 text-sm text-emerald-300">
                            <CheckCircle2 className="h-4 w-4" /> All token approvals confirmed.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              type="button"
                              className="min-h-[44px] flex-1 gap-2 touch-manipulation"
                              disabled={
                                !tokenBatchProgress[tokenActiveBatch] ||
                                tokenBatchProgress[tokenActiveBatch]?.status === 'sending' ||
                                tokenBatchProgress[tokenActiveBatch]?.status === 'done' ||
                                (tokenBatchProgress[tokenActiveBatch]?.status !== 'ready' &&
                                  tokenBatchProgress[tokenActiveBatch]?.status !== 'failed')
                              }
                              onClick={() => void runTokenBatch(tokenActiveBatch)}
                            >
                              {tokenBatchProgress[tokenActiveBatch]?.status === 'sending' ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Send className="h-4 w-4" />
                              )}
                              {tokenBatchProgress[tokenActiveBatch]?.status === 'failed'
                                ? `Retry ${tokenActiveBatch + 1} of ${tokenBatches.length}`
                                : tokenBatches.length === 1
                                  ? 'Are you sure? Send'
                                  : `Are you sure? Send ${tokenActiveBatch + 1} of ${tokenBatches.length}`}
                            </Button>
                            {tokenSending ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="min-h-[44px] touch-manipulation"
                                onClick={cancelInFlightSend}
                              >
                                Cancel
                              </Button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ) : null}
                    {tokenError ? <p className="text-sm text-red-300">{tokenError}</p> : null}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {sessionNotice ? (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
              {sessionNotice}
            </p>
          ) : null}
          {sessionError ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {sessionError}
            </p>
          ) : null}

          <OwlSendLedgerPanel
            wallet={publicKey.toBase58()}
            refreshKey={ledgerRefreshKey}
          />

          <footer className="sticky bottom-0 z-10 -mx-3 border-t border-white/10 bg-black/90 px-3 py-3 backdrop-blur sm:-mx-4 sm:px-4">
            <p className="text-sm text-muted-foreground">
              {assetTab === 'nfts'
                ? selectedNfts.length === 0
                  ? 'No NFT(s) selected.'
                  : `${selectedNfts.length} NFT(s) selected · ${formatOwlSendFeeSol(feeSol * selectedNfts.length)} Owl fee · ${mode === 'scatter' ? 'many wallets' : 'one wallet'}`
                : tokenMode === 'scatter'
                  ? `${tokenScatterEntries.length} recipient(s) · token scatter`
                  : 'Token send to one wallet.'}
            </p>
          </footer>
        </>
      )}
    </div>
  )
}

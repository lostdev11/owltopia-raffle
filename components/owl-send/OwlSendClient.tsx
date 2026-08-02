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
import { assertOwlSendLinesTransferable } from '@/lib/owl-send/assert-nft-transferable'
import {
  OWL_SEND_BUILD_TIMEOUT_HINT,
  OWL_SEND_BUILD_TIMEOUT_MS,
  withOwlSendTimeout,
} from '@/lib/owl-send/confirm'
import {
  buildTokenScatterLines,
  chunkOwlSendBatches,
  collapseRecipientsToNftScatterPaste,
  expandNftScatterEntries,
  pairScatterLines,
  parseNftScatterEntries,
  parseTokenScatterEntries,
  type OwlSendLine,
  type OwlSendTokenScatterLine,
} from '@/lib/owl-send/batch'
import {
  buildResumeRemainingPlan,
  collectSentMintsFromBatches,
  collectSentMintsFromLedger,
} from '@/lib/owl-send/resume'
import {
  clearOwlSendNftDraft,
  loadOwlSendNftDraft,
  saveOwlSendNftDraft,
  type OwlSendNftSessionDraft,
} from '@/lib/owl-send/session-draft'
import {
  OWL_SEND_MAX_PER_TX,
  OWL_SEND_MAX_SELECT,
  type OwlSendAssetTab,
  type OwlSendMode,
} from '@/lib/owl-send/constants'
import { buildOwlSendCostEstimate } from '@/lib/owl-send/cost-estimate'
import { formatOwlSendFeeSol, getOwlSendFeeSol } from '@/lib/owl-send/fee'
import { sendOwlSendNftBatch } from '@/lib/owl-send/send-batch'
import type { OwlSendSendPhase } from '@/lib/owl-send/send-spl-nft-batch'
import { sendOwlSendTokenLines, sendOwlSendTokensToOne } from '@/lib/owl-send/send-tokens'
import { recordOwlSendLedger } from '@/lib/owl-send/record-ledger'
import { useOwlSendAdminAccess } from '@/lib/owl-send/use-owl-send-admin-access'
import { OwlSendLedgerPanel } from '@/components/owl-send/OwlSendLedgerPanel'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import { cn } from '@/lib/utils'

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
  const [preparedLines, setPreparedLines] = useState<OwlSendLine[] | null>(null)
  const [batches, setBatches] = useState<OwlSendLine[][]>([])
  const [batchProgress, setBatchProgress] = useState<BatchProgress[]>([])
  const [activeBatch, setActiveBatch] = useState(0)
  const [retryMints, setRetryMints] = useState<string[]>([])
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)

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

  const sendCancelledRef = useRef(false)

  const feeSol = getOwlSendFeeSol()
  const showAdminPreview = access.isAdmin && !isPublic
  const allowed = access.allowed

  const loadAssets = useCallback(async (): Promise<WalletNft[]> => {
    if (!publicKey) return []
    setLoadingAssets(true)
    setLoadError(null)
    try {
      const walletAddr = publicKey.toBase58()
      const api = await fetchWalletNftsWithRetry(walletAddr)
      let list = api.nfts
      if (list.length === 0) {
        // Include frozen/delegated so the picker matches full wallet inventory;
        // send preflight rejects non-transferable assets with a named reason.
        list = await getWalletNfts(connection, publicKey, { includeLocked: true })
      }
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
  const tokenScatterEntries = useMemo(
    () => parseTokenScatterEntries(tokenScatterRaw),
    [tokenScatterRaw]
  )

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
    }
    setRandomizeScatter(next)
  }

  const cost = useMemo(() => {
    if (preparedLines && preparedLines.length > 0) {
      return buildOwlSendCostEstimate({
        nftCount: preparedLines.length,
        batchCount: Math.max(1, batches.length),
      })
    }
    const count = selectedNfts.length
    if (count < 1) return null
    return buildOwlSendCostEstimate({
      nftCount: count,
      batchCount: Math.ceil(count / OWL_SEND_MAX_PER_TX),
    })
  }, [preparedLines, batches.length, selectedNfts.length])

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
      if (next.has(nft.mint)) next.delete(nft.mint)
      else if (next.size < OWL_SEND_MAX_SELECT) next.add(nft.mint)
      return next
    })
  }

  const selectMints = (mints: string[]) => {
    setPreparedLines(null)
    setBatches([])
    setBatchProgress([])
    setSessionError(null)
    setSelectedMints(new Set(mints.slice(0, OWL_SEND_MAX_SELECT)))
  }

  const prepareNftSend = async () => {
    setSessionError(null)
    setSessionNotice(null)
    setRetryMints([])
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
      lines = selectedNfts.map((n) => ({
        mint: n.mint,
        name: n.name,
        tokenAccount: n.tokenAccount,
        image: n.image,
        recipient: dest,
      }))
    } else {
      const entries = randomizeScatter
        ? nftScatterEntries
        : selectedNfts.map((n) => ({
            recipient: (scatterByMint[n.mint] ?? '').trim(),
            count: null as number | null,
          }))
      if (!randomizeScatter) {
        const missing = selectedNfts.find((n) => !(scatterByMint[n.mint] ?? '').trim())
        if (missing) {
          setSessionError(
            `Enter a wallet for ${missing.name?.trim() || shorten(missing.mint)}.`
          )
          return
        }
      }
      const paired = pairScatterLines({
        mints: selectedNfts.map((n) => ({
          mint: n.mint,
          name: n.name,
          tokenAccount: n.tokenAccount,
          image: n.image,
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
      const preflight = await assertOwlSendLinesTransferable({
        connection,
        owner: publicKey,
        lines,
      })
      if (!preflight.ok) {
        setRetryMints(preflight.failedMints)
        setSessionError(preflight.error)
        setPreparedLines(null)
        setBatches([])
        setBatchProgress([])
        return
      }

      const chunked = chunkOwlSendBatches(lines)
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
    const lines = batches[batchIndex]
    if (!lines?.length) return

    sendCancelledRef.current = false
    setSendPhase('building')
    setSendPhaseStartedAt(Date.now())
    setBatchProgress((prev) =>
      prev.map((b) => (b.index === batchIndex ? { ...b, status: 'sending', error: undefined } : b))
    )
    setSessionError(null)

    const preflight = await withOwlSendTimeout(
      assertOwlSendLinesTransferable({
        connection,
        owner: publicKey,
        lines,
      }),
      OWL_SEND_BUILD_TIMEOUT_MS,
      OWL_SEND_BUILD_TIMEOUT_HINT
    ).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : OWL_SEND_BUILD_TIMEOUT_HINT,
      failedMints: lines.map((l) => l.mint),
    }))
    if (sendCancelledRef.current) {
      setSendPhase(null)
      setSendPhaseStartedAt(null)
      return
    }
    if (!preflight.ok) {
      setSendPhase(null)
      setSendPhaseStartedAt(null)
      setBatchProgress((prev) =>
        prev.map((b) =>
          b.index === batchIndex
            ? { ...b, status: 'failed', error: preflight.error, failedMints: preflight.failedMints }
            : b
        )
      )
      setRetryMints((prev) => [...new Set([...prev, ...preflight.failedMints])])
      setSessionError(preflight.error)
      return
    }

    const result = await sendOwlSendNftBatch({
      connection,
      owner: publicKey,
      walletAdapter: wallet?.adapter ?? null,
      sendTransaction,
      lines,
      onPhase: (phase) => {
        if (!sendCancelledRef.current) setSendPhase(phase)
      },
    })

    if (sendCancelledRef.current) {
      setSendPhase(null)
      setSendPhaseStartedAt(null)
      return
    }

    setSendPhase(null)
    setSendPhaseStartedAt(null)

    if (result.ok) {
      setBatchProgress((prev) =>
        prev.map((b) =>
          b.index === batchIndex
            ? { ...b, status: 'done', signature: result.signature }
            : b.index === batchIndex + 1 && b.status === 'pending'
              ? { ...b, status: 'ready' }
              : b
        )
      )
      if (batchIndex + 1 < batches.length) setActiveBatch(batchIndex + 1)
      setSuccessPopup({
        title:
          batches.length > 1
            ? `Batch ${batchIndex + 1} of ${batches.length} sent`
            : 'NFTs sent successfully',
        detail: `${lines.length} NFT${lines.length === 1 ? '' : 's'} transferred. Fee paid to Owltopia treasury.`,
        signature: result.signature,
      })
      void recordOwlSendLedger({
        fromWallet: publicKey.toBase58(),
        mode: mode === 'scatter' ? 'nft_scatter' : 'nft_one',
        assetKind: 'nft',
        txSignature: result.signature,
        batchIndex,
        lines: lines.map((l) => ({
          recipient: l.recipient,
          mint: l.mint,
          name: l.name ?? null,
        })),
        ensureSiws: ensureLedgerSiws,
      }).then(() => setLedgerRefreshKey((k) => k + 1))
      void loadAssets()
    } else {
      setBatchProgress((prev) =>
        prev.map((b) =>
          b.index === batchIndex
            ? {
                ...b,
                status: 'failed',
                error: result.error,
                failedMints: result.failedMints,
              }
            : b
        )
      )
      if (result.failedMints?.length) {
        setRetryMints((prev) => [...new Set([...prev, ...result.failedMints!])])
      }
      setSessionError(result.error)
    }
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

  const restorePendingDraft = () => {
    if (!pendingDraft) return
    const normalizedProgress = pendingDraft.batchProgress.map((b) =>
      b.status === 'sending'
        ? {
            ...b,
            status: 'failed' as const,
            error:
              'Interrupted — check Solscan for this batch, then Retry or Resume remaining.',
          }
        : b
    )
    const firstActionable = normalizedProgress.findIndex(
      (b) => b.status === 'ready' || b.status === 'failed' || b.status === 'pending'
    )
    const withReady =
      firstActionable >= 0 && normalizedProgress[firstActionable]?.status === 'pending'
        ? normalizedProgress.map((b, i) =>
            i === firstActionable ? { ...b, status: 'ready' as const } : b
          )
        : normalizedProgress

    setMode(pendingDraft.mode)
    setPreparedLines(pendingDraft.preparedLines)
    setBatches(pendingDraft.batches)
    setBatchProgress(withReady)
    setActiveBatch(
      firstActionable >= 0
        ? firstActionable
        : Math.min(pendingDraft.activeBatch, Math.max(0, withReady.length - 1))
    )
    setSelectedMints(new Set(pendingDraft.preparedLines.map((l) => l.mint)))
    setPendingDraft(null)
    setAssetTab('nfts')
    setSessionError(null)
    setSessionNotice(
      'Restored unfinished send. Use Resume remaining if some NFTs already left the wallet.'
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
    return buildOwlSendCostEstimate({ nftCount: lines.length, batchCount: 1 })
  }, [batches, activeBatch])

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
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-theme-prime">
          <Bird className="h-6 w-6" />
          <p className="font-display text-3xl tracking-wide text-white sm:text-4xl">OwlSend</p>
        </div>
        <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
          Send NFTs and tokens for{' '}
          <span className="font-semibold text-theme-prime">{formatOwlSendFeeSol(feeSol)}</span> Owl
          fee each — cheaper than FoxySend. Solana rent is shown separately when a recipient needs a
          new token account.
        </p>
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
                    Up to {OWL_SEND_MAX_SELECT} NFTs · {OWL_SEND_MAX_PER_TX} per wallet
                    approval · frozen/nested assets stay visible and are rejected at send
                    with a named reason
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadError ? (
                    <p className="mb-3 text-sm text-red-400">{loadError}</p>
                  ) : null}
                  {!loadingAssets && nfts.length > 0 ? (
                    <p className="mb-3 text-xs text-muted-foreground">
                      {nfts.length} NFT{nfts.length === 1 ? '' : 's'} in wallet
                      {nfts.some((n) => n.frozen)
                        ? ` · ${nfts.filter((n) => n.frozen).length} frozen/nested (can select; send will explain)`
                        : ''}
                    </p>
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
                        dialogDescription="Filter by collection, switch to list view, or search by name or mint — same controls as create raffle."
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
                      ? 'All selected NFTs go to this wallet (batches of 5).'
                      : randomizeScatter
                        ? 'Paste wallets (one per line), or wallet,N for exact counts — e.g. walletA,5 then walletB,1. Counts must sum to selected NFTs; otherwise split evenly.'
                        : 'Enter one wallet under each NFT for an exact 1:1 send.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {mode === 'send_to_one' ? (
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
                  ) : (
                    <div className="space-y-3">
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
                            placeholder={'walletA,5\nwalletB,1\nwalletC,4'}
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
                          Select NFTs above to assign each a wallet.
                        </p>
                      ) : (
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
                            {activeScatterRecipients.length} of {selectedNfts.length} wallets filled
                          </p>
                        </ul>
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
                          {cost.batchCount} batches · {OWL_SEND_MAX_PER_TX} NFTs per approval
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
                      'Review batches'
                    )}
                  </Button>
                </CardContent>
              </Card>

              {pendingDraft && batches.length === 0 ? (
                <div className="flex flex-col gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-3 text-sm text-sky-50 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs sm:text-sm">
                    Unfinished send found ({pendingDraft.preparedLines.length} NFTs ·{' '}
                    {pendingDraft.batchProgress.filter((b) => b.status === 'done').length}/
                    {pendingDraft.batches.length} batches done). Restore it, then Resume remaining if
                    needed.
                  </p>
                  <div className="flex min-h-[44px] gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-[44px] flex-1 touch-manipulation sm:flex-none"
                      onClick={restorePendingDraft}
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
                    <CardTitle className="text-base">Batches</CardTitle>
                    <CardDescription>
                      {preparedLines?.length} NFT{preparedLines?.length === 1 ? '' : 's'} ·{' '}
                      {batches.length} approval{batches.length === 1 ? '' : 's'} · start the next
                      batch after each confirm
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ol className="space-y-2">
                      {batchProgress.map((b) => {
                        const lines = batches[b.index] ?? []
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
                                Batch {b.index + 1} of {b.total}
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
                                ? ` → ${lines.length} wallet${lines.length === 1 ? '' : 's'}`
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
                                      ? `Batch ${b.index + 1} sent successfully`
                                      : 'Transaction confirmed'
                                  }
                                  signature={b.signature}
                                  detail={`${lines.length} NFT${lines.length === 1 ? '' : 's'} transferred.`}
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

                    {allDone ? (
                      <div className="flex items-center gap-2 text-sm text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" /> All batches confirmed — open Solscan
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
                            {batchProgress[activeBatch]?.status === 'sending'
                              ? sendPhase === 'confirming'
                                ? `Confirming batch ${activeBatch + 1}…`
                                : sendPhase === 'approving'
                                  ? `Approve batch ${activeBatch + 1} in wallet…`
                                  : `Sending batch ${activeBatch + 1}…`
                              : batchProgress[activeBatch]?.status === 'failed'
                                ? `Retry batch ${activeBatch + 1}`
                                : activeBatch === 0
                                  ? `Start batch 1 of ${batches.length}`
                                  : `Start next batch (${activeBatch + 1} of ${batches.length})`}
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
                          ? 'Wallet popup appears after the tx is built (RPC). Build times out around 45s if the network is stuck.'
                          : sendPhase === 'approving'
                            ? 'Open your wallet app and approve. On mobile, return here after signing.'
                            : 'Confirming on-chain can take up to ~90s on mobile/busy RPC.'}{' '}
                        Cancel marks this batch failed — reject any open wallet popup, check Solscan,
                        then Retry or Resume remaining.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              {retryMints.length > 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">Retry list</p>
                    <p className="text-xs text-amber-100/80">
                      {retryMints.map(shorten).join(', ')} — unnest/unstake frozen or delegated NFTs,
                      or send Core/cNFT/pNFT alone.
                    </p>
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
                      Review batches
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
                                    Batch {b.index + 1} of {b.total}
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
                                      title={`Batch ${b.index + 1} sent`}
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
                            <CheckCircle2 className="h-4 w-4" /> All token batches confirmed.
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
                                ? `Retry batch ${tokenActiveBatch + 1}`
                                : `Start batch ${tokenActiveBatch + 1} of ${tokenBatches.length}`}
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

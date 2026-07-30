'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  chunkOwlTransferBatches,
  pairScatterLines,
  parseRecipientAddresses,
  type OwlTransferLine,
} from '@/lib/owl-transfer/batch'
import {
  OWL_TRANSFER_MAX_PER_TX,
  OWL_TRANSFER_MAX_SELECT,
  type OwlTransferAssetTab,
  type OwlTransferMode,
} from '@/lib/owl-transfer/constants'
import { buildOwlTransferCostEstimate } from '@/lib/owl-transfer/cost-estimate'
import { formatOwlTransferFeeSol, getOwlTransferFeeSol } from '@/lib/owl-transfer/fee'
import { sendOwlTransferNftBatch } from '@/lib/owl-transfer/send-batch'
import { sendOwlTransferTokensToOne } from '@/lib/owl-transfer/send-tokens'
import { cn } from '@/lib/utils'

type Props = {
  /** Server session admin hint; client also verifies connected wallet via /api/admin/check. */
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

export function OwlTransferClient({ initialViewerIsAdmin, isPublic }: Props) {
  const { connection } = useConnection()
  const { publicKey, connected, wallet } = useWallet()
  const sendTransaction = useSendTransactionForWallet()

  const [viewerIsAdmin, setViewerIsAdmin] = useState(initialViewerIsAdmin)
  const [accessChecked, setAccessChecked] = useState(isPublic || initialViewerIsAdmin)
  const [assetTab, setAssetTab] = useState<OwlTransferAssetTab>('nfts')
  const [mode, setMode] = useState<OwlTransferMode>('send_to_one')
  const [nfts, setNfts] = useState<WalletNft[]>([])
  const [tokens, setTokens] = useState<WalletToken[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set())
  const [nftSearchQuery, setNftSearchQuery] = useState('')
  const [destination, setDestination] = useState('')
  const [scatterRaw, setScatterRaw] = useState('')
  const [randomizeScatter, setRandomizeScatter] = useState(true)
  const [preparedLines, setPreparedLines] = useState<OwlTransferLine[] | null>(null)
  const [batches, setBatches] = useState<OwlTransferLine[][]>([])
  const [batchProgress, setBatchProgress] = useState<BatchProgress[]>([])
  const [activeBatch, setActiveBatch] = useState(0)
  const [retryMints, setRetryMints] = useState<string[]>([])
  const [sessionError, setSessionError] = useState<string | null>(null)

  // Tokens tab
  const [tokenAmounts, setTokenAmounts] = useState<Record<string, string>>({})
  const [tokenDestination, setTokenDestination] = useState('')
  const [tokenBusy, setTokenBusy] = useState(false)
  const [tokenMsg, setTokenMsg] = useState<string | null>(null)

  const feeSol = getOwlTransferFeeSol()
  const showAdminPreview = viewerIsAdmin && !isPublic
  const allowed = isPublic || viewerIsAdmin

  useEffect(() => {
    if (isPublic) {
      setAccessChecked(true)
      return
    }
    if (!connected || !publicKey) {
      setViewerIsAdmin(initialViewerIsAdmin)
      setAccessChecked(true)
      return
    }
    let cancelled = false
    setAccessChecked(false)
    fetch(`/api/admin/check?wallet=${encodeURIComponent(publicKey.toBase58())}`, {
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        setViewerIsAdmin(data?.isAdmin === true || initialViewerIsAdmin)
        setAccessChecked(true)
      })
      .catch(() => {
        if (cancelled) return
        setViewerIsAdmin(initialViewerIsAdmin)
        setAccessChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, isPublic, initialViewerIsAdmin])

  const loadAssets = useCallback(async () => {
    if (!publicKey) return
    setLoadingAssets(true)
    setLoadError(null)
    try {
      const walletAddr = publicKey.toBase58()
      const api = await fetchWalletNftsWithRetry(walletAddr)
      let list = api.nfts
      if (list.length === 0) {
        list = await getWalletNfts(connection, publicKey)
      }
      setNfts(list)
      const toks = await getWalletTokens(connection, publicKey)
      setTokens(toks)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load wallet assets')
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
    }
  }, [connected, publicKey, loadAssets])

  const selectedNfts = useMemo(
    () => nfts.filter((n) => selectedMints.has(n.mint)),
    [nfts, selectedMints]
  )

  const scatterRecipients = useMemo(() => parseRecipientAddresses(scatterRaw), [scatterRaw])

  const cost = useMemo(() => {
    if (preparedLines && preparedLines.length > 0) {
      return buildOwlTransferCostEstimate({
        nftCount: preparedLines.length,
        batchCount: Math.max(1, batches.length),
      })
    }
    const count = selectedNfts.length
    if (count < 1) return null
    return buildOwlTransferCostEstimate({
      nftCount: count,
      batchCount: Math.ceil(count / OWL_TRANSFER_MAX_PER_TX),
    })
  }, [preparedLines, batches.length, selectedNfts.length])

  const toggleNft = (nft: WalletNft) => {
    setPreparedLines(null)
    setBatches([])
    setBatchProgress([])
    setSessionError(null)
    setSelectedMints((prev) => {
      const next = new Set(prev)
      if (next.has(nft.mint)) next.delete(nft.mint)
      else if (next.size < OWL_TRANSFER_MAX_SELECT) next.add(nft.mint)
      return next
    })
  }

  const selectMints = (mints: string[]) => {
    setPreparedLines(null)
    setBatches([])
    setBatchProgress([])
    setSessionError(null)
    setSelectedMints(new Set(mints.slice(0, OWL_TRANSFER_MAX_SELECT)))
  }

  const prepareNftSend = () => {
    setSessionError(null)
    setRetryMints([])
    if (selectedNfts.length < 1) {
      setSessionError('Select at least one NFT.')
      return
    }
    if (selectedNfts.length > OWL_TRANSFER_MAX_SELECT) {
      setSessionError(`Select at most ${OWL_TRANSFER_MAX_SELECT} NFTs.`)
      return
    }

    let lines: OwlTransferLine[]
    if (mode === 'send_to_one') {
      const dest = destination.trim()
      if (!isValidSolanaPubkey(dest)) {
        setSessionError('Enter a valid destination wallet.')
        return
      }
      if (dest === publicKey?.toBase58()) {
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
      const paired = pairScatterLines({
        mints: selectedNfts.map((n) => ({
          mint: n.mint,
          name: n.name,
          tokenAccount: n.tokenAccount,
          image: n.image,
        })),
        recipients: scatterRecipients,
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

    const chunked = chunkOwlTransferBatches(lines)
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
  }

  const runBatch = async (batchIndex: number) => {
    if (!publicKey || !preparedLines) return
    const lines = batches[batchIndex]
    if (!lines?.length) return

    setBatchProgress((prev) =>
      prev.map((b) => (b.index === batchIndex ? { ...b, status: 'sending', error: undefined } : b))
    )
    setSessionError(null)

    const result = await sendOwlTransferNftBatch({
      connection,
      owner: publicKey,
      walletAdapter: wallet?.adapter ?? null,
      sendTransaction,
      lines,
    })

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

  const sendTokens = async () => {
    if (!publicKey) return
    setTokenMsg(null)
    if (!isValidSolanaPubkey(tokenDestination)) {
      setTokenMsg('Enter a valid destination wallet.')
      return
    }
    const lines = []
    for (const t of tokens) {
      const raw = tokenAmounts[t.mint]?.trim()
      if (!raw) continue
      const ui = Number(raw)
      if (!Number.isFinite(ui) || ui <= 0) {
        setTokenMsg(`Invalid amount for ${walletTokenDisplayName(t)}`)
        return
      }
      const amountRaw = BigInt(Math.round(ui * 10 ** t.decimals))
      const bal = BigInt(t.balance)
      if (amountRaw > bal) {
        setTokenMsg(`Insufficient balance for ${walletTokenDisplayName(t)}`)
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
      setTokenMsg('Enter an amount for at least one token.')
      return
    }
    if (lines.length > OWL_TRANSFER_MAX_PER_TX) {
      setTokenMsg(`Max ${OWL_TRANSFER_MAX_PER_TX} token lines per approval — clear some amounts.`)
      return
    }

    setTokenBusy(true)
    try {
      const result = await sendOwlTransferTokensToOne({
        connection,
        owner: publicKey,
        recipient: tokenDestination.trim(),
        sendTransaction,
        lines,
      })
      if (result.ok) {
        setTokenMsg(`Sent. Signature: ${result.signature}`)
        setTokenAmounts({})
        void loadAssets()
      } else {
        setTokenMsg(result.error)
      }
    } finally {
      setTokenBusy(false)
    }
  }

  const currentBatchCost = useMemo(() => {
    const lines = batches[activeBatch]
    if (!lines?.length) return null
    return buildOwlTransferCostEstimate({ nftCount: lines.length, batchCount: 1 })
  }, [batches, activeBatch])

  const doneCount = batchProgress.filter((b) => b.status === 'done').length
  const allDone = batches.length > 0 && doneCount === batches.length

  if (!accessChecked) {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <Bird className="h-10 w-10 text-theme-prime" />
        <h1 className="font-display text-3xl tracking-wide text-white">Owl Transfer</h1>
        <p className="text-sm text-muted-foreground">
          Coming soon. Admins can connect an admin wallet to preview before public launch.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-3 py-6 sm:px-4 sm:py-10">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-theme-prime">
          <Bird className="h-6 w-6" />
          <p className="font-display text-3xl tracking-wide text-white sm:text-4xl">Owl Transfer</p>
        </div>
        <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
          Send NFTs and tokens for{' '}
          <span className="font-semibold text-theme-prime">{formatOwlTransferFeeSol(feeSol)}</span> Owl
          fee each — cheaper than FoxySend. Solana rent is shown separately when a recipient needs a
          new token account.
        </p>
        {showAdminPreview ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            <Shield className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <span className="font-semibold">Admin preview</span> — not live for everyone yet. Test
              here, then set <code className="text-xs">OWL_TRANSFER_PUBLIC=true</code> to open it up.
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
            <CardDescription>Connect to load NFTs and start a transfer.</CardDescription>
          </CardHeader>
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
                  'flex-1 rounded-md px-3 py-2 text-sm font-semibold transition',
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
              <div className="flex gap-2 rounded-lg border border-white/10 bg-black/30 p-1">
                {(
                  [
                    ['send_to_one', 'Send to one'],
                    ['scatter', 'Scatter NFTs'],
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
                      'flex-1 rounded-md px-3 py-2 text-sm font-semibold transition',
                      mode === id
                        ? 'bg-emerald-500/20 text-theme-prime'
                        : 'text-muted-foreground hover:text-white'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <Card className="border-white/10 bg-black/40">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">Select NFTs</CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void loadAssets()}
                      disabled={loadingAssets}
                    >
                      {loadingAssets ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reload'}
                    </Button>
                  </div>
                  <CardDescription>
                    Up to {OWL_TRANSFER_MAX_SELECT} NFTs · {OWL_TRANSFER_MAX_PER_TX} per wallet
                    approval · you start each next batch
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadError ? (
                    <p className="mb-3 text-sm text-red-400">{loadError}</p>
                  ) : null}
                  {loadingAssets && nfts.length === 0 ? (
                    <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading NFTs…
                    </div>
                  ) : (
                    <fieldset
                      disabled={batchProgress.some((b) => b.status === 'sending')}
                      className="min-w-0 disabled:opacity-60"
                    >
                      <WalletNftPicker
                        nfts={nfts}
                        searchQuery={nftSearchQuery}
                        onSearchQueryChange={setNftSearchQuery}
                        selectionMode="multi"
                        selectedMints={selectedMints}
                        onToggle={toggleNft}
                        maxSelect={OWL_TRANSFER_MAX_SELECT}
                        onSelectFilteredMints={selectMints}
                        searchInputId="owl-transfer-nft-search"
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
                    {mode === 'send_to_one' ? 'Destination' : 'Scatter wallets'}
                  </CardTitle>
                  <CardDescription>
                    {mode === 'send_to_one'
                      ? 'All selected NFTs go to this wallet (batches of 5).'
                      : `Paste ${selectedNfts.length || 'N'} wallets (one per NFT). Pairing is 1:1.`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {mode === 'send_to_one' ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="owl-transfer-dest">Wallet address</Label>
                      <Input
                        id="owl-transfer-dest"
                        value={destination}
                        onChange={(e) => {
                          setDestination(e.target.value)
                          setPreparedLines(null)
                        }}
                        placeholder="Recipient Solana address"
                        className="bg-black/40 font-mono text-sm"
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="owl-transfer-scatter">Recipient wallets</Label>
                        <textarea
                          id="owl-transfer-scatter"
                          value={scatterRaw}
                          onChange={(e) => {
                            setScatterRaw(e.target.value)
                            setPreparedLines(null)
                          }}
                          rows={5}
                          placeholder={'One address per line\n…'}
                          className="w-full rounded-md border border-input bg-black/40 px-3 py-2 font-mono text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          {scatterRecipients.length} address
                          {scatterRecipients.length === 1 ? '' : 'es'} · need {selectedNfts.length}{' '}
                          for current selection
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={randomizeScatter}
                          onChange={(e) => setRandomizeScatter(e.target.checked)}
                          className="rounded border-white/20"
                        />
                        Randomize which NFT goes to which wallet
                      </label>
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
                          {cost.batchCount} batches · {OWL_TRANSFER_MAX_PER_TX} NFTs per approval
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <Button
                    type="button"
                    className="w-full"
                    onClick={prepareNftSend}
                    disabled={selectedNfts.length < 1}
                  >
                    Review batches
                  </Button>
                </CardContent>
              </Card>

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
                                {b.status}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {lines.length} NFT{lines.length === 1 ? '' : 's'}
                              {mode === 'scatter'
                                ? ` → ${lines.length} wallet${lines.length === 1 ? '' : 's'}`
                                : ` → ${shorten(lines[0]?.recipient ?? '')}`}
                              {' · '}
                              {formatOwlTransferFeeSol(feeSol * lines.length)} fee
                            </p>
                            {b.signature ? (
                              <p className="mt-1 break-all font-mono text-[11px] text-emerald-300">
                                {b.signature}
                              </p>
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
                        <CheckCircle2 className="h-4 w-4" /> All batches confirmed.
                      </div>
                    ) : (
                      <Button
                        type="button"
                        className="w-full gap-2"
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
                        {batchProgress[activeBatch]?.status === 'failed'
                          ? `Retry batch ${activeBatch + 1}`
                          : activeBatch === 0
                            ? `Start batch 1 of ${batches.length}`
                            : `Start next batch (${activeBatch + 1} of ${batches.length})`}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              {retryMints.length > 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">Retry list</p>
                    <p className="text-xs text-amber-100/80">
                      {retryMints.map(shorten).join(', ')} — reselect these NFTs after fixing the
                      error (or send Core/cNFT/pNFT alone).
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <Card className="border-white/10 bg-black/40">
              <CardHeader>
                <CardTitle className="text-base">Tokens — Send to one</CardTitle>
                <CardDescription>
                  Up to {OWL_TRANSFER_MAX_PER_TX} token lines per approval ·{' '}
                  {formatOwlTransferFeeSol(feeSol)} each · rent shown by Solana when ATAs are created
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="owl-transfer-token-dest">Destination</Label>
                  <Input
                    id="owl-transfer-token-dest"
                    value={tokenDestination}
                    onChange={(e) => setTokenDestination(e.target.value)}
                    placeholder="Recipient Solana address"
                    className="bg-black/40 font-mono text-sm"
                  />
                </div>
                {loadingAssets && tokens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Loading tokens…</p>
                ) : tokens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No fungible tokens found in this wallet.</p>
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
                              Balance {uiBal.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                            </p>
                          </div>
                          <Input
                            value={tokenAmounts[t.mint] ?? ''}
                            onChange={(e) =>
                              setTokenAmounts((prev) => ({ ...prev, [t.mint]: e.target.value }))
                            }
                            placeholder="Amount"
                            className="h-9 w-full bg-black/40 sm:w-36"
                            inputMode="decimal"
                          />
                        </li>
                      )
                    })}
                  </ul>
                )}
                {tokenMsg ? (
                  <p
                    className={cn(
                      'text-sm',
                      tokenMsg.startsWith('Sent') ? 'text-emerald-300' : 'text-red-300'
                    )}
                  >
                    {tokenMsg}
                  </p>
                ) : null}
                <Button
                  type="button"
                  className="w-full gap-2"
                  disabled={tokenBusy}
                  onClick={() => void sendTokens()}
                >
                  {tokenBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send tokens
                </Button>
              </CardContent>
            </Card>
          )}

          {sessionError ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {sessionError}
            </p>
          ) : null}

          <footer className="sticky bottom-0 z-10 -mx-3 border-t border-white/10 bg-black/90 px-3 py-3 backdrop-blur sm:-mx-4 sm:px-4">
            <p className="text-sm text-muted-foreground">
              {assetTab === 'nfts'
                ? selectedNfts.length === 0
                  ? 'No NFT(s) selected.'
                  : `${selectedNfts.length} NFT(s) selected · ${formatOwlTransferFeeSol(feeSol * selectedNfts.length)} Owl fee`
                : 'Token send to one wallet.'}
            </p>
          </footer>
        </>
      )}
    </div>
  )
}

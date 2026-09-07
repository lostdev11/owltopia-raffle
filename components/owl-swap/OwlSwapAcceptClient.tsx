'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeftRight, CheckCircle2, Loader2, Shield } from 'lucide-react'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WalletNftPicker } from '@/components/WalletNftPicker'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { OwlSwapTradingRoom } from '@/components/owl-swap/trading-room/OwlSwapTradingRoom'
import { OwlSwapMissingEscrowAlert } from '@/components/owl-swap/trading-room/OwlSwapMissingEscrowAlert'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import { useSiwsSession } from '@/hooks/use-siws-session'
import { fetchWalletNftsWithRetry } from '@/lib/solana/fetch-wallet-nfts-api'
import { getWalletNfts, type WalletNft } from '@/lib/solana/wallet-tokens'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import { useOwlSwapAdminAccess } from '@/lib/owl-swap/use-owl-swap-admin-access'
import { OWL_SWAP_MAX_NFTS_PER_SIDE } from '@/lib/owl-swap/constants'
import {
  formatOwlSwapFeeSol,
  getOwlSwapFeeSol,
  getOwlSwapFeeSolForDiscount,
} from '@/lib/owl-swap/fee'
import { buildOwlSwapTakerDepositTx } from '@/lib/owl-swap/build-deposit-tx'
import { makeOwlSwapSimulateSignature } from '@/lib/owl-swap/simulate'
import {
  deriveTradingRoomTxUiState,
  nextReviewEpoch,
  selectionFingerprint,
  shouldEnablePrimaryCta,
  type TradingRoomAsset,
} from '@/lib/owl-swap/trading-room-ui-state'
import type { OwlSendHolderRoleName } from '@/lib/owl-send/holder-discount'
import type { OwlSwapOfferAssetRow, OwlSwapOfferRow } from '@/lib/db/owl-swap'

type AcceptOffer = OwlSwapOfferRow & {
  assets?: OwlSwapOfferAssetRow[]
  simulate?: boolean
}

type HolderFeeQuote = {
  discountBps: number
  discountPercent: number
  roleName: OwlSendHolderRoleName | null
  feeLamportsTotal: number
  feeSolPerLineLabel: string
}

type LocalPhase =
  | 'idle'
  | 'awaiting_signature'
  | 'submitting'
  | 'pending_confirmation'
  | 'rejected'
  | 'failed'

type Props = {
  code: string
  initialViewerIsAdmin: boolean
  isPublic: boolean
}

function shorten(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

export function OwlSwapAcceptClient({
  code,
  initialViewerIsAdmin,
  isPublic,
}: Props) {
  const { connection } = useConnection()
  const { publicKey, connected } = useWallet()
  const sendTransaction = useSendTransactionForWallet()
  const access = useOwlSwapAdminAccess({ initialViewerIsAdmin, isPublic })
  const { sessionWallet, checking: sessionChecking, checkSession } = useSiwsSession()
  const { signIn, signingIn, error: signInError } = useSiwsSignIn()

  const [offer, setOffer] = useState<AcceptOffer | null>(null)
  const [offerLoading, setOfferLoading] = useState(true)
  const [offerError, setOfferError] = useState<string | null>(null)

  const [nfts, setNfts] = useState<WalletNft[]>([])
  const [nftsLoading, setNftsLoading] = useState(false)
  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set())
  const [nftSearchQuery, setNftSearchQuery] = useState('')
  const [solSweetener, setSolSweetener] = useState('')
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null)
  const [simulateMode, setSimulateMode] = useState(false)
  const [holderQuote, setHolderQuote] = useState<HolderFeeQuote | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [settleSig, setSettleSig] = useState<string | null>(null)
  const [localPhase, setLocalPhase] = useState<LocalPhase>('idle')
  const [reviewEpoch, setReviewEpoch] = useState(0)

  const wallet = publicKey?.toBase58() ?? ''
  const signedIn = Boolean(wallet && sessionWallet && sessionWallet === wallet)
  const feeSolBase = getOwlSwapFeeSol()
  const feeSolDisplay = holderQuote
    ? getOwlSwapFeeSolForDiscount(holderQuote.discountBps)
    : feeSolBase
  const feeLamports = holderQuote?.feeLamportsTotal ?? Math.round(feeSolBase * LAMPORTS_PER_SOL)
  const feeAvailable = holderQuote != null && !Number.isNaN(holderQuote.feeLamportsTotal)
  const feeSolLabel = feeAvailable
    ? holderQuote?.feeSolPerLineLabel ?? formatOwlSwapFeeSol(feeSolDisplay)
    : null

  const selectedNfts = useMemo(
    () => nfts.filter((n) => selectedMints.has(n.mint)),
    [nfts, selectedMints]
  )

  const takerSolLamports = useMemo(() => {
    const n = Number(solSweetener)
    if (!Number.isFinite(n) || n <= 0) return 0
    return Math.round(n * LAMPORTS_PER_SOL)
  }, [solSweetener])

  const makerAssets = useMemo(
    () => (offer?.assets ?? []).filter((a) => a.side === 'maker'),
    [offer]
  )

  const receiveAssets: TradingRoomAsset[] = useMemo(
    () =>
      makerAssets.map((a) => ({
        mint: a.mint,
        name: a.name,
        imageUrl: a.image_url,
        collection: a.collection,
      })),
    [makerAssets]
  )

  const offerAssets: TradingRoomAsset[] = useMemo(
    () =>
      selectedNfts.map((n) => ({
        mint: n.mint,
        name: n.name,
        imageUrl: n.image,
        collection: n.collectionName ?? n.symbol ?? null,
      })),
    [selectedNfts]
  )

  const offerIsSimulated = offer?.simulate === true
  const useSimulate = simulateMode || offerIsSimulated

  const selectionKey = selectionFingerprint(offerAssets, takerSolLamports)
  useEffect(() => {
    setReviewEpoch((e) => nextReviewEpoch(e))
    if (localPhase === 'rejected' || localPhase === 'failed') {
      setLocalPhase('idle')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey])

  const effectiveSettleSig = settleSig || offer?.settle_sig || null
  const txState = deriveTradingRoomTxUiState({
    offerStatus: offer?.status,
    settleSig: effectiveSettleSig,
    localPhase,
    mode: 'accept',
  })

  const escrowReady = Boolean(escrowAddress) || useSimulate
  const offerSideReady = selectedNfts.length >= 1 || takerSolLamports > 0
  const ctaEnabled = shouldEnablePrimaryCta({
    txState,
    offerSideReady,
    escrowReady,
    feeQuoteReady: feeAvailable || useSimulate,
  })

  const loadOffer = useCallback(async () => {
    setOfferLoading(true)
    setOfferError(null)
    try {
      const res = await fetch(`/api/owl-swap/offers/by-code/${encodeURIComponent(code)}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setOfferError(typeof data?.error === 'string' ? data.error : 'Offer not found')
        setOffer(null)
        return
      }
      setOffer(data.offer)
      if (typeof data?.offer?.settle_sig === 'string') {
        setSettleSig(data.offer.settle_sig)
      }
    } catch {
      setOfferError('Failed to load offer')
      setOffer(null)
    } finally {
      setOfferLoading(false)
    }
  }, [code])

  useEffect(() => {
    void loadOffer()
  }, [loadOffer])

  useEffect(() => {
    let cancelled = false
    fetch('/api/owl-swap/escrow', { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json().catch(() => null)
        return { ok: r.ok, data }
      })
      .then(({ ok, data }) => {
        if (cancelled) return
        if (typeof data?.address === 'string' && data.address) {
          setEscrowAddress(data.address)
          setSimulateMode(false)
          return
        }
        setEscrowAddress(null)
        setSimulateMode(data?.simulate === true || data?.mode === 'simulate')
        if (!ok && data?.simulate !== true) {
          setSimulateMode(false)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!wallet) {
      setHolderQuote(null)
      return
    }
    let cancelled = false
    fetch(`/api/owl-swap/holder-fee?wallet=${encodeURIComponent(wallet)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data || data.error) return
        setHolderQuote({
          discountBps: Number(data.discountBps) || 0,
          discountPercent: Number(data.discountPercent) || 0,
          roleName: data.roleName ?? null,
          feeLamportsTotal: Number(data.feeLamportsTotal) || 0,
          feeSolPerLineLabel:
            typeof data.feeSolPerLineLabel === 'string'
              ? data.feeSolPerLineLabel
              : formatOwlSwapFeeSol(feeSolBase),
        })
      })
      .catch(() => {
        if (cancelled) return
        setHolderQuote({
          discountBps: 0,
          discountPercent: 0,
          roleName: null,
          feeLamportsTotal: Math.round(feeSolBase * LAMPORTS_PER_SOL),
          feeSolPerLineLabel: formatOwlSwapFeeSol(feeSolBase),
        })
      })
    return () => {
      cancelled = true
    }
  }, [wallet, feeSolBase])

  const loadNfts = useCallback(async () => {
    if (!publicKey) {
      setNfts([])
      return
    }
    setNftsLoading(true)
    try {
      const api = await fetchWalletNftsWithRetry(publicKey.toBase58()).catch(() => null)
      if (api && api.nfts.length > 0) {
        setNfts(api.nfts)
      } else {
        setNfts(await getWalletNfts(connection, publicKey))
      }
    } catch {
      setNfts([])
    } finally {
      setNftsLoading(false)
    }
  }, [connection, publicKey])

  useEffect(() => {
    void loadNfts()
  }, [loadNfts])

  const toggleNft = (nft: WalletNft) => {
    setSelectedMints((prev) => {
      const next = new Set(prev)
      if (next.has(nft.mint)) {
        next.delete(nft.mint)
        return next
      }
      if (next.size >= OWL_SWAP_MAX_NFTS_PER_SIDE) return prev
      next.add(nft.mint)
      return next
    })
    setError(null)
  }

  const ensureSignedIn = async (): Promise<boolean> => {
    await checkSession()
    if (sessionWallet === wallet) return true
    const ok = await signIn()
    return ok === true
  }

  const scrollToPicker = () => {
    document
      .getElementById('owl-swap-accept-picker')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const acceptOffer = async () => {
    if (!publicKey || !wallet || !offer) return
    setError(null)
    setNotice(null)
    if (offer.status !== 'open') {
      setError(`Offer is ${offer.status}.`)
      setLocalPhase('failed')
      return
    }
    if (offer.maker_wallet === wallet) {
      setError('You cannot accept your own offer.')
      setLocalPhase('failed')
      return
    }
    if (selectedNfts.length < 1 && takerSolLamports <= 0) {
      setError('Select at least one NFT or add SOL.')
      setLocalPhase('failed')
      return
    }
    if (!useSimulate && !escrowAddress) {
      setError(
        'OwlSwap escrow is not configured. Set OWL_SWAP_ESCROW_SECRET_KEY or use admin simulation mode.'
      )
      setLocalPhase('failed')
      return
    }

    setBusy(true)
    setLocalPhase('submitting')
    try {
      const signed = await ensureSignedIn()
      if (!signed) {
        setError(signInError ?? 'Sign in required.')
        setLocalPhase('failed')
        return
      }

      let signature: string
      if (useSimulate || !escrowAddress) {
        setNotice('Simulation mode — accepting without on-chain deposit…')
        signature = makeOwlSwapSimulateSignature('taker-deposit', offer.id)
      } else {
        setLocalPhase('awaiting_signature')
        setNotice('Approve deposit + Owl fee in your wallet…')
        const built = await buildOwlSwapTakerDepositTx({
          connection,
          owner: publicKey,
          escrowAddress,
          mints: selectedNfts.map((n) => ({
            mint: n.mint,
            name: n.name,
            tokenAccount: n.tokenAccount,
          })),
          solLamports: takerSolLamports,
          feeLamports,
        })
        if (!built.ok) {
          setError(built.error)
          setLocalPhase('failed')
          return
        }

        const { blockhash } = await connection.getLatestBlockhash('confirmed')
        built.tx.feePayer = publicKey
        built.tx.recentBlockhash = blockhash

        try {
          signature = await sendTransaction(built.tx, connection, {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (/reject|cancel|denied/i.test(msg)) {
            setLocalPhase('rejected')
            setError(msg)
            return
          }
          throw e
        }
        setLocalPhase('pending_confirmation')
        await confirmSignatureSuccessOnChain(
          connection,
          signature,
          120_000,
          'If the deposit shows in your wallet, wait a moment then we will settle.'
        )
        setNotice('Settling swap…')
        setLocalPhase('submitting')
      }

      const res = await fetch(`/api/owl-swap/offers/${offer.id}/accept`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-connected-wallet': wallet,
        },
        body: JSON.stringify({
          takerWallet: wallet,
          takerMints: selectedNfts.map((n) => ({
            mint: n.mint,
            name: n.name,
            imageUrl: n.image,
          })),
          takerSolLamports,
          depositSignature: signature,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Accept failed')
        setLocalPhase('failed')
        return
      }
      const sig = typeof data?.settleSig === 'string' ? data.settleSig : null
      setSettleSig(sig)
      setLocalPhase('idle')
      setNotice(
        data?.simulate || useSimulate
          ? 'Simulated swap completed (DB only — nothing moved on-chain).'
          : 'Swap completed.'
      )
      void loadOffer()
      void loadNfts()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setLocalPhase(/reject|cancel|denied/i.test(msg) ? 'rejected' : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const onPrimary = () => {
    if (!signedIn) {
      void ensureSignedIn()
      return
    }
    void acceptOffer()
  }

  if (access.loading || sessionChecking || offerLoading) {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading offer…
      </div>
    )
  }

  if (!access.allowed) {
    if (!connected || !publicKey) {
      return (
        <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
          <ArrowLeftRight className="h-10 w-10 text-theme-prime" />
          <h1 className="font-display text-3xl tracking-wide text-white">OwlSwap</h1>
          <p className="text-sm text-muted-foreground">
            {isPublic
              ? 'Connect a wallet to view and accept this offer.'
              : 'Admin preview — connect an admin wallet to continue.'}
          </p>
          <WalletConnectButton />
        </div>
      )
    }
    if (access.denied) {
      return (
        <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
          <ArrowLeftRight className="h-10 w-10 text-theme-prime" />
          <h1 className="font-display text-3xl tracking-wide text-white">OwlSwap</h1>
          <p className="text-sm text-muted-foreground">
            Coming soon. Only site admins can preview OwlSwap before public launch.
          </p>
        </div>
      )
    }
  }

  if (offerError || !offer) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-16 text-center">
        <h1 className="font-display text-3xl text-theme-prime">Offer not found</h1>
        <p className="text-sm text-muted-foreground">{offerError ?? 'Unknown code.'}</p>
        <Button asChild variant="outline" className="min-h-[44px]">
          <Link href="/owl-swap">Back to OwlSwap</Link>
        </Button>
      </div>
    )
  }

  const isComplete = offer.status === 'completed' && Boolean(effectiveSettleSig)

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-4 sm:py-10">
      {!isPublic ? (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <Shield className="h-4 w-4 shrink-0" />
          Admin preview · offer {offer.short_code} · from {shorten(offer.maker_wallet)}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Offer {offer.short_code} · from {shorten(offer.maker_wallet)}
        </p>
      )}
      {useSimulate ? (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
          Simulation mode — accept runs in the DB only;{' '}
          <strong className="font-semibold">no NFTs or SOL move on-chain</strong>.
        </p>
      ) : null}
      {!escrowAddress && !useSimulate ? <OwlSwapMissingEscrowAlert /> : null}

      {isComplete ? (
        <Card className="border-emerald-500/40 bg-emerald-500/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-50">
              <CheckCircle2 className="h-5 w-5" /> Swap complete
            </CardTitle>
            <CardDescription className="text-emerald-100/80">
              Settle sig: {shorten(effectiveSettleSig || '')}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {offer.status === 'open' && connected && publicKey ? (
        <>
          <OwlSwapTradingRoom
            mode="accept"
            offerAssets={offerAssets}
            receiveAssets={receiveAssets}
            offerSolLamports={takerSolLamports}
            receiveSolLamports={offer.maker_sol_lamports}
            txState={txState}
            errorDetail={error}
            feeSolLabel={feeSolLabel}
            feeAvailable={feeAvailable || useSimulate}
            discountPercent={holderQuote?.discountPercent ?? 0}
            roleName={holderQuote?.roleName ?? null}
            ctaLabel={
              !signedIn
                ? 'Sign in to accept'
                : useSimulate
                  ? 'Accept simulated swap →'
                  : `Accept & pay ${formatOwlSwapFeeSol(feeSolDisplay)} →`
            }
            ctaDisabled={
              busy ||
              (!signedIn ? signingIn : !ctaEnabled) ||
              (!escrowAddress && !useSimulate)
            }
            busy={busy}
            onPrimary={onPrimary}
            onChangeOffer={scrollToPicker}
            offerEmptyCopy="Add NFTs below to trade"
            receiveEmptyCopy="Maker assets loading…"
            helperText="You pay the Owl fee on accept. Review both chambers before signing."
          />
          <span className="sr-only" data-review-epoch={reviewEpoch} />

          <section id="owl-swap-accept-picker" className="scroll-mt-24 space-y-3">
            <h2 className="font-display text-xl tracking-wide text-white">Your side</h2>
            {nftsLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading NFTs…
              </p>
            ) : null}
            <WalletNftPicker
              nfts={nfts}
              searchQuery={nftSearchQuery}
              onSearchQueryChange={setNftSearchQuery}
              selectionMode="multi"
              maxSelect={OWL_SWAP_MAX_NFTS_PER_SIDE}
              selectedMints={selectedMints}
              onToggle={toggleNft}
              searchInputId="owl-swap-accept-nft-search"
              dialogTitle="Select NFTs to trade"
              dialogDescription="These go into escrow with the Owl fee in one approval."
            />
            <div className="space-y-2">
              <Label htmlFor="owl-swap-accept-sol">Optional SOL sweetener</Label>
              <Input
                id="owl-swap-accept-sol"
                inputMode="decimal"
                placeholder="0.0"
                value={solSweetener}
                onChange={(e) => setSolSweetener(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
          </section>
        </>
      ) : offer.status === 'open' && (!connected || !publicKey) ? (
        <div className="space-y-4">
          <OwlSwapTradingRoom
            mode="accept"
            offerAssets={[]}
            receiveAssets={receiveAssets}
            receiveSolLamports={offer.maker_sol_lamports}
            txState="idle_review"
            feeSolLabel={null}
            feeAvailable={false}
            ctaLabel="Connect wallet to accept"
            ctaDisabled
            onPrimary={() => {}}
            receiveEmptyCopy="Maker assets"
            helperText="Connect a wallet to choose your side and accept."
          />
          <div className="flex justify-center">
            <WalletConnectButton />
          </div>
        </div>
      ) : !isComplete ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          This offer is {offer.status} and cannot be accepted.
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {notice}
        </p>
      ) : null}

      <p className="text-center text-sm">
        <Link href="/owl-swap" className="text-emerald-200 underline-offset-4 hover:underline">
          Create your own offer
        </Link>
      </p>
    </div>
  )
}

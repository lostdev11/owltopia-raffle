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
import type { OwlSendHolderRoleName } from '@/lib/owl-send/holder-discount'
import type { OwlSwapOfferAssetRow, OwlSwapOfferRow } from '@/lib/db/owl-swap'

type HolderFeeQuote = {
  discountBps: number
  discountPercent: number
  roleName: OwlSendHolderRoleName | null
  feeLamportsTotal: number
  feeSolPerLineLabel: string
}

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

  const [offer, setOffer] = useState<(OwlSwapOfferRow & { assets?: OwlSwapOfferAssetRow[] }) | null>(
    null
  )
  const [offerLoading, setOfferLoading] = useState(true)
  const [offerError, setOfferError] = useState<string | null>(null)

  const [nfts, setNfts] = useState<WalletNft[]>([])
  const [nftsLoading, setNftsLoading] = useState(false)
  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set())
  const [nftSearchQuery, setNftSearchQuery] = useState('')
  const [solSweetener, setSolSweetener] = useState('')
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null)
  const [holderQuote, setHolderQuote] = useState<HolderFeeQuote | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [settleSig, setSettleSig] = useState<string | null>(null)

  const wallet = publicKey?.toBase58() ?? ''
  const signedIn = Boolean(wallet && sessionWallet && sessionWallet === wallet)
  const feeSolBase = getOwlSwapFeeSol()
  const feeSolDisplay = holderQuote
    ? getOwlSwapFeeSolForDiscount(holderQuote.discountBps)
    : feeSolBase
  const feeLamports = holderQuote?.feeLamportsTotal ?? Math.round(feeSolBase * LAMPORTS_PER_SOL)

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
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && typeof data?.address === 'string') setEscrowAddress(data.address)
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
      .catch(() => {})
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

  const acceptOffer = async () => {
    if (!publicKey || !wallet || !offer) return
    setError(null)
    setNotice(null)
    if (offer.status !== 'open') {
      setError(`Offer is ${offer.status}.`)
      return
    }
    if (offer.maker_wallet === wallet) {
      setError('You cannot accept your own offer.')
      return
    }
    if (selectedNfts.length < 1 && takerSolLamports <= 0) {
      setError('Select at least one NFT or add SOL.')
      return
    }
    if (!escrowAddress) {
      setError('OwlSwap escrow is not configured.')
      return
    }

    setBusy(true)
    try {
      const signed = await ensureSignedIn()
      if (!signed) {
        setError(signInError ?? 'Sign in required.')
        return
      }

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
        return
      }

      const { blockhash } = await connection.getLatestBlockhash('confirmed')
      built.tx.feePayer = publicKey
      built.tx.recentBlockhash = blockhash

      const signature = await sendTransaction(built.tx, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
      await confirmSignatureSuccessOnChain(
        connection,
        signature,
        120_000,
        'If the deposit shows in your wallet, wait a moment then we will settle.'
      )

      setNotice('Settling swap…')
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
        return
      }
      setSettleSig(typeof data?.settleSig === 'string' ? data.settleSig : null)
      setNotice('Swap completed.')
      void loadOffer()
      void loadNfts()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
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

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-3 py-6 sm:px-4 sm:py-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Accept offer</p>
        <h1 className="font-display text-3xl tracking-wide text-theme-prime">
          OwlSwap · {offer.short_code}
        </h1>
        {!isPublic ? (
          <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            <Shield className="h-4 w-4 shrink-0" />
            Admin preview
          </p>
        ) : null}
      </header>

      <Card className="border-white/10 bg-black/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Maker offers</CardTitle>
          <CardDescription>
            From {shorten(offer.maker_wallet)} · status {offer.status}
            {offer.maker_sol_lamports > 0
              ? ` · +${(offer.maker_sol_lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {makerAssets.map((a) => (
              <li key={a.id} className="flex items-center gap-3 text-sm">
                {a.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.image_url}
                    alt=""
                    className="h-10 w-10 rounded object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 rounded bg-white/10" />
                )}
                <span>{a.name || shorten(a.mint)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {offer.status === 'completed' || settleSig ? (
        <Card className="border-emerald-500/40 bg-emerald-500/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-50">
              <CheckCircle2 className="h-5 w-5" /> Swap complete
            </CardTitle>
            <CardDescription className="text-emerald-100/80">
              {settleSig || offer.settle_sig
                ? `Settle sig: ${shorten(settleSig || offer.settle_sig || '')}`
                : 'Assets have been exchanged.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : offer.status !== 'open' ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          This offer is {offer.status} and cannot be accepted.
        </p>
      ) : !connected || !publicKey ? (
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted-foreground">Connect to accept this swap.</p>
          <WalletConnectButton />
        </div>
      ) : (
        <>
          <Card className="border-emerald-500/20 bg-black/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-emerald-100">Your cost</CardTitle>
              <CardDescription>
                Owl fee (you pay on accept): {formatOwlSwapFeeSol(feeSolDisplay)}
                {holderQuote && holderQuote.discountPercent > 0
                  ? ` (${holderQuote.roleName ?? 'holder'} ${holderQuote.discountPercent}% off)`
                  : ''}
              </CardDescription>
            </CardHeader>
          </Card>

          <section className="space-y-3">
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

          {!signedIn ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] w-full"
              disabled={signingIn || busy}
              onClick={() => void ensureSignedIn()}
            >
              {signingIn ? 'Signing in…' : 'Sign in to accept'}
            </Button>
          ) : null}

          <Button
            type="button"
            className="min-h-[44px] w-full touch-manipulation bg-theme-prime text-black hover:bg-theme-prime/90"
            disabled={
              busy ||
              !escrowAddress ||
              (selectedNfts.length < 1 && takerSolLamports <= 0)
            }
            onClick={() => void acceptOffer()}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working…
              </>
            ) : (
              `Accept & pay ${formatOwlSwapFeeSol(feeSolDisplay)}`
            )}
          </Button>
        </>
      )}

      {notice ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
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

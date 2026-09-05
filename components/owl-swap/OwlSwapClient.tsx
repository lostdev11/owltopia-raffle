'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import {
  ArrowLeftRight,
  Check,
  Copy,
  Loader2,
  Shield,
  Trash2,
} from 'lucide-react'
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
import {
  OWL_SWAP_MAX_NFTS_PER_SIDE,
  OWL_SWAP_MAX_OPEN_OFFERS_PER_WALLET,
} from '@/lib/owl-swap/constants'
import {
  formatOwlSwapFeeSol,
  getOwlSwapFeeSol,
  getOwlSwapFeeSolForDiscount,
} from '@/lib/owl-swap/fee'
import { buildOwlSwapMakerDepositTx } from '@/lib/owl-swap/build-deposit-tx'
import type { OwlSendHolderRoleName } from '@/lib/owl-send/holder-discount'
import type { OwlSwapOfferRow } from '@/lib/db/owl-swap'
import { cn } from '@/lib/utils'

type HolderFeeQuote = {
  discountBps: number
  discountPercent: number
  roleName: OwlSendHolderRoleName | null
  gen1Count: number
  gen2Count: number
  checkAvailable: boolean
  feeLamportsTotal: number
  feeSolPerLineLabel: string
}

type Props = {
  initialViewerIsAdmin: boolean
  isPublic: boolean
}

function shorten(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

export function OwlSwapClient({ initialViewerIsAdmin, isPublic }: Props) {
  const { connection } = useConnection()
  const { publicKey, connected } = useWallet()
  const sendTransaction = useSendTransactionForWallet()
  const access = useOwlSwapAdminAccess({ initialViewerIsAdmin, isPublic })
  const { sessionWallet, checking: sessionChecking, checkSession } = useSiwsSession()
  const { signIn, signingIn, error: signInError } = useSiwsSignIn()

  const [nfts, setNfts] = useState<WalletNft[]>([])
  const [nftsLoading, setNftsLoading] = useState(false)
  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set())
  const [nftSearchQuery, setNftSearchQuery] = useState('')
  const [solSweetener, setSolSweetener] = useState('')
  const [step, setStep] = useState<'pick' | 'review' | 'done'>('pick')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sharePath, setSharePath] = useState<string | null>(null)
  const [shareCode, setShareCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null)
  const [holderQuote, setHolderQuote] = useState<HolderFeeQuote | null>(null)
  const [myOffers, setMyOffers] = useState<OwlSwapOfferRow[]>([])
  const [offersLoading, setOffersLoading] = useState(false)

  const wallet = publicKey?.toBase58() ?? ''
  const signedIn = Boolean(wallet && sessionWallet && sessionWallet === wallet)
  const feeSolBase = getOwlSwapFeeSol()
  const feeSolDisplay = holderQuote
    ? getOwlSwapFeeSolForDiscount(holderQuote.discountBps)
    : feeSolBase

  const selectedNfts = useMemo(
    () => nfts.filter((n) => selectedMints.has(n.mint)),
    [nfts, selectedMints]
  )

  const makerSolLamports = useMemo(() => {
    const n = Number(solSweetener)
    if (!Number.isFinite(n) || n <= 0) return 0
    return Math.round(n * LAMPORTS_PER_SOL)
  }, [solSweetener])

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
        const onchain = await getWalletNfts(connection, publicKey)
        setNfts(onchain)
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

  useEffect(() => {
    let cancelled = false
    fetch('/api/owl-swap/escrow', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (typeof data?.address === 'string') setEscrowAddress(data.address)
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
    fetch(`/api/owl-swap/holder-fee?wallet=${encodeURIComponent(wallet)}`, {
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data || data.error) return
        setHolderQuote({
          discountBps: Number(data.discountBps) || 0,
          discountPercent: Number(data.discountPercent) || 0,
          roleName: data.roleName ?? null,
          gen1Count: Number(data.gen1Count) || 0,
          gen2Count: Number(data.gen2Count) || 0,
          checkAvailable: data.checkAvailable === true,
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

  const loadMyOffers = useCallback(async () => {
    if (!wallet || !signedIn) {
      setMyOffers([])
      return
    }
    setOffersLoading(true)
    try {
      const res = await fetch('/api/owl-swap/offers/mine?limit=20', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'x-connected-wallet': wallet },
      })
      const data = await res.json().catch(() => null)
      if (res.ok && Array.isArray(data?.offers)) {
        setMyOffers(data.offers)
      }
    } catch {
      /* ignore */
    } finally {
      setOffersLoading(false)
    }
  }, [wallet, signedIn])

  useEffect(() => {
    void loadMyOffers()
  }, [loadMyOffers])

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

  const createAndDeposit = async () => {
    if (!publicKey || !wallet) return
    setError(null)
    setNotice(null)
    if (selectedNfts.length < 1) {
      setError('Select at least one NFT.')
      return
    }
    if (!escrowAddress) {
      setError('OwlSwap escrow is not configured on the server.')
      return
    }

    setBusy(true)
    try {
      const signed = await ensureSignedIn()
      if (!signed) {
        setError(signInError ?? 'Sign in required to create an offer.')
        return
      }

      const createRes = await fetch('/api/owl-swap/offers', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-connected-wallet': wallet,
        },
        body: JSON.stringify({
          makerWallet: wallet,
          makerMints: selectedNfts.map((n) => ({
            mint: n.mint,
            name: n.name,
            imageUrl: n.image,
          })),
          makerSolLamports,
        }),
      })
      const createData = await createRes.json().catch(() => null)
      if (!createRes.ok) {
        setError(
          typeof createData?.error === 'string' ? createData.error : 'Failed to create offer'
        )
        return
      }

      const offerId = createData?.offer?.id as string
      const code = createData?.offer?.short_code as string
      if (!offerId || !code) {
        setError('Offer created but response was incomplete.')
        return
      }

      setNotice('Approve the deposit in your wallet…')
      const built = await buildOwlSwapMakerDepositTx({
        connection,
        owner: publicKey,
        escrowAddress,
        mints: selectedNfts.map((n) => ({
          mint: n.mint,
          name: n.name,
          tokenAccount: n.tokenAccount,
        })),
        solLamports: makerSolLamports,
      })
      if (!built.ok) {
        setError(built.error)
        return
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      built.tx.feePayer = publicKey
      built.tx.recentBlockhash = blockhash

      const signature = await sendTransaction(built.tx, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
      void lastValidBlockHeight
      await confirmSignatureSuccessOnChain(
        connection,
        signature,
        120_000,
        'If the deposit shows in your wallet, wait a moment and the confirm step will retry.'
      )

      setNotice('Confirming deposit on-chain…')
      const confirmRes = await fetch(`/api/owl-swap/offers/${offerId}/confirm-deposit`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-connected-wallet': wallet,
        },
        body: JSON.stringify({ signature }),
      })
      const confirmData = await confirmRes.json().catch(() => null)
      if (!confirmRes.ok) {
        setError(
          typeof confirmData?.error === 'string'
            ? confirmData.error
            : 'Deposit landed but confirm failed — retry from My offers or contact admin.'
        )
        return
      }

      const path =
        typeof confirmData?.sharePath === 'string'
          ? confirmData.sharePath
          : `/owl-swap/o/${code}`
      setSharePath(path)
      setShareCode(code)
      setStep('done')
      setNotice('Offer is live — share the link with your counterparty.')
      setSelectedMints(new Set())
      setSolSweetener('')
      void loadMyOffers()
      void loadNfts()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  const cancelOffer = async (offerId: string) => {
    if (!wallet) return
    setBusy(true)
    setError(null)
    try {
      const signed = await ensureSignedIn()
      if (!signed) {
        setError('Sign in required.')
        return
      }
      const res = await fetch(`/api/owl-swap/offers/${offerId}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-connected-wallet': wallet },
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Cancel failed')
        return
      }
      setNotice('Offer cancelled.')
      void loadMyOffers()
      void loadNfts()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const copyShare = async () => {
    if (!sharePath || typeof window === 'undefined') return
    const url = `${window.location.origin}${sharePath}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy — select the link manually.')
    }
  }

  if (access.loading || sessionChecking) {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
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
              ? 'Connect a wallet to create a P2P NFT swap offer.'
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
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    )
  }

  if (!connected || !publicKey) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <ArrowLeftRight className="h-10 w-10 text-theme-prime" />
        <h1 className="font-display text-3xl tracking-wide text-white">OwlSwap</h1>
        <p className="text-sm text-muted-foreground">Connect your wallet to create a swap offer.</p>
        <WalletConnectButton />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-3 py-6 sm:px-4 sm:py-10">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 font-display text-3xl tracking-wide text-theme-prime sm:text-4xl">
          <ArrowLeftRight className="h-7 w-7" />
          OwlSwap
        </h1>
        <p className="text-sm text-muted-foreground">
          Create an offer, share the link, counterparty accepts. Classic SPL NFTs — max{' '}
          {OWL_SWAP_MAX_NFTS_PER_SIDE} per side.
        </p>
        {!isPublic ? (
          <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            <Shield className="h-4 w-4 shrink-0" />
            Admin preview — set <code className="text-xs">OWL_SWAP_PUBLIC</code> to go live.
          </p>
        ) : null}
      </header>

      <Card className="border-emerald-500/20 bg-black/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-emerald-100">Cost note</CardTitle>
          <CardDescription>
            You pay network / ATA rent to deposit. The taker pays the Owl fee on accept (
            {formatOwlSwapFeeSol(feeSolDisplay)}
            {holderQuote && holderQuote.discountPercent > 0
              ? ` — ${holderQuote.roleName ?? 'holder'} ${holderQuote.discountPercent}% off`
              : ''}
            ).
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {holderQuote?.checkAvailable === false
            ? 'Holder discount check unavailable — showing base fee.'
            : `Quoted for your wallet: ${holderQuote?.feeSolPerLineLabel ?? formatOwlSwapFeeSol(feeSolBase)}.`}
        </CardContent>
      </Card>

      {step === 'done' && sharePath ? (
        <Card className="border-emerald-500/40 bg-emerald-500/10">
          <CardHeader>
            <CardTitle className="text-lg text-emerald-50">Offer ready</CardTitle>
            <CardDescription className="text-emerald-100/80">
              Share this link. Assets sit in OwlSwap escrow until they accept or you cancel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="break-all rounded-md border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm">
              {typeof window !== 'undefined'
                ? `${window.location.origin}${sharePath}`
                : sharePath}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="min-h-[44px] touch-manipulation"
                onClick={() => void copyShare()}
              >
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button type="button" variant="outline" className="min-h-[44px]" asChild>
                <Link href={sharePath}>Open accept page</Link>
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-[44px]"
                onClick={() => {
                  setStep('pick')
                  setSharePath(null)
                  setShareCode(null)
                  setNotice(null)
                }}
              >
                Create another
              </Button>
            </div>
            {shareCode ? (
              <p className="text-xs text-muted-foreground">Code: {shareCode}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step !== 'done' ? (
        <>
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
              searchInputId="owl-swap-nft-search"
              dialogTitle="Select NFTs to offer"
              dialogDescription="Classic SPL NFTs only in Phase 1 — max 5."
            />
            <div className="space-y-2">
              <Label htmlFor="owl-swap-sol">Optional SOL sweetener</Label>
              <Input
                id="owl-swap-sol"
                inputMode="decimal"
                placeholder="0.0"
                value={solSweetener}
                onChange={(e) => setSolSweetener(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
          </section>

          <Card className="border-white/10 bg-black/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Review</CardTitle>
              <CardDescription>
                {selectedNfts.length} NFT(s)
                {makerSolLamports > 0
                  ? ` + ${(makerSolLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`
                  : ''}{' '}
                · counterparty pays ~{formatOwlSwapFeeSol(feeSolDisplay)} Owl fee
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedNfts.length > 0 ? (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {selectedNfts.map((n) => (
                    <li key={n.mint}>
                      {n.name || shorten(n.mint)}{' '}
                      <span className="font-mono text-xs opacity-70">{shorten(n.mint)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No NFTs selected yet.</p>
              )}
              {!signedIn ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px] w-full touch-manipulation"
                  disabled={signingIn || busy}
                  onClick={() => void ensureSignedIn()}
                >
                  {signingIn ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…
                    </>
                  ) : (
                    'Sign in to create offer'
                  )}
                </Button>
              ) : null}
              <Button
                type="button"
                className="min-h-[44px] w-full touch-manipulation bg-theme-prime text-black hover:bg-theme-prime/90"
                disabled={busy || selectedNfts.length < 1 || !escrowAddress}
                onClick={() => void createAndDeposit()}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working…
                  </>
                ) : (
                  'Create offer & deposit'
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Max {OWL_SWAP_MAX_OPEN_OFFERS_PER_WALLET} open/draft offers per wallet.
                {!escrowAddress ? ' Escrow address unavailable (503).' : ''}
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}

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

      <Card className="border-white/10 bg-black/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">My offers</CardTitle>
          <CardDescription>Cancel open or draft offers to reclaim deposits.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {offersLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : myOffers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No offers yet.</p>
          ) : (
            <ul className="space-y-2">
              {myOffers.map((o) => (
                <li
                  key={o.id}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 px-3 py-2 text-sm'
                  )}
                >
                  <div className="min-w-0">
                    <Link
                      href={`/owl-swap/o/${o.short_code}`}
                      className="font-mono text-emerald-200 underline-offset-2 hover:underline"
                    >
                      {o.short_code}
                    </Link>
                    <span className="ml-2 text-muted-foreground">{o.status}</span>
                  </div>
                  {o.status === 'open' || o.status === 'draft' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-[40px] touch-manipulation"
                      disabled={busy}
                      onClick={() => void cancelOffer(o.id)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Landmark } from 'lucide-react'

type BuyoutApiState = {
  eligible: boolean
  reason: string | null
  treasuryWallet: string | null
  buyoutFeeBps: number
  winnerWallet: string | null
  buyoutClosedAt: string | null
  offers: Array<{
    id: string
    bidderDisplay: string
    currency: string
    amount: number
    status: string
    createdAt: string
    expiresAt: string | null
    activatedAt: string | null
  }>
}

async function signInWithWallet(
  walletAddr: string,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>
): Promise<boolean> {
  const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
    credentials: 'include',
  })
  if (!nonceRes.ok) return false
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
  return verifyRes.ok
}

export function RaffleBuyoutPanel({
  raffleId,
  winnerWallet,
}: {
  raffleId: string
  winnerWallet: string | null
}) {
  const router = useRouter()
  const { connection } = useConnection()
  const { publicKey, connected, sendTransaction, signMessage } = useWallet()
  const [state, setState] = useState<BuyoutApiState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [amountStr, setAmountStr] = useState('0.5')
  const [busy, setBusy] = useState(false)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/raffles/${encodeURIComponent(raffleId)}/buyout`, {
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json?.error === 'string' ? json.error : 'Could not load buyout')
        setState(null)
        return
      }
      setState(json as BuyoutApiState)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setState(null)
    } finally {
      setLoading(false)
    }
  }, [raffleId])

  useEffect(() => {
    void load()
  }, [load])

  const walletAddr = publicKey?.toBase58() ?? ''
  const isWinner = !!winnerWallet?.trim() && walletAddr === winnerWallet.trim()

  const placeBidSol = async () => {
    if (!connected || !publicKey || !sendTransaction) {
      setError('Connect your wallet to place a buyout bid.')
      return
    }
    const amount = parseFloat(amountStr)
    if (!Number.isFinite(amount) || amount < 0.01) {
      setError('Enter at least 0.01 SOL.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      let res = await fetch(`/api/raffles/${encodeURIComponent(raffleId)}/buyout/offers`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Connected-Wallet': walletAddr },
        body: JSON.stringify({ amount, currency: 'SOL' }),
      })
      if (res.status === 401 && signMessage) {
        const okIn = await signInWithWallet(walletAddr, signMessage)
        if (!okIn) {
          setError('Sign in with your wallet to place a bid.')
          setBusy(false)
          return
        }
        res = await fetch(`/api/raffles/${encodeURIComponent(raffleId)}/buyout/offers`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Connected-Wallet': walletAddr },
          body: JSON.stringify({ amount, currency: 'SOL' }),
        })
      }

      const created = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof created?.error === 'string' ? created.error : 'Could not create offer')
        setBusy(false)
        return
      }

      const treasuryWallet = created.treasuryWallet as string
      const offerId = created.offerId as string
      if (!treasuryWallet || !offerId) {
        setError('Invalid server response')
        setBusy(false)
        return
      }

      const lamports = Math.round(amount * LAMPORTS_PER_SOL)
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(treasuryWallet),
          lamports,
        }),
      )

      let latest = await connection.getLatestBlockhash('confirmed')
      tx.recentBlockhash = latest.blockhash
      tx.feePayer = publicKey

      const sig = await sendTransaction(tx, connection, { skipPreflight: false })

      let confirmRes = await fetch(
        `/api/raffles/${encodeURIComponent(raffleId)}/buyout/offers/${encodeURIComponent(offerId)}/confirm`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Connected-Wallet': walletAddr },
          body: JSON.stringify({ transactionSignature: sig }),
        },
      )

      if (confirmRes.status === 401 && signMessage) {
        await signInWithWallet(walletAddr, signMessage)
        confirmRes = await fetch(
          `/api/raffles/${encodeURIComponent(raffleId)}/buyout/offers/${encodeURIComponent(offerId)}/confirm`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-Connected-Wallet': walletAddr },
            body: JSON.stringify({ transactionSignature: sig }),
          },
        )
      }

      const confirmJson = await confirmRes.json().catch(() => ({}))
      if (!confirmRes.ok) {
        setError(typeof confirmJson?.error === 'string' ? confirmJson.error : 'Deposit confirmation failed')
        setBusy(false)
        return
      }

      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const acceptOffer = async (offerId: string) => {
    if (!signMessage) {
      setError('Wallet cannot sign messages')
      return
    }
    setAcceptingId(offerId)
    setError(null)
    try {
      let res = await fetch(
        `/api/raffles/${encodeURIComponent(raffleId)}/buyout/offers/${encodeURIComponent(offerId)}/accept`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Connected-Wallet': walletAddr },
        },
      )
      if (res.status === 401) {
        const okIn = await signInWithWallet(walletAddr, signMessage)
        if (!okIn) {
          setError('Sign in to accept an offer.')
          return
        }
        res = await fetch(
          `/api/raffles/${encodeURIComponent(raffleId)}/buyout/offers/${encodeURIComponent(offerId)}/accept`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-Connected-Wallet': walletAddr },
          },
        )
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json?.error === 'string' ? json.error : 'Accept failed')
        return
      }
      if (json.redirectToDashboard) {
        router.push('/dashboard')
        return
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Accept failed')
    } finally {
      setAcceptingId(null)
    }
  }

  if (loading || !state) {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
        Loading buyout…
      </div>
    )
  }

  if (!state.eligible) {
    return (
      <Card className="mb-4 border-border/50 bg-muted/25">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            NFT buyout offers
          </CardTitle>
          <CardDescription className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
            {state.reason ??
              'Buyout bidding is not open yet. After the raffle ends and a winner is selected, anyone can deposit a SOL bid here; offers last 24 hours once confirmed.'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const feePct = (state.buyoutFeeBps / 100).toFixed(2)

  return (
    <Card className="mb-4 border-border/60 bg-card/90">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          NFT buyout offers
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          After the draw, anyone can bid SOL for this prize NFT. Deposits go to the platform treasury; offers stay
          open for 24 hours after your deposit confirms. The winner may accept one offer — the platform keeps {feePct}%
          and sends the rest to the winner. If your bid loses or expires, reclaim SOL from{' '}
          <Link href="/dashboard" className="underline touch-manipulation">
            Dashboard
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {state.offers.length > 0 && (
          <ul className="space-y-2 text-sm">
            {state.offers.map((o) => (
              <li
                key={o.id}
                className="flex flex-col gap-2 rounded-md border border-border/50 bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="tabular-nums">
                  <span className="font-medium">
                    {o.amount} {o.currency}
                  </span>{' '}
                  <span className="text-muted-foreground">from {o.bidderDisplay}</span>
                  <span className="ml-2 text-xs uppercase text-muted-foreground">{o.status}</span>
                </div>
                {isWinner && o.status === 'active' && (
                  <Button
                    type="button"
                    size="sm"
                    className="touch-manipulation min-h-[44px] w-full sm:w-auto sm:min-h-9"
                    disabled={acceptingId === o.id}
                    onClick={() => acceptOffer(o.id)}
                  >
                    {acceptingId === o.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                        Accepting…
                      </>
                    ) : (
                      'Accept offer'
                    )}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!state.buyoutClosedAt && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label htmlFor="buyout-amount" className="text-xs font-medium text-muted-foreground">
                Your bid (SOL)
              </label>
              <Input
                id="buyout-amount"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="touch-manipulation min-h-[44px]"
                disabled={busy}
              />
            </div>
            <Button
              type="button"
              className="touch-manipulation min-h-[44px] w-full sm:w-auto"
              disabled={busy || !connected}
              onClick={() => void placeBidSol()}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Working…
                </>
              ) : (
                'Deposit bid'
              )}
            </Button>
          </div>
        )}

        {!connected && (
          <p className="text-xs text-muted-foreground">Connect a wallet to place a bid (SOL only on this screen).</p>
        )}
      </CardContent>
    </Card>
  )
}

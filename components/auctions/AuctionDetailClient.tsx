'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ArrowLeft } from 'lucide-react'
import { getTokenInfo } from '@/lib/tokens'
import type { NftAuctionPublic } from '@/lib/auctions/types'

type BidRow = {
  id: string
  bidder_wallet: string
  amount: number
  currency: string
  status: string
  activated_at: string | null
  created_at: string
}

function shortWallet(w: string): string {
  if (w.length < 10) return w
  return `${w.slice(0, 4)}…${w.slice(-4)}`
}

function countdown(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 'Ended'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h ${m}m ${sec}s`
}

export function AuctionDetailClient({ slug }: { slug: string }) {
  const { connection } = useConnection()
  const { publicKey, connected } = useWallet()
  const sendTransaction = useSendTransactionForWallet()

  const [auction, setAuction] = useState<NftAuctionPublic | null>(null)
  const [bids, setBids] = useState<BidRow[]>([])
  const [viewerIsCreator, setViewerIsCreator] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bidAmount, setBidAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/auctions/${encodeURIComponent(slug)}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Failed to load')
        setAuction(null)
        return
      }
      const a = json.auction as NftAuctionPublic
      setAuction(a)
      setBids((json.bids || []) as BidRow[])
      setViewerIsCreator(!!json.viewer_is_creator)
      setBidAmount(String(a.min_next_bid))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const placeBid = async () => {
    if (!auction || !connected || !publicKey || !sendTransaction) {
      setError('Connect your wallet to bid.')
      return
    }
    const amount = Number(bidAmount)
    if (!Number.isFinite(amount) || amount < auction.min_next_bid) {
      setError(`Bid must be at least ${auction.min_next_bid} ${auction.bid_currency}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const createRes = await fetch(`/api/auctions/${encodeURIComponent(auction.id)}/bids`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      const created = await createRes.json().catch(() => ({}))
      if (!createRes.ok) {
        throw new Error(typeof created.error === 'string' ? created.error : 'Could not create bid')
      }
      const depositWallet = created.deposit_wallet as string
      const bidId = created.bid?.id as string
      if (!depositWallet || !bidId) throw new Error('Invalid bid response')

      let sig: string
      if (auction.bid_currency === 'SOL') {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(depositWallet),
            lamports: Math.round(amount * LAMPORTS_PER_SOL),
          })
        )
        const latest = await connection.getLatestBlockhash('confirmed')
        tx.recentBlockhash = latest.blockhash
        tx.feePayer = publicKey
        sig = await sendTransaction(tx, connection, { skipPreflight: false })
      } else {
        const usdc = getTokenInfo('USDC')
        if (!usdc.mintAddress) throw new Error('USDC not configured')
        const mint = new PublicKey(usdc.mintAddress)
        const escrowPk = new PublicKey(depositWallet)
        const fromAta = await getAssociatedTokenAddress(mint, publicKey)
        const toAta = await getAssociatedTokenAddress(mint, escrowPk)
        const raw = BigInt(Math.round(amount * 10 ** usdc.decimals))
        const tx = new Transaction()
        try {
          await getAccount(connection, toAta)
        } catch {
          tx.add(
            createAssociatedTokenAccountInstruction(publicKey, toAta, escrowPk, mint, TOKEN_PROGRAM_ID)
          )
        }
        tx.add(createTransferInstruction(fromAta, toAta, publicKey, raw, [], TOKEN_PROGRAM_ID))
        const latest = await connection.getLatestBlockhash('confirmed')
        tx.recentBlockhash = latest.blockhash
        tx.feePayer = publicKey
        sig = await sendTransaction(tx, connection, { skipPreflight: false })
      }

      const confirmRes = await fetch(
        `/api/auctions/${encodeURIComponent(auction.id)}/bids/${encodeURIComponent(bidId)}/confirm`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deposit_tx: sig }),
        }
      )
      const confirmJson = await confirmRes.json().catch(() => ({}))
      if (!confirmRes.ok) {
        throw new Error(typeof confirmJson.error === 'string' ? confirmJson.error : 'Confirm failed')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bid failed')
    } finally {
      setBusy(false)
    }
  }

  const claim = async (path: 'claim-prize' | 'claim-proceeds' | 'claim-prize-return') => {
    if (!auction) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/auctions/${encodeURIComponent(auction.id)}/${path}`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof json.error === 'string' ? json.error : 'Claim failed')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Claim failed')
    } finally {
      setBusy(false)
    }
  }

  const verifyDeposit = async () => {
    if (!auction) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/auctions/${encodeURIComponent(auction.id)}/verify-prize-deposit`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof json.error === 'string' ? json.error : 'Verify failed')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verify failed')
    } finally {
      setBusy(false)
    }
  }

  void tick

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading auction…
      </div>
    )
  }

  if (!auction) {
    return (
      <div className="py-16 space-y-4">
        <p className="text-destructive">{error || 'Auction not found'}</p>
        <Button asChild variant="outline">
          <Link href="/auctions">Back</Link>
        </Button>
      </div>
    )
  }

  const wallet = publicKey?.toBase58() ?? ''
  const isWinner = !!auction.winner_wallet && wallet === auction.winner_wallet

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <Button asChild variant="ghost" className="mb-3 -ml-2 min-h-[44px]">
          <Link href="/auctions">
            <ArrowLeft className="h-4 w-4 mr-2" />
            All auctions
          </Link>
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight">{auction.title}</h1>
        {auction.description ? (
          <p className="text-muted-foreground mt-2 text-sm">{auction.description}</p>
        ) : null}
      </div>

      <div className="space-y-2 text-sm border-y border-border/60 py-4">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Status</span>
          <span className="font-medium">{auction.status}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Prize</span>
          <span>
            {auction.prize_type === 'nft'
              ? `NFT ${shortWallet(auction.nft_mint_address || '')}`
              : `${auction.prize_amount} ${auction.prize_type.toUpperCase()}`}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Current / start</span>
          <span>
            {auction.current_bid_amount != null
              ? `${auction.current_bid_amount} ${auction.bid_currency}`
              : `Start ${auction.start_price} ${auction.bid_currency}`}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Reserve</span>
          <span>
            {auction.has_reserve
              ? auction.reserve_met
                ? 'Met'
                : 'Not met (amount hidden)'
              : 'None'}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Ends</span>
          <span>{countdown(auction.ends_at)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Platform fee</span>
          <span>{auction.fee_bps_applied / 100}% ({auction.fee_tier_reason})</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Creator</span>
          <span className="font-mono text-xs">{shortWallet(auction.creator_wallet)}</span>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {auction.status === 'draft' && viewerIsCreator ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Deposit the prize to escrow
            {auction.prize_escrow_address_snapshot
              ? ` (${shortWallet(auction.prize_escrow_address_snapshot)})`
              : ''}{' '}
            then verify to go live.
          </p>
          <Button disabled={busy} onClick={() => void verifyDeposit()} className="min-h-[44px]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Verify prize deposit & go live
          </Button>
        </div>
      ) : null}

      {auction.status === 'live' && !viewerIsCreator ? (
        <div className="space-y-3">
          <label className="text-sm font-medium">
            Place bid (min {auction.min_next_bid} {auction.bid_currency})
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              type="number"
              step="any"
              min={auction.min_next_bid}
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
              className="min-h-[44px]"
            />
            <Button disabled={busy || !connected} onClick={() => void placeBid()} className="min-h-[44px]">
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Bid
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Your bid is held in funds escrow. If outbid, we try to refund automatically; otherwise
            claim refund from this page / dashboard.
          </p>
        </div>
      ) : null}

      {auction.status === 'successful_pending_claims' ? (
        <div className="flex flex-wrap gap-2">
          {isWinner && !auction.prize_claimed_at ? (
            <Button disabled={busy} onClick={() => void claim('claim-prize')} className="min-h-[44px]">
              Claim prize
            </Button>
          ) : null}
          {viewerIsCreator && !auction.creator_claimed_at ? (
            <Button
              disabled={busy}
              onClick={() => void claim('claim-proceeds')}
              className="min-h-[44px]"
            >
              Claim proceeds (net after fee)
            </Button>
          ) : null}
        </div>
      ) : null}

      {auction.status === 'failed_reserve' && viewerIsCreator && !auction.prize_claimed_at ? (
        <Button
          disabled={busy}
          onClick={() => void claim('claim-prize-return')}
          className="min-h-[44px]"
        >
          Reclaim prize (reserve not met)
        </Button>
      ) : null}

      {bids.some((b) => b.status === 'outbid' || b.status === 'expired') && wallet ? (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Your refundable bids</h2>
          {bids
            .filter(
              (b) =>
                (b.status === 'outbid' || b.status === 'expired') && b.bidder_wallet === wallet
            )
            .map((b) => (
              <Button
                key={b.id}
                variant="outline"
                disabled={busy}
                className="min-h-[44px] mr-2"
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    const res = await fetch(
                      `/api/auctions/${encodeURIComponent(auction.id)}/bids/${encodeURIComponent(b.id)}/refund`,
                      { method: 'POST', credentials: 'include' }
                    )
                    const json = await res.json().catch(() => ({}))
                    if (!res.ok) {
                      throw new Error(typeof json.error === 'string' ? json.error : 'Refund failed')
                    }
                    await load()
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Refund failed')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Refund {b.amount} {b.currency}
              </Button>
            ))}
        </div>
      ) : null}

      <div>
        <h2 className="text-sm font-medium mb-2">Bid history</h2>
        {bids.length === 0 ? (
          <p className="text-sm text-muted-foreground">No confirmed bids yet.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {bids.map((b) => (
              <li key={b.id} className="flex justify-between gap-3 border-b border-border/40 py-2">
                <span className="font-mono text-xs">{shortWallet(b.bidder_wallet)}</span>
                <span>
                  {b.amount} {b.currency} · {b.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Transaction } from '@solana/web3.js'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Loader2, Minus, Plus } from 'lucide-react'

import { Gen2PresaleSignInPrompt } from '@/components/gen2-presale/Gen2PresaleSignInPrompt'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { fireGreenConfetti } from '@/lib/confetti'
import { lamportsToSolDisplay } from '@/lib/gen2-presale/format-sol'
import { owlCenterPresaleCreditsRemainingForWallet } from '@/lib/owl-center-presale/db'
import { owlCenterPresaleExplorerTxUrl } from '@/lib/owl-center-presale/confirm-core'
import type { OwlCenterPresaleBalance, OwlCenterPresaleStats } from '@/lib/owl-center-presale/types'
import { cn } from '@/lib/utils'

type Props = {
  slug: string
  stats: OwlCenterPresaleStats | null
  statsLoading?: boolean
  balance?: OwlCenterPresaleBalance | null
  balanceLoading?: boolean
  balanceError?: string | null
  onSignedIn?: () => void
  purchasesOpen: boolean
  presaleSoldOut?: boolean
  onPurchased: (result?: {
    balance?: OwlCenterPresaleBalance
    stats?: Pick<OwlCenterPresaleStats, 'presale_supply' | 'sold' | 'remaining' | 'percent_sold'>
  }) => void
  className?: string
}

type Phase = 'idle' | 'building' | 'signing' | 'confirming'

export function OwlCenterPresalePurchaseCard({
  slug,
  stats,
  statsLoading,
  balance = null,
  balanceLoading = false,
  balanceError = null,
  onSignedIn,
  purchasesOpen,
  presaleSoldOut = false,
  onPurchased,
  className,
}: Props) {
  const theme = stats?.theme
  const primary = theme?.primary ?? '#00FF9C'
  const muted = theme?.muted ?? '#A9CBB9'
  const surface = theme?.surface ?? '#151D24'

  const { connection } = useConnection()
  const { publicKey, sendTransaction, connected } = useWallet()
  const [qty, setQty] = useState(1)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<{ sig: string; qty: number } | null>(null)

  const maxPerPurchase = stats?.max_spots_per_purchase ?? 5
  const maxCredits = stats?.max_credits_per_wallet ?? 20
  const remaining = stats?.remaining ?? 0

  const walletRemaining = useMemo(() => {
    if (balanceLoading && balance == null) return maxCredits
    return owlCenterPresaleCreditsRemainingForWallet(balance, maxCredits)
  }, [balance, balanceLoading, maxCredits])

  const maxQty = Math.min(maxPerPurchase, Math.max(0, remaining), walletRemaining)

  useEffect(() => {
    setQty((q) => {
      if (maxQty < 1) return q
      return Math.min(maxQty, Math.max(1, q))
    })
  }, [maxQty])

  const unitLamports = stats?.unit_lamports ?? null
  const unitPriceUsdc = stats?.unit_price_usdc ?? 20
  const totalLamportsDisplay = useMemo(() => {
    if (!unitLamports) return null
    try {
      return lamportsToSolDisplay(BigInt(unitLamports) * BigInt(qty))
    } catch {
      return null
    }
  }, [unitLamports, qty])

  const busy = phase !== 'idle' && phase !== 'signing'
  const apiBase = `/api/owl-center/presale/${encodeURIComponent(slug)}`

  const buy = useCallback(async () => {
    setError(null)
    setReceipt(null)
    if (!connected || !publicKey) {
      setError('Connect your wallet first.')
      return
    }
    if (maxQty < 1 || presaleSoldOut || !purchasesOpen) {
      setError(presaleSoldOut ? 'Presale is sold out.' : 'Presale purchases are paused.')
      return
    }

    const buyerWallet = publicKey.toBase58()
    try {
      setPhase('building')
      const createRes = await fetch(`${apiBase}/create-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ buyerWallet, quantity: qty }),
      })
      const createJson = (await createRes.json().catch(() => ({}))) as {
        error?: string
        transaction?: string
        recentBlockhash?: string
        lastValidBlockHeight?: number
        expected?: { solUsdPriceUsed?: number }
      }
      if (!createRes.ok) {
        if (createRes.status === 401) throw new Error('Sign in with this wallet below, then try again.')
        throw new Error(createJson.error || 'Could not build transaction.')
      }
      const b64 = createJson.transaction
      const recentBlockhash = createJson.recentBlockhash
      const lastValidBlockHeight = createJson.lastValidBlockHeight
      if (!b64 || !recentBlockhash || lastValidBlockHeight == null) {
        throw new Error('Invalid transaction response from server.')
      }

      const tx = Transaction.from(Buffer.from(b64, 'base64'))
      setPhase('signing')
      const sig = await sendTransaction(tx, connection, { skipPreflight: false })
      setPhase('confirming')
      await connection.confirmTransaction(
        { signature: sig, blockhash: recentBlockhash, lastValidBlockHeight },
        'confirmed'
      )

      const confirmRes = await fetch(`${apiBase}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          buyerWallet,
          quantity: qty,
          txSignature: sig,
          solUsdPriceUsed: createJson.expected?.solUsdPriceUsed,
        }),
      })
      const confirmJson = (await confirmRes.json().catch(() => ({}))) as {
        error?: string
        balance?: OwlCenterPresaleBalance
        stats?: Pick<OwlCenterPresaleStats, 'presale_supply' | 'sold' | 'remaining' | 'percent_sold'>
      }
      if (!confirmRes.ok && confirmRes.status !== 409) {
        throw new Error(confirmJson.error || 'Could not record purchase.')
      }
      if (confirmJson.balance) {
        onPurchased({ balance: confirmJson.balance, stats: confirmJson.stats })
      } else {
        onPurchased()
      }
      setReceipt({ sig, qty })
      fireGreenConfetti()
      setPhase('idle')
    } catch (e) {
      setPhase('idle')
      setError(e instanceof Error ? e.message : 'Purchase failed')
    }
  }, [
    apiBase,
    connected,
    connection,
    maxQty,
    onPurchased,
    presaleSoldOut,
    publicKey,
    purchasesOpen,
    qty,
    sendTransaction,
  ])

  return (
    <div
      id="oc-presale-purchase"
      className={cn('rounded-2xl border p-6', className)}
      style={{ borderColor: `${primary}44`, backgroundColor: `${surface}ee` }}
    >
      <h2 className="text-lg font-bold text-[#EAFBF4]">Buy presale spots</h2>
      <p className="mt-1 text-sm" style={{ color: muted }}>
        ${unitPriceUsdc} USD in SOL per spot. Pay from your connected wallet on mobile or desktop.
      </p>

      {!connected ? (
        <div className="mt-5 space-y-3">
          <WalletConnectButton />
          <p className="text-sm" style={{ color: muted }}>
            Connect Phantom, Solflare, or another Solana wallet to purchase.
          </p>
        </div>
      ) : balanceError ? (
        <Gen2PresaleSignInPrompt
          className="mt-4"
          title="Sign in to purchase"
          message={balanceError}
          onSignedIn={onSignedIn}
        />
      ) : (
        <>
          <div className="mt-5 flex items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-11 min-h-[44px] min-w-[44px] touch-manipulation p-0"
              disabled={busy || maxQty < 1 || qty <= 1}
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              aria-label="Decrease quantity"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="min-w-[3rem] text-center text-2xl font-black tabular-nums text-[#EAFBF4]">{qty}</span>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-11 min-h-[44px] min-w-[44px] touch-manipulation p-0"
              disabled={busy || maxQty < 1 || qty >= maxQty}
              onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
              aria-label="Increase quantity"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {totalLamportsDisplay && (
            <p className="mt-3 text-center text-sm font-semibold tabular-nums" style={{ color: primary }}>
              ≈ {totalLamportsDisplay} SOL total
            </p>
          )}
          <Button
            type="button"
            className="mt-5 h-12 min-h-[48px] w-full touch-manipulation border text-base font-bold"
            disabled={busy || !purchasesOpen || maxQty < 1 || statsLoading}
            onClick={() => void buy()}
            style={{ backgroundColor: `${primary}22`, borderColor: `${primary}66`, color: '#EAFBF4' }}
          >
            {phase === 'building' && (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Preparing…
              </>
            )}
            {phase === 'signing' && 'Approve in wallet…'}
            {phase === 'confirming' && (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirming…
              </>
            )}
            {phase === 'idle' &&
              (presaleSoldOut
                ? 'Sold out'
                : purchasesOpen
                  ? `Buy ${qty} spot${qty === 1 ? '' : 's'}`
                  : 'Presale paused')}
          </Button>
          {walletRemaining < maxCredits && (
            <p className="mt-2 text-center text-xs" style={{ color: muted }}>
              You can buy {walletRemaining} more on this wallet (max {maxCredits} credits).
            </p>
          )}
        </>
      )}

      {error && (
        <p className="mt-4 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      {receipt && (
        <p className="mt-4 text-sm" style={{ color: primary }}>
          Purchase recorded —{' '}
          <a
            href={owlCenterPresaleExplorerTxUrl(receipt.sig)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            view transaction
          </a>
        </p>
      )}
    </div>
  )
}

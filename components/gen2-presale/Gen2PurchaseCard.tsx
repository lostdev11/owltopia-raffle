'use client'

import { useCallback, useMemo, useState } from 'react'
import { Transaction } from '@solana/web3.js'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import { Loader2, Minus, Plus } from 'lucide-react'

import {
  Gen2PresalePurchaseDialog,
  buildSpotLines,
  type Gen2PresalePurchaseReceiptState,
} from '@/components/gen2-presale/Gen2PresalePurchaseDialog'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fireGreenConfetti } from '@/lib/confetti'
import { gen2PresaleExplorerTxUrl } from '@/lib/gen2-presale/explorer'
import { lamportsToSolDisplay } from '@/lib/gen2-presale/format-sol'
import { GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE } from '@/lib/gen2-presale/max-per-purchase'
import type { Gen2PresaleStats } from '@/lib/gen2-presale/types'
import { cn } from '@/lib/utils'

type Props = {
  stats: Gen2PresaleStats | null
  statsLoading?: boolean
  /** False when admin has paused new purchases (`presale_live` on stats). */
  presaleLive: boolean
  onPurchased: () => void
  className?: string
}

type Phase = 'idle' | 'building' | 'signing' | 'confirming' | 'recording'

export function Gen2PurchaseCard({ stats, statsLoading, presaleLive, onPurchased, className }: Props) {
  const router = useRouter()
  const { connection } = useConnection()
  const { publicKey, sendTransaction, connected } = useWallet()
  const [qty, setQty] = useState(1)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [purchaseReceipt, setPurchaseReceipt] = useState<Gen2PresalePurchaseReceiptState | null>(null)

  const remaining = stats?.remaining ?? 657
  const maxQty = Math.min(GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE, Math.max(0, remaining))
  const unitLamports = stats?.unit_lamports ?? null

  /** Match hero fallback when stats has not loaded `unit_price_usdc` yet. */
  const unitPriceUsdc = useMemo(() => {
    const fromStats = stats?.unit_price_usdc
    if (typeof fromStats === 'number' && Number.isFinite(fromStats) && fromStats > 0) return fromStats
    const n = Number(process.env.NEXT_PUBLIC_GEN2_PRESALE_PRICE_USDC)
    return Number.isFinite(n) && n > 0 ? n : 20
  }, [stats?.unit_price_usdc])

  const totalLamportsDisplay = useMemo(() => {
    if (!unitLamports) return null
    try {
      const unit = BigInt(unitLamports)
      return lamportsToSolDisplay(unit * BigInt(qty))
    } catch {
      return null
    }
  }, [unitLamports, qty])

  const busy = phase !== 'idle' && phase !== 'signing'

  const adjustQty = useCallback(
    (delta: number) => {
      setQty((q) => {
        const next = Math.min(maxQty, Math.max(1, q + delta))
        return next
      })
    },
    [maxQty]
  )

  const buy = useCallback(async () => {
    setError(null)
    setPurchaseReceipt(null)
    if (!connected || !publicKey) {
      setError('Connect your wallet first.')
      return
    }
    if (maxQty < 1) {
      setError('Presale is sold out.')
      return
    }
    if (qty < 1 || qty > maxQty) {
      setError('Choose a valid quantity.')
      return
    }
    if (!presaleLive) {
      setError('Presale purchases are paused. Check back when we go live.')
      return
    }

    const buyerWallet = publicKey.toBase58()

    try {
      setPhase('building')
      const createRes = await fetch('/api/gen2-presale/create-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyerWallet, quantity: qty }),
      })
      const createJson = (await createRes.json().catch(() => ({}))) as {
        error?: string
        code?: string
        transaction?: string
        recentBlockhash?: string
        lastValidBlockHeight?: number
        remaining?: number
        expected?: { solUsdPriceUsed?: number }
      }
      if (!createRes.ok) {
        if (createRes.status === 403 && createJson.code === 'presale_not_live') {
          throw new Error(createJson.error || 'Presale is not live.')
        }
        if (createRes.status === 409) {
          throw new Error(createJson.error || 'Sold out or not enough spots left.')
        }
        throw new Error(createJson.error || 'Could not build transaction (check server env / RPC).')
      }
      const b64 = createJson.transaction
      const recentBlockhash = createJson.recentBlockhash
      const lastValidBlockHeight = createJson.lastValidBlockHeight
      if (!b64 || !recentBlockhash || lastValidBlockHeight == null) {
        throw new Error('Invalid response from server.')
      }

      const tx = Transaction.from(Buffer.from(b64, 'base64'))

      setPhase('signing')
      const signature = await sendTransaction(tx, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      })

      setPhase('confirming')
      await connection.confirmTransaction(
        {
          signature,
          blockhash: recentBlockhash,
          lastValidBlockHeight,
        },
        'confirmed'
      )

      const solUsdPriceUsed = createJson.expected?.solUsdPriceUsed
      const solUsdPayload =
        typeof solUsdPriceUsed === 'number' && Number.isFinite(solUsdPriceUsed) && solUsdPriceUsed > 0
          ? { solUsdPriceUsed }
          : {}

      setPhase('recording')
      setPurchaseReceipt({
        phase: 'recording',
        quantity: qty,
        lines: buildSpotLines(qty),
        txSignature: signature,
        explorerUrl: null,
      })

      const confirmRes = await fetch('/api/gen2-presale/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerWallet,
          quantity: qty,
          txSignature: signature,
          ...solUsdPayload,
        }),
      })
      const confirmJson = (await confirmRes.json().catch(() => ({}))) as {
        error?: string
        code?: string
        explorerUrl?: string
        txSignature?: string
      }
      if (!confirmRes.ok) {
        const failMsg =
          confirmRes.status === 409 && confirmJson.code === 'duplicate_tx'
            ? 'This purchase was already recorded. Refresh your balance.'
            : confirmJson.error ||
              'On-chain payment succeeded but confirmation failed. Contact support with your tx signature.'

        if (confirmRes.status === 409 && confirmJson.code === 'duplicate_tx') {
          const txSig = confirmJson.txSignature ?? signature
          const explorer = confirmJson.explorerUrl ?? gen2PresaleExplorerTxUrl(txSig)
          setPurchaseReceipt(prev =>
            prev
              ? {
                  ...prev,
                  phase: 'success',
                  duplicate: true,
                  txSignature: txSig,
                  explorerUrl: explorer,
                }
              : {
                  phase: 'success',
                  quantity: qty,
                  lines: buildSpotLines(qty),
                  duplicate: true,
                  txSignature: txSig,
                  explorerUrl: explorer,
                }
          )
          requestAnimationFrame(() => fireGreenConfetti())
          onPurchased()
          router.refresh()
          setPhase('idle')
          return
        }

        setPurchaseReceipt(prev =>
          prev
            ? { ...prev, phase: 'failed', errorMessage: failMsg }
            : {
                phase: 'failed',
                quantity: qty,
                lines: buildSpotLines(qty),
                txSignature: signature,
                errorMessage: failMsg,
              }
        )
        setError(failMsg)
        setPhase('idle')
        return
      }

      const txSig = confirmJson.txSignature ?? signature
      const explorer = confirmJson.explorerUrl ?? null
      setPurchaseReceipt(prev =>
        prev
          ? {
              ...prev,
              phase: 'success',
              duplicate: false,
              txSignature: txSig,
              explorerUrl: explorer,
            }
          : {
              phase: 'success',
              quantity: qty,
              lines: buildSpotLines(qty),
              txSignature: txSig,
              explorerUrl: explorer,
            }
      )
      requestAnimationFrame(() => fireGreenConfetti())
      onPurchased()
      router.refresh()
      setPhase('idle')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Purchase failed'
      setPurchaseReceipt(prev =>
        prev?.phase === 'recording' ? { ...prev, phase: 'failed', errorMessage: msg } : prev
      )
      const lower = msg.toLowerCase()
      if (lower.includes('user rejected') || lower.includes('cancelled')) {
        setError('Signature cancelled in wallet.')
      } else if (lower.includes('insufficient') || lower.includes('0x1')) {
        setError('Insufficient SOL for this purchase (and network fee).')
      } else if (lower.includes('blockhash') || lower.includes('expired')) {
        setError('Network busy: transaction expired. Please try again.')
      } else if (lower.includes('429') || msg.includes('Too many')) {
        setError('Too many attempts — wait a moment and retry.')
      } else {
        setError(msg)
      }
      setPhase('idle')
    }
  }, [connected, publicKey, maxQty, qty, presaleLive, sendTransaction, connection, onPurchased, router])

  return (
    <>
      <Gen2PresalePurchaseDialog
        open={purchaseReceipt !== null}
        receipt={purchaseReceipt}
        onOpenChange={(next) => {
          if (!next) setPurchaseReceipt(null)
        }}
      />
      <div
      id="gen2-purchase"
      className={cn(
        'scroll-mt-28 rounded-2xl border border-[#00E58B]/35 bg-[#151D24]/95 p-6 shadow-[0_0_48px_rgba(0,229,139,0.12)]',
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-[#EAFBF4]">Buy presale spots</h3>
          <p className="mt-1 text-sm text-[#A9CBB9]">
            <span className="font-semibold text-[#EAFBF4]">${unitPriceUsdc} USDC</span> per spot,{' '}
            <span className="text-[#00FF9C]">charged in SOL</span> using a live SOL/USD quote (refreshed about every
            minute). Split automatically between founder wallets in one transaction.
          </p>
        </div>
      </div>

      {!presaleLive && (
        <p
          className="mt-4 rounded-lg border border-[#FFD769]/40 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#EAFBF4]"
          role="status"
        >
          New purchases are paused. You can still view balances; turning presale on is done from Owl Vision → Gen2 Presale admin.
        </p>
      )}

      {!connected ? (
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
          <WalletConnectButton />
          <p className="text-sm text-[#A9CBB9]">Use Phantom, Solflare, or your preferred Solana wallet.</p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <span className="text-sm font-medium text-[#A9CBB9]">Quantity</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0 touch-manipulation border-[#1F6F54] bg-[#10161C] text-[#EAFBF4]"
                onClick={() => adjustQty(-1)}
                disabled={busy || !presaleLive || qty <= 1}
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="number"
                min={1}
                max={maxQty}
                value={qty}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  setQty(Math.min(maxQty, Math.max(1, Math.floor(n))))
                }}
                disabled={!presaleLive}
                className="h-11 w-20 border-[#1F6F54] bg-[#10161C] text-center font-bold text-[#EAFBF4]"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0 touch-manipulation border-[#1F6F54] bg-[#10161C] text-[#EAFBF4]"
                onClick={() => adjustQty(1)}
                disabled={busy || !presaleLive || qty >= maxQty}
                aria-label="Increase quantity"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <dl className="mt-6 grid gap-3 rounded-xl bg-[#10161C]/80 p-4 text-sm ring-1 ring-[#00E58B]/15">
            <div className="flex justify-between gap-4">
              <dt className="text-[#A9CBB9]">Unit price</dt>
              <dd className="text-right font-mono text-[#EAFBF4]">
                <span className="tabular-nums">${unitPriceUsdc}</span>
                <span className="font-sans text-sm font-normal text-[#A9CBB9]"> USDC → SOL</span>
                {unitLamports ? (
                  <span className="mt-1 block text-sm font-normal text-[#A9CBB9] sm:mt-0 sm:inline sm:ml-1">
                    ≈ {lamportsToSolDisplay(BigInt(unitLamports))} SOL / spot
                  </span>
                ) : (
                  <span className="mt-1 block max-w-[22rem] text-right font-sans text-xs font-normal leading-snug text-amber-300/90 sm:ml-auto">
                    SOL estimate unavailable right now. Refresh in a moment — checkout still loads a live quote when you
                    purchase.
                  </span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#A9CBB9]">Total (estimate)</dt>
              <dd className="font-mono font-bold text-[#00FF9C]">
                {statsLoading ? '…' : totalLamportsDisplay ? `${totalLamportsDisplay} SOL` : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#A9CBB9]">Spots left</dt>
              <dd className="font-bold tabular-nums text-[#FFD769]">{statsLoading ? '…' : remaining}</dd>
            </div>
          </dl>

          <Button
            type="button"
            disabled={busy || !presaleLive || maxQty < 1 || phase === 'signing'}
            onClick={() => void buy()}
            className={cn(
              'mt-6 h-12 min-h-[48px] w-full touch-manipulation border border-[#00FF9C]/45 text-base font-bold',
              'bg-[#00E58B]/25 text-[#EAFBF4] shadow-[0_0_32px_rgba(0,255,156,0.35)] hover:bg-[#00E58B]/40',
              'animate-button-glow-pulse disabled:animate-none'
            )}
          >
            {phase === 'idle' && (presaleLive ? 'Buy presale spots' : 'Presale paused')}
            {phase === 'building' && (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Building transaction…
              </>
            )}
            {phase === 'signing' && 'Sign in wallet…'}
            {phase === 'confirming' && (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Confirming on Solana…
              </>
            )}
            {phase === 'recording' && (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Recording your spots…
              </>
            )}
          </Button>

          {error && (
            <p className="mt-4 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200" role="alert">
              {error}
            </p>
          )}

        </>
      )}
      </div>
    </>
  )
}

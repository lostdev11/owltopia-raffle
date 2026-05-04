'use client'

import { useCallback, useState } from 'react'
import { Loader2, RefreshCw, ScanLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE } from '@/lib/gen2-presale/max-per-purchase'
import { cn } from '@/lib/utils'
import type { Gen2PresaleBalance, Gen2PresaleStats } from '@/lib/gen2-presale/types'

type Props = {
  balance: Gen2PresaleBalance | null
  loading?: boolean
  connected: boolean
  /** Refetch balance + stats from the server (e.g. after an on-chain purchase or returning to the tab). */
  onRefresh?: () => void
  /** Connected wallet address — used only for optional “record completed payment”. */
  walletAddress?: string | null
  /**
   * After a successful manual record (or duplicate tx), apply server balance/stats and refresh.
   * Same shape as `onPurchased` on the buy flow.
   */
  onRecorded?: (result?: {
    balance?: Gen2PresaleBalance
    stats?: Pick<Gen2PresaleStats, 'presale_supply' | 'sold' | 'remaining' | 'percent_sold'>
  }) => void
  className?: string
}

export function Gen2BalanceCard({
  balance,
  loading,
  connected,
  onRefresh,
  walletAddress,
  onRecorded,
  className,
}: Props) {
  const [recordSig, setRecordSig] = useState('')
  const [recordQty, setRecordQty] = useState(1)
  const [recordBusy, setRecordBusy] = useState(false)
  const [recordErr, setRecordErr] = useState<string | null>(null)
  const [recordOk, setRecordOk] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncErr, setSyncErr] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const syncFromChain = useCallback(async () => {
    const w = walletAddress?.trim()
    if (!w) return
    setSyncErr(null)
    setSyncMsg(null)
    setSyncBusy(true)
    try {
      const res = await fetch('/api/gen2-presale/reconcile-from-chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: w }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        inserted?: number
        scanned?: number
        balance?: Gen2PresaleBalance
        stats?: Pick<Gen2PresaleStats, 'presale_supply' | 'sold' | 'remaining' | 'percent_sold'>
      }
      if (!res.ok) {
        throw new Error(j.error || 'Could not sync from chain')
      }
      onRecorded?.({ balance: j.balance, stats: j.stats })
      const added = typeof j.inserted === 'number' ? j.inserted : 0
      const tried = typeof j.scanned === 'number' ? j.scanned : 0
      if (added > 0) {
        setSyncMsg(
          added === 1
            ? 'Found 1 presale payment on-chain and saved it to your balance.'
            : `Found ${added} presale payments on-chain and saved them to your balance.`
        )
      } else {
        setSyncMsg(
          tried > 0
            ? `Checked ${tried} recent transaction(s); none needed recording (already saved or not presale payments).`
            : 'No unrecorded transactions to check (recent activity may be older than the scan window — use Record payment with your tx signature).'
        )
      }
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncBusy(false)
    }
  }, [walletAddress, onRecorded])

  const recordCompletedPayment = useCallback(async () => {
    const w = walletAddress?.trim()
    if (!w) return
    setRecordErr(null)
    setRecordOk(null)
    const sig = recordSig.trim()
    if (!sig) {
      setRecordErr('Paste your Solana transaction signature.')
      return
    }
    const q = Math.floor(Number(recordQty))
    if (
      !Number.isFinite(q) ||
      q < 1 ||
      q > GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE
    ) {
      setRecordErr(`Quantity must be between 1 and ${GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE}.`)
      return
    }
    setRecordBusy(true)
    try {
      const res = await fetch('/api/gen2-presale/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyerWallet: w, quantity: q, txSignature: sig }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        error?: string
        code?: string
        balance?: Gen2PresaleBalance
        stats?: Pick<Gen2PresaleStats, 'presale_supply' | 'sold' | 'remaining' | 'percent_sold'>
      }
      if (!res.ok && res.status !== 409) {
        throw new Error(j.error || 'Could not record payment')
      }
      setRecordOk(
        res.status === 409
          ? 'That transaction was already on file — credits refreshed.'
          : 'Payment recorded — your credits should match this wallet.'
      )
      setRecordSig('')
      onRecorded?.({ balance: j.balance, stats: j.stats })
    } catch (e) {
      setRecordErr(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setRecordBusy(false)
    }
  }, [walletAddress, recordSig, recordQty, onRecorded])
  if (!connected) {
    return (
      <div
        className={cn(
          'rounded-2xl border border-[#1F6F54]/40 bg-[#1A232C]/90 p-6 text-[#A9CBB9]',
          className
        )}
      >
        <p className="text-sm">Connect your wallet to view your Gen2 mint credits.</p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-2xl border border-[#00E58B]/25 bg-[#151D24]/95 p-6 shadow-[0_0_32px_rgba(0,229,139,0.08)]',
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-[#EAFBF4]">My Gen2 mint credits</h3>
          <p className="mt-1 text-sm text-[#A9CBB9]">Presale spots and bonuses tracked for your wallet.</p>
        </div>
        {onRefresh && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] shrink-0 touch-manipulation border-[#1F6F54] bg-[#10161C] text-[#EAFBF4] hover:bg-[#151D24]"
              onClick={() => onRefresh()}
              disabled={loading || syncBusy}
              aria-label="Refresh balance from server"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden />
              )}
              <span className="ml-2">Refresh</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] shrink-0 touch-manipulation border-[#00E58B]/45 bg-[#10161C] text-[#EAFBF4] hover:bg-[#151D24]"
              onClick={() => void syncFromChain()}
              disabled={loading || syncBusy || recordBusy}
              aria-label="Scan blockchain for presale payments"
            >
              {syncBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ScanLine className="h-4 w-4" aria-hidden />
              )}
              <span className="ml-2">Sync from chain</span>
            </Button>
          </div>
        )}
      </div>
      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-[#A9CBB9]">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Loading balance…
        </div>
      ) : (
        <>
        {(syncErr || syncMsg) && (
          <div className="mt-4 space-y-2">
            {syncErr && (
              <p className="text-sm text-red-300" role="alert">
                {syncErr}
              </p>
            )}
            {syncMsg && (
              <p className="text-sm text-[#A9CBB9]" role="status">
                {syncMsg}
              </p>
            )}
          </div>
        )}
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-[#10161C]/80 p-4 ring-1 ring-[#00E58B]/15">
            <dt className="text-xs uppercase tracking-wider text-[#A9CBB9]">Purchased spots</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-[#EAFBF4]">{balance?.purchased_mints ?? 0}</dd>
          </div>
          <div className="rounded-xl bg-[#10161C]/80 p-4 ring-1 ring-[#00E58B]/15">
            <dt className="text-xs uppercase tracking-wider text-[#A9CBB9]">Gifted / bonus</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-[#EAFBF4]">{balance?.gifted_mints ?? 0}</dd>
          </div>
          <div className="rounded-xl bg-[#10161C]/80 p-4 ring-1 ring-[#FFD769]/20">
            <dt className="text-xs uppercase tracking-wider text-[#A9CBB9]">Used at mint</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-[#EAFBF4]">{balance?.used_mints ?? 0}</dd>
          </div>
          <div className="rounded-xl bg-[#10161C]/80 p-4 ring-1 ring-[#00FF9C]/35">
            <dt className="text-xs uppercase tracking-wider text-[#00FF9C]">Available now</dt>
            <dd className="mt-1 text-2xl font-black tabular-nums text-[#00FF9C]">{balance?.available_mints ?? 0}</dd>
          </div>
        </dl>
        </>
      )}

      {!loading && walletAddress && (
        <details className="mt-6 rounded-xl border border-[#1F6F54]/50 bg-[#10161C]/50 p-4 text-left">
          <summary className="cursor-pointer text-sm font-semibold text-[#A9CBB9] touch-manipulation">
            Paid on-chain but credits look wrong?
          </summary>
          <p className="mt-3 text-xs leading-relaxed text-[#A9CBB9]">
            If your wallet paid founder wallets but this page never updated, paste the transaction signature and the
            number of spots you bought. We will verify the payment and attach credits to this connected wallet.
          </p>
          <div className="mt-4 space-y-3">
            <label className="block text-xs font-medium text-[#A9CBB9]">
              Transaction signature
              <Input
                value={recordSig}
                onChange={(e) => setRecordSig(e.target.value)}
                placeholder="Base58 signature from Solscan or your wallet"
                className="mt-1 min-h-[44px] border-[#1F6F54] bg-[#10161C] font-mono text-sm text-[#EAFBF4]"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="block text-xs font-medium text-[#A9CBB9]">
              Spots in that transaction
              <Input
                type="number"
                min={1}
                max={GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE}
                value={recordQty}
                onChange={(e) => setRecordQty(Number(e.target.value))}
                className="mt-1 min-h-[44px] w-28 border-[#1F6F54] bg-[#10161C] text-center font-bold text-[#EAFBF4]"
              />
            </label>
            <Button
              type="button"
              disabled={recordBusy}
              onClick={() => void recordCompletedPayment()}
              className="min-h-[44px] w-full touch-manipulation bg-[#00E58B]/25 font-semibold text-[#EAFBF4] hover:bg-[#00E58B]/40"
            >
              {recordBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Verifying…
                </>
              ) : (
                'Record payment'
              )}
            </Button>
            {recordErr && (
              <p className="text-sm text-red-300" role="alert">
                {recordErr}
              </p>
            )}
            {recordOk && (
              <p className="text-sm text-[#00FF9C]" role="status">
                {recordOk}
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

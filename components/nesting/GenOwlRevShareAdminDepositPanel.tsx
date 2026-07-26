'use client'

import { useCallback, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  sendGenOwlRevShareSolDeposit,
  sendGenOwlRevShareUsdcDeposit,
} from '@/lib/nesting/client/gen-owl-rev-share-deposit-tx'

type ScheduleEdit = {
  gen1_next_date: string
  gen2_next_date: string
  gen1_total_sol: string
  gen1_total_usdc: string
  gen2_total_sol: string
  gen2_total_usdc: string
}

type Props = {
  edit: ScheduleEdit
  onScheduleUpdated: (schedule: unknown) => void
  /** Clear amount inputs after a successful new deposit so totals are not re-sent. */
  onDepositSucceeded?: () => void
  disabled?: boolean
}

function parseAmount(raw: string): number {
  const t = raw.trim()
  if (!t) return 0
  const n = Number.parseFloat(t)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function GenOwlRevShareAdminDepositPanel({
  edit,
  onScheduleUpdated,
  onDepositSucceeded,
  disabled,
}: Props) {
  const { connection } = useConnection()
  const { publicKey, connected, sendTransaction } = useWallet()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const deposit = useCallback(async () => {
    setMessage(null)
    setError(null)
    if (!publicKey || !connected || !sendTransaction) {
      setError('Connect the admin wallet that will fund the rev-share pool.')
      return
    }

    const gen1Sol = parseAmount(edit.gen1_total_sol)
    const gen2Sol = parseAmount(edit.gen2_total_sol)
    const gen1Usdc = parseAmount(edit.gen1_total_usdc)
    const gen2Usdc = parseAmount(edit.gen2_total_usdc)
    const totalSol = gen1Sol + gen2Sol
    const totalUsdc = gen1Usdc + gen2Usdc

    if (totalSol <= 0 && totalUsdc <= 0) {
      setError('Enter Gen 1 / Gen 2 SOL or USDC amounts above, then deposit.')
      return
    }

    setBusy(true)
    try {
      const poolRes = await fetch('/api/admin/gen-owl-rev-share/deposit', {
        credentials: 'include',
        cache: 'no-store',
      })
      const poolData = await poolRes.json().catch(() => ({}))
      if (!poolRes.ok || typeof poolData.address !== 'string') {
        setError(
          typeof poolData.error === 'string'
            ? poolData.error
            : 'Rev share pool is not configured on the server.'
        )
        return
      }
      const poolWallet = poolData.address as string

      let solSignature: string | null = null
      let usdcSignature: string | null = null

      if (totalSol > 0) {
        solSignature = await sendGenOwlRevShareSolDeposit({
          connection,
          sendTransaction,
          publicKey,
          poolWallet,
          amountSol: totalSol,
        })
      }
      if (totalUsdc > 0) {
        usdcSignature = await sendGenOwlRevShareUsdcDeposit({
          connection,
          sendTransaction,
          publicKey,
          poolWallet,
          amountUsdc: totalUsdc,
        })
      }

      const confirmRes = await fetch('/api/admin/gen-owl-rev-share/deposit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gen1_total_sol: gen1Sol || null,
          gen1_total_usdc: gen1Usdc || null,
          gen2_total_sol: gen2Sol || null,
          gen2_total_usdc: gen2Usdc || null,
          sol_signature: solSignature,
          usdc_signature: usdcSignature,
          gen1_next_date: edit.gen1_next_date.trim() || null,
          gen2_next_date: edit.gen2_next_date.trim() || null,
        }),
      })
      const confirmData = await confirmRes.json().catch(() => ({}))
      if (!confirmRes.ok) {
        setError(
          typeof confirmData.error === 'string'
            ? confirmData.error
            : 'Deposit sent on-chain but confirmation failed. Contact support with the tx signature.'
        )
        return
      }

      if (confirmData.schedule) {
        onScheduleUpdated(confirmData.schedule)
      }
      if (!confirmData.already_recorded) {
        onDepositSucceeded?.()
      }

      const parts: string[] = []
      if (totalSol > 0) parts.push(`${totalSol} SOL`)
      if (totalUsdc > 0) parts.push(`${totalUsdc} USDC`)
      setMessage(
        confirmData.already_recorded
          ? `Deposit already recorded (${parts.join(' + ')}). Period totals unchanged.`
          : `Deposited ${parts.join(' + ')} into the rev-share pool for ${confirmData.period_month ?? 'this month'}. Nested holders can see projected amounts.`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deposit failed.')
    } finally {
      setBusy(false)
    }
  }, [connected, connection, edit, onDepositSucceeded, onScheduleUpdated, publicKey, sendTransaction])

  return (
    <div className="mt-4 max-w-2xl space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.05] p-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Deposit from your <span className="font-medium text-foreground/90">connected wallet</span> into the
        dedicated rev-share pool. Funds escrow is not used. Only verified on-chain deposits credit claimable
        totals (homepage Save is display-only). Amounts above are added to this month&apos;s pool; nesters see
        projected per-nest shares on the Nesting dashboard.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void deposit()}
          disabled={disabled || busy || !connected}
          className="min-h-[44px] touch-manipulation"
        >
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Depositing…
            </>
          ) : (
            'Deposit to rev-share pool'
          )}
        </Button>
        {!connected ? (
          <span className="text-xs text-muted-foreground">Connect wallet to deposit.</span>
        ) : null}
      </div>
      {message ? <p className="text-xs text-emerald-400/95">{message}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

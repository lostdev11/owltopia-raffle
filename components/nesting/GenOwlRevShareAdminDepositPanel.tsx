'use client'

import { useCallback, useEffect, useState } from 'react'
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

type DepositTarget = 'gen1' | 'gen2'

type PeriodTotals = {
  gen1_total_sol: number | null
  gen1_total_usdc: number | null
  gen2_total_sol: number | null
  gen2_total_usdc: number | null
  finalized_at: string | null
}

type Props = {
  edit: ScheduleEdit
  onScheduleUpdated: (schedule: unknown) => void
  /**
   * Called after a successful new deposit with the updated schedule so the form can
   * sync to cumulative display totals (do not blank fields — that makes Save wipe the homepage).
   */
  onDepositSucceeded?: (schedule: unknown) => void
  disabled?: boolean
}

function parseAmount(raw: string): number {
  const t = raw.trim()
  if (!t) return 0
  const n = Number.parseFloat(t)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function formatPoolAmount(n: number | null | undefined, unit: string): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return `— ${unit}`
  return `${n} ${unit}`
}

export function GenOwlRevShareAdminDepositPanel({
  edit,
  onScheduleUpdated,
  onDepositSucceeded,
  disabled,
}: Props) {
  const { connection } = useConnection()
  const { publicKey, connected, sendTransaction } = useWallet()
  const [busyTarget, setBusyTarget] = useState<DepositTarget | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [periodMonth, setPeriodMonth] = useState<string | null>(null)
  const [claimsOpen, setClaimsOpen] = useState(false)
  const [period, setPeriod] = useState<PeriodTotals | null>(null)

  const refreshPeriod = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/gen-owl-rev-share/deposit', {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return
      setPeriodMonth(typeof data.period_month === 'string' ? data.period_month : null)
      setClaimsOpen(Boolean(data.claims_open))
      setPeriod(data.period ?? null)
    } catch {
      // Non-blocking status
    }
  }, [])

  useEffect(() => {
    void refreshPeriod()
  }, [refreshPeriod])

  const deposit = useCallback(
    async (target: DepositTarget) => {
      setMessage(null)
      setError(null)
      if (!publicKey || !connected || !sendTransaction) {
        setError('Connect the admin wallet that will fund the rev-share pool.')
        return
      }

      const gen1Sol = target === 'gen1' ? parseAmount(edit.gen1_total_sol) : 0
      const gen2Sol = target === 'gen2' ? parseAmount(edit.gen2_total_sol) : 0
      const gen1Usdc = target === 'gen1' ? parseAmount(edit.gen1_total_usdc) : 0
      const gen2Usdc = target === 'gen2' ? parseAmount(edit.gen2_total_usdc) : 0
      const totalSol = gen1Sol + gen2Sol
      const totalUsdc = gen1Usdc + gen2Usdc
      const label = target === 'gen1' ? 'Gen 1' : 'Gen 2'

      if (totalSol <= 0 && totalUsdc <= 0) {
        setError(`Enter ${label} SOL or USDC above, then deposit that pool only.`)
        return
      }

      setBusyTarget(target)
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
        setPeriodMonth(typeof poolData.period_month === 'string' ? poolData.period_month : null)
        setClaimsOpen(Boolean(poolData.claims_open))
        setPeriod(poolData.period ?? null)

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
          onDepositSucceeded?.(confirmData.schedule ?? null)
        }

        const parts: string[] = []
        if (totalSol > 0) parts.push(`${totalSol} SOL`)
        if (totalUsdc > 0) parts.push(`${totalUsdc} USDC`)
        setMessage(
          confirmData.already_recorded
            ? `${label} deposit already recorded (${parts.join(' + ')}). Period totals unchanged.`
            : `Deposited ${parts.join(' + ')} into the ${label} rev-share pool for ${confirmData.period_month ?? 'this month'}. Nested holders can see projected amounts.`
        )
        await refreshPeriod()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Deposit failed.')
      } finally {
        setBusyTarget(null)
      }
    },
    [
      connected,
      connection,
      edit,
      onDepositSucceeded,
      onScheduleUpdated,
      publicKey,
      refreshPeriod,
      sendTransaction,
    ]
  )

  const busy = busyTarget != null

  return (
    <div className="mt-4 max-w-2xl space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.05] p-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Deposit from your <span className="font-medium text-foreground/90">connected wallet</span> into the
        dedicated rev-share pool. Funds escrow is not used. Only verified on-chain deposits credit claimable
        totals (homepage Save is display-only). Use the Gen 1 or Gen 2 button to fund that pool alone —
        amounts in the fields above are <span className="font-medium text-foreground/90">added</span> to this
        month&apos;s claimable totals.
      </p>
      {periodMonth ? (
        <p className="text-xs text-foreground/90 tabular-nums">
          Claimable {periodMonth}
          {claimsOpen ? (
            <span className="ml-1 font-medium text-emerald-400">· claims open</span>
          ) : (
            <span className="ml-1 text-muted-foreground">· claims open on last day of month (UTC)</span>
          )}
          : Gen 1 {formatPoolAmount(period?.gen1_total_sol, 'SOL')}
          {period?.gen1_total_usdc != null && period.gen1_total_usdc > 0
            ? ` / ${formatPoolAmount(period.gen1_total_usdc, 'USDC')}`
            : ''}
          {' · '}
          Gen 2 {formatPoolAmount(period?.gen2_total_sol, 'SOL')}
          {period?.gen2_total_usdc != null && period.gen2_total_usdc > 0
            ? ` / ${formatPoolAmount(period.gen2_total_usdc, 'USDC')}`
            : ''}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void deposit('gen1')}
          disabled={disabled || busy || !connected}
          className="min-h-[44px] touch-manipulation"
        >
          {busyTarget === 'gen1' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Depositing Gen 1…
            </>
          ) : (
            'Deposit Gen 1 pool'
          )}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void deposit('gen2')}
          disabled={disabled || busy || !connected}
          className="min-h-[44px] touch-manipulation"
        >
          {busyTarget === 'gen2' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Depositing Gen 2…
            </>
          ) : (
            'Deposit Gen 2 pool'
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

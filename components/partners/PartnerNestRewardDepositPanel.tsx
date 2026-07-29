'use client'

import { useCallback, useEffect, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Coins, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { sendPartnerNestRewardDeposit } from '@/lib/nesting/client/partner-nest-reward-deposit-tx'

type Props = {
  poolId: string
  rewardToken: string
  rewardMint: string
}

export function PartnerNestRewardDepositPanel({ poolId, rewardToken, rewardMint }: Props) {
  const { connection } = useConnection()
  const { publicKey, connected, sendTransaction } = useWallet()
  const [amount, setAmount] = useState('')
  const [available, setAvailable] = useState<number | null>(null)
  const [funded, setFunded] = useState<number | null>(null)
  const [paid, setPaid] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/partners/nest-rewards?pool_id=${encodeURIComponent(poolId)}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json?.error === 'string' ? json.error : 'Could not load reward vault')
        return
      }
      setAvailable(typeof json.available === 'number' ? json.available : 0)
      setFunded(typeof json.funded === 'number' ? json.funded : 0)
      setPaid(typeof json.paid === 'number' ? json.paid : 0)
    } catch {
      setError('Could not load reward vault')
    } finally {
      setLoading(false)
    }
  }, [poolId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const deposit = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      if (!publicKey || !connected || !sendTransaction) {
        setError('Connect the partner wallet that holds the reward tokens.')
        return
      }
      const amountUi = Number(amount)
      if (!Number.isFinite(amountUi) || amountUi <= 0) {
        setError('Enter a positive deposit amount.')
        return
      }

      const prep = await fetch(
        `/api/partners/nest-rewards/deposit?pool_id=${encodeURIComponent(poolId)}`,
        { credentials: 'include', cache: 'no-store' }
      )
      const prepJson = await prep.json().catch(() => ({}))
      if (!prep.ok || typeof prepJson.vault_wallet !== 'string') {
        setError(typeof prepJson?.error === 'string' ? prepJson.error : 'Vault not ready')
        return
      }

      const { signature, decimals } = await sendPartnerNestRewardDeposit({
        connection,
        sendTransaction,
        publicKey,
        vaultWallet: prepJson.vault_wallet,
        rewardMint,
        amountUi,
        decimals:
          typeof prepJson.reward_decimals === 'number' ? prepJson.reward_decimals : undefined,
      })

      const confirm = await fetch('/api/partners/nest-rewards/deposit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pool_id: poolId,
          amount: amountUi,
          transaction_signature: signature,
          decimals,
        }),
      })
      const confirmJson = await confirm.json().catch(() => ({}))
      if (!confirm.ok) {
        setError(
          typeof confirmJson?.error === 'string'
            ? confirmJson.error
            : 'Deposit sent on-chain but confirmation failed. Contact support with the tx signature.'
        )
        return
      }

      setMessage(
        confirmJson.already_recorded
          ? `Deposit already recorded. Available for claims: ${confirmJson.available ?? '—'} ${rewardToken}.`
          : `Deposited ${amountUi} ${rewardToken}. Nested holders can claim from Nesting.`
      )
      setAmount('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deposit failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
      <div className="flex gap-2">
        <Coins className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">Fund reward pool</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Deposit <span className="font-medium text-foreground/90">{rewardToken}</span> from your connected
            wallet. Nested holders claim from Nesting — payouts stop when this pool runs dry.
          </p>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading vault…</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Available {available ?? 0} · funded {funded ?? 0} · paid {paid ?? 0} {rewardToken}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`dep-${poolId}`}>Amount ({rewardToken})</Label>
        <Input
          id={`dep-${poolId}`}
          className="min-h-[44px]"
          inputMode="decimal"
          placeholder="e.g. 1000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}

      <Button
        type="button"
        className="min-h-[44px] touch-manipulation bg-emerald-600 hover:bg-emerald-700"
        disabled={busy || !connected || loading}
        onClick={() => void deposit()}
      >
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
        Deposit {rewardToken}
      </Button>
      <p className="break-all font-mono text-[10px] text-muted-foreground">Mint {rewardMint}</p>
    </div>
  )
}

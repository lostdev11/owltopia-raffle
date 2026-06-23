'use client'

import { useCallback, useEffect, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Loader2 } from 'lucide-react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import { sendMilestoneDepositTransaction } from '@/lib/client/create-raffle-milestone-deposit'
import type { ManageGen2Milestone } from '@/lib/owl-center/gen2-milestones/serialize'

type ManagePayload = {
  minted_count: number
  total_supply: number
  escrow_wallet: string | null
  milestones: ManageGen2Milestone[]
}

const shortWallet = (w: string) => (w.length > 8 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w)

function statusBadge(m: ManageGen2Milestone): { label: string; cls: string } {
  if (m.status === 'claimed') return { label: 'CLAIMED', cls: 'text-[#00FF9C] border-[#00FF9C]/40' }
  if (m.status === 'awarded') return { label: 'WON — UNCLAIMED', cls: 'text-[#FFD769] border-[#FFD769]/40' }
  if (m.status === 'unlocked') return { label: 'UNLOCKED', cls: 'text-[#FFD769] border-[#FFD769]/40' }
  if (m.status === 'void') return { label: 'VOID', cls: 'text-[#FF9C9C] border-[#FF9C9C]/40' }
  if (m.status === 'returned') return { label: 'RETURNED', cls: 'text-[#9BA8B4] border-[#1A222B]' }
  if (m.funded) return { label: 'ARMED', cls: 'text-[#00C97A] border-[#00C97A]/40' }
  return { label: 'NEEDS FUNDING', cls: 'text-[#FF9C9C] border-[#FF9C9C]/40' }
}

export function AdminGen2MintMilestones() {
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()

  const [payload, setPayload] = useState<ManagePayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [triggerType, setTriggerType] = useState<'absolute_mints' | 'percent_supply'>('absolute_mints')
  const [triggerValue, setTriggerValue] = useState('')
  const [prizeAmount, setPrizeAmount] = useState('')
  const [prizeCurrency, setPrizeCurrency] = useState<'SOL' | 'USDC'>('SOL')
  const [winnerMode, setWinnerMode] = useState<'random' | 'top_buyer'>('random')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/owl-center/gen2/milestones?scope=manage', {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = (await res.json()) as ManagePayload & { error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setPayload(j)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function addMilestone() {
    setMsg(null)
    setAdding(true)
    try {
      const res = await fetch('/api/owl-center/gen2/milestones', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger_type: triggerType,
          trigger_value: Number(triggerValue),
          prize_amount: Number(prizeAmount),
          prize_currency: prizeCurrency,
          winner_mode: winnerMode,
        }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'add_failed')
      setMsg('Milestone added — fund the escrow to arm it.')
      setTriggerValue('')
      setPrizeAmount('')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'add_failed')
    } finally {
      setAdding(false)
    }
  }

  async function fundMilestone(m: ManageGen2Milestone) {
    if (!publicKey) {
      setMsg('Connect your wallet to fund the escrow.')
      return
    }
    if (!payload?.escrow_wallet) {
      setMsg('Funds escrow is not configured.')
      return
    }
    if (!m.prize_amount || !m.prize_currency) return
    setMsg(null)
    setBusyId(m.id)
    try {
      const sig = await sendMilestoneDepositTransaction({
        connection,
        sendTransaction,
        publicKey,
        currency: m.prize_currency,
        amount: m.prize_amount,
        fundsEscrowAddress: payload.escrow_wallet,
      })
      const res = await fetch(`/api/owl-center/gen2/milestones/${m.id}/verify-deposit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deposit_tx: sig }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'verify_failed')
      setMsg('Escrow funded — milestone armed.')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'fund_failed')
    } finally {
      setBusyId(null)
    }
  }

  async function removeMilestone(m: ManageGen2Milestone) {
    setMsg(null)
    setBusyId(m.id)
    try {
      const res = await fetch(`/api/owl-center/gen2/milestones/${m.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'delete_failed')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'delete_failed')
    } finally {
      setBusyId(null)
    }
  }

  async function returnDeposit(m: ManageGen2Milestone) {
    setMsg(null)
    setBusyId(m.id)
    try {
      const res = await fetch(`/api/owl-center/gen2/milestones/${m.id}/return-deposit`, {
        method: 'POST',
        credentials: 'include',
      })
      const j = (await res.json()) as { error?: string; transactionSignature?: string }
      if (!res.ok) throw new Error(j.error || 'return_failed')
      setMsg('Deposit returned to funder.')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'return_failed')
    } finally {
      setBusyId(null)
    }
  }

  const milestones = payload?.milestones ?? []

  return (
    <div className="space-y-5">
      <p className="text-sm text-[#9BA8B4]">
        Surprise prizes that fire as the mint hits a count. When a milestone&apos;s mint target is crossed, a random
        minter (weighted by how many they minted) is auto-selected and can claim the escrowed SOL/USDC. Add milestones
        any time during the mint — fund the escrow before the count reaches the target, or the milestone voids.
      </p>

      <div className="border border-[#1A222B] bg-[#0B0F14] p-4">
        <h3 className="mb-3 font-mono text-xs uppercase tracking-widest text-[#00C97A]">Add milestone</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-[#9BA8B4]">
            Trigger type
            <select
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as 'absolute_mints' | 'percent_supply')}
              className="min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 text-sm text-[#E8EEF2]"
            >
              <option value="absolute_mints">At mint count</option>
              <option value="percent_supply">At % of supply</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#9BA8B4]">
            {triggerType === 'absolute_mints' ? 'Mint count (e.g. 500)' : 'Percent of supply (1–100)'}
            <input
              inputMode="numeric"
              value={triggerValue}
              onChange={(e) => setTriggerValue(e.target.value)}
              placeholder={triggerType === 'absolute_mints' ? '500' : '50'}
              className="min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 text-sm text-[#E8EEF2]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#9BA8B4]">
            Prize amount
            <input
              inputMode="decimal"
              value={prizeAmount}
              onChange={(e) => setPrizeAmount(e.target.value)}
              placeholder="1"
              className="min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 text-sm text-[#E8EEF2]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#9BA8B4]">
            Currency
            <select
              value={prizeCurrency}
              onChange={(e) => setPrizeCurrency(e.target.value as 'SOL' | 'USDC')}
              className="min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 text-sm text-[#E8EEF2]"
            >
              <option value="SOL">SOL</option>
              <option value="USDC">USDC</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#9BA8B4] sm:col-span-2">
            Winner
            <select
              value={winnerMode}
              onChange={(e) => setWinnerMode(e.target.value as 'random' | 'top_buyer')}
              className="min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 text-sm text-[#E8EEF2]"
            >
              <option value="random">Random minter (weighted by mints)</option>
              <option value="top_buyer">Top minter</option>
            </select>
          </label>
        </div>
        <div className="mt-3">
          <DeployButton type="button" onClick={() => void addMilestone()} disabled={adding}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Add milestone
          </DeployButton>
        </div>
      </div>

      {msg ? <p className="text-sm text-[#FFD769]">{msg}</p> : null}

      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-[#5C6773]">
          {payload ? `minted=${payload.minted_count} / ${payload.total_supply}` : '—'}
        </p>
        <DeployButton type="button" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Reload
        </DeployButton>
      </div>

      {milestones.length === 0 ? (
        <p className="text-sm text-[#5C6773]">No mint milestones yet.</p>
      ) : (
        <ul className="space-y-3">
          {milestones.map((m) => {
            const badge = statusBadge(m)
            const isBusy = busyId === m.id
            const canFund = !m.funded && m.status === 'pending'
            const canRemove = !m.funded && (m.status === 'pending' || m.status === 'void')
            const canReturn = m.funded && (m.status === 'void' || m.status === 'unlocked') && !m.returned_at
            return (
              <li key={m.id} className="border border-[#1A222B] bg-[#0B0F14] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-sm text-[#E8EEF2]">
                    @ {m.target_mints} mints → {m.prize_amount} {m.prize_currency}
                    <span className="ml-2 text-xs text-[#5C6773]">
                      ({m.winner_mode === 'top_buyer' ? 'top minter' : 'random'})
                    </span>
                  </div>
                  <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                {m.winner_wallet ? (
                  <p className="mt-2 font-mono text-xs text-[#00C97A]">winner={shortWallet(m.winner_wallet)}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {canFund ? (
                    <DeployButton type="button" onClick={() => void fundMilestone(m)} disabled={isBusy}>
                      {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Fund escrow ({m.prize_amount} {m.prize_currency})
                    </DeployButton>
                  ) : null}
                  {canReturn ? (
                    <button
                      type="button"
                      onClick={() => void returnDeposit(m)}
                      disabled={isBusy}
                      className="inline-flex min-h-[44px] items-center gap-2 border border-[#FFD769]/40 px-4 text-sm text-[#FFD769] hover:bg-[#FFD769]/10 disabled:opacity-50"
                    >
                      {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Return deposit
                    </button>
                  ) : null}
                  {canRemove ? (
                    <button
                      type="button"
                      onClick={() => void removeMilestone(m)}
                      disabled={isBusy}
                      className="inline-flex min-h-[44px] items-center gap-2 border border-[#FF9C9C]/40 px-4 text-sm text-[#FF9C9C] hover:bg-[#FF9C9C]/10 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

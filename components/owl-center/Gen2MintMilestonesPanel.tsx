'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Gift, Loader2, Trophy } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'
import type { PublicGen2Milestone } from '@/lib/owl-center/gen2-milestones/serialize'

type Payload = {
  minted_count: number
  total_supply: number
  milestones: PublicGen2Milestone[]
}

const shortWallet = (w: string) => (w.length > 8 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w)

export function Gen2MintMilestonesPanel({ mintedCount }: { mintedCount?: number }) {
  const { publicKey } = useWallet()
  const wallet = publicKey?.toBase58() ?? null

  const [payload, setPayload] = useState<Payload | null>(null)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/owl-center/gen2/milestones', { cache: 'no-store' })
      const j = (await res.json()) as Payload & { error?: string }
      if (!res.ok) return
      setPayload(j)
    } catch {
      /* non-critical */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, mintedCount])

  async function claim(id: string) {
    setMsg(null)
    setClaimingId(id)
    try {
      const res = await fetch(`/api/owl-center/gen2/milestones/${id}/claim`, {
        method: 'POST',
        credentials: 'include',
      })
      const j = (await res.json()) as { error?: string; transactionSignature?: string }
      if (!res.ok) throw new Error(j.error || 'claim_failed')
      setMsg('Prize sent to your wallet!')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'claim_failed')
    } finally {
      setClaimingId(null)
    }
  }

  const milestones = payload?.milestones ?? []
  if (milestones.length === 0) return null

  const minted = mintedCount ?? payload?.minted_count ?? 0

  return (
    <CommandCard label="Mint milestones">
      <p className="mb-4 flex items-center gap-2 text-sm text-[#9BA8B4]">
        <Gift className="h-4 w-4 text-[#00FF9C]" />
        Hit a milestone and a random minter wins a bonus prize — the more you mint, the better your odds.
      </p>
      <ul className="space-y-3">
        {milestones.map((m) => {
          const reached = minted >= m.target_mints
          const pct = m.target_mints > 0 ? Math.min(100, (minted / m.target_mints) * 100) : 0
          const isWinner =
            m.winner_wallet && wallet && walletsEqualSolana(m.winner_wallet, wallet)
          const claimable = m.status === 'awarded' && isWinner
          return (
            <li key={m.id} className="border border-[#1A222B] bg-[#0B0F14] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm text-[#E8EEF2]">
                  {m.target_mints} mints → {m.prize_amount} {m.prize_currency}
                </span>
                {m.status === 'claimed' ? (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-[#00FF9C]">
                    <Trophy className="h-3.5 w-3.5" /> Awarded
                  </span>
                ) : reached ? (
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[#FFD769]">Reached</span>
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                    {minted}/{m.target_mints}
                  </span>
                )}
              </div>

              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#1A222B]">
                <div
                  className="h-full rounded-full bg-[#00FF9C] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>

              {m.winner_wallet ? (
                <p className="mt-3 font-mono text-xs text-[#00C97A]">
                  Winner: {isWinner ? 'You!' : shortWallet(m.winner_wallet)}
                </p>
              ) : null}

              {claimable ? (
                <button
                  type="button"
                  onClick={() => void claim(m.id)}
                  disabled={claimingId === m.id}
                  className="mt-3 inline-flex min-h-[44px] touch-manipulation items-center gap-2 border border-[#00FF9C]/50 bg-[#00FF9C]/10 px-5 text-sm font-bold text-[#00FF9C] hover:bg-[#00FF9C]/15 disabled:opacity-50"
                >
                  {claimingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Claim {m.prize_amount} {m.prize_currency}
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
      {msg ? <p className="mt-3 text-sm text-[#FFD769]">{msg}</p> : null}
    </CommandCard>
  )
}

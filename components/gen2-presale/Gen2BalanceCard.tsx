'use client'

import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { Gen2PresaleBalance } from '@/lib/gen2-presale/types'

type Props = {
  balance: Gen2PresaleBalance | null
  loading?: boolean
  connected: boolean
  className?: string
}

export function Gen2BalanceCard({ balance, loading, connected, className }: Props) {
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
      <h3 className="text-lg font-bold text-[#EAFBF4]">My Gen2 mint credits</h3>
      <p className="mt-1 text-sm text-[#A9CBB9]">Presale spots and bonuses tracked for your wallet.</p>
      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-[#A9CBB9]">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Loading balance…
        </div>
      ) : (
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
      )}
    </div>
  )
}

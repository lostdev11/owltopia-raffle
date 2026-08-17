'use client'

import { useEffect, useMemo, useState } from 'react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { formatPhasePriceSolOrFree } from '@/lib/owl-center/format-phase-price-sol'
import {
  buildPartnerMintPhaseSchedule,
  formatPartnerPhasePriceUsdc,
  type PartnerMintPhaseScheduleRow,
} from '@/lib/owl-center/partner-mint-phase-schedule'
import { formatMintDate, formatPhaseStartShort } from '@/lib/owl-center/phase-schedule'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { cn } from '@/lib/utils'

function statusLabel(row: PartnerMintPhaseScheduleRow): string | null {
  if (row.is_active) return 'LIVE'
  if (row.status === 'upcoming') return 'UPCOMING'
  if (row.status === 'ended') return 'ENDED'
  return null
}

function priceLine(row: PartnerMintPhaseScheduleRow, liveSolLamports: string | null | undefined): string {
  const usdc = formatPartnerPhasePriceUsdc(row.price_usdc)
  if (row.is_active && row.price_usdc != null && row.price_usdc > 0) {
    const sol = formatPhasePriceSolOrFree(liveSolLamports, { paid: true })
    return `${usdc} · ${sol} · pay in SOL`
  }
  if (row.price_usdc != null && row.price_usdc > 0) {
    return `${usdc} · pay in SOL`
  }
  return usdc
}

function windowLine(row: PartnerMintPhaseScheduleRow): string {
  const start = formatMintDate(row.starts_at)
  if (row.ends_at) {
    return `${start} → ${formatMintDate(row.ends_at)}`
  }
  if (row.starts_at) {
    const short = formatPhaseStartShort(row.starts_at)
    return short ? `Opens ${short}` : `Opens ${start}`
  }
  return 'Start TBA'
}

export function PartnerMintPhaseSchedule({
  launch,
  liveUnitLamports,
}: {
  launch: OwlCenterLaunchPublic
  /** Lamports quote for the currently active phase (from eligibility). */
  liveUnitLamports?: string | null
}) {
  const [nowMs, setNowMs] = useState<number | null>(null)
  useEffect(() => {
    setNowMs(Date.now())
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const rows = useMemo(
    () => buildPartnerMintPhaseSchedule(launch, nowMs ?? Date.now()),
    [launch, nowMs]
  )

  if (rows.length === 0) return null

  return (
    <CommandCard label="MINT // phases">
      <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.25em] text-[#5C6773]">
        Phase schedule · prices in USDC, paid in SOL
      </p>
      <ul className="space-y-3">
        {rows.map((row) => {
          const tag = statusLabel(row)
          return (
            <li
              key={row.key}
              className={cn(
                'border px-3 py-3 font-mono text-xs',
                row.is_active && 'border-[#00FF9C] bg-[#00FF9C]/12 ring-1 ring-[#00FF9C]/45',
                !row.is_active && row.status === 'upcoming' && 'border-[#1A222B] bg-[#0B0F14]',
                !row.is_active && row.status === 'ended' && 'border-[#1A222B]/80 bg-[#0B0F14] opacity-70'
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold uppercase tracking-widest text-[#C5D0D8]">
                  {row.label}
                  {tag ? (
                    <span className={cn('ml-2', row.is_active ? 'text-[#00FF9C]' : 'text-[#5C6773]')}>
                      · {tag}
                    </span>
                  ) : null}
                </span>
                {row.wallet_mint_limit != null ? (
                  <span className="text-[#9BA8B4]">{row.wallet_mint_limit}/wallet</span>
                ) : row.kind === 'presale' ? (
                  <span className="text-[#5C6773]">prepaid</span>
                ) : (
                  <span className="text-[#5C6773]">—</span>
                )}
              </div>
              <p className="mt-1 text-[#5C6773]">{priceLine(row, liveUnitLamports)}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-[#5C6773]">
                {windowLine(row)}
                {row.supply > 0 ? ` · cap ${row.supply.toLocaleString()}` : null}
              </p>
            </li>
          )
        })}
      </ul>
    </CommandCard>
  )
}

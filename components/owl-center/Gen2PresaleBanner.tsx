'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { GEN2_OWL_CENTER_PATH } from '@/lib/gen2-presale/purchase-availability'
import { cn } from '@/lib/utils'

import {
  owlCenterBtnDisabled,
  owlCenterBtnGhost,
  owlCenterBtnPrimary,
} from '@/components/owl-center/owl-center-cta-styles'

type PresaleBannerStats = {
  presale_live?: boolean
  presale_sold_out?: boolean
}

export function Gen2PresaleBanner() {
  const [stats, setStats] = useState<PresaleBannerStats | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/gen2-presale/stats', { cache: 'no-store' })
        if (!res.ok) throw new Error('stats')
        const j = (await res.json()) as PresaleBannerStats
        if (!cancelled) setStats(j)
      } catch {
        if (!cancelled) setStats({ presale_live: false })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const presaleLive = stats?.presale_live === true
  const presaleSoldOut = stats?.presale_sold_out === true

  if (!presaleLive) return null

  return (
    <div
      className={cn(
        'sticky top-0 z-[70] w-full border-b bg-[#0B1014]/95 backdrop-blur-md',
        presaleSoldOut ? 'border-[#1A222B] shadow-none' : 'border-[#00FF9C]/35 shadow-[0_0_32px_rgba(0,255,156,0.12)]'
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-3 px-4 py-2.5 sm:justify-between">
        <p className="text-center text-sm font-semibold text-[#E8FDF4] sm:text-left">
          <span className="mr-1" aria-hidden>
            {presaleSoldOut ? '✓' : '🔥'}
          </span>
          {presaleSoldOut
            ? 'Owltopia Gen2 Presale sold out — redeem credits on Owl Center when your phase is live'
            : 'Owltopia Gen2 Presale Live — Powered by Owl Center'}
        </p>
        <div className="flex items-center gap-3">
          {presaleSoldOut ? (
            <span className="inline-flex items-center gap-1.5 rounded-none border border-[#1A222B] bg-[#0F1419]/90 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[#5C6773]">
              SOLD OUT
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-none border border-[#00FF9C]/45 bg-[#00FF9C]/10 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[#00FF9C] animate-pulse motion-reduce:animate-none">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00FF9C] shadow-[0_0_8px_#00FF9C]" />
              LIVE
            </span>
          )}
          {presaleSoldOut ? (
            <span
              className={`${owlCenterBtnDisabled} min-w-[120px] text-sm`}
              aria-disabled="true"
              title="All presale spots have been claimed"
            >
              Presale sold out
            </span>
          ) : (
            <Link href="/gen2-presale" className={`${owlCenterBtnPrimary} min-w-[120px] text-sm`}>
              Enter Presale
            </Link>
          )}
          {presaleSoldOut ? (
            <Link href={GEN2_OWL_CENTER_PATH} className={`${owlCenterBtnGhost} min-w-[120px] text-sm`}>
              Owl Center
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  )
}

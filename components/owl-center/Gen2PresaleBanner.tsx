'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'

export function Gen2PresaleBanner() {
  const [live, setLive] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/gen2-presale/stats', { cache: 'no-store' })
        if (!res.ok) throw new Error('stats')
        const j = (await res.json()) as { presale_live?: boolean }
        if (!cancelled) setLive(j.presale_live === true)
      } catch {
        if (!cancelled) setLive(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (live !== true) return null

  return (
    <div
      className={cn(
        'sticky top-0 z-[70] w-full border-b border-[#00FF9C]/35 bg-[#0B1014]/95 backdrop-blur-md',
        'shadow-[0_0_32px_rgba(0,255,156,0.12)]'
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-3 px-4 py-2.5 sm:justify-between">
        <p className="text-center text-sm font-semibold text-[#E8FDF4] sm:text-left">
          <span className="mr-1" aria-hidden>
            🔥
          </span>
          Owltopia Gen2 Presale Live — Powered by Owl Center
        </p>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-none border border-[#00FF9C]/45 bg-[#00FF9C]/10 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[#00FF9C] animate-pulse motion-reduce:animate-none">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00FF9C] shadow-[0_0_8px_#00FF9C]" />
            LIVE
          </span>
          <Link
            href="/gen2-presale"
            className="inline-flex min-h-[40px] min-w-[120px] touch-manipulation items-center justify-center border border-[#00FF9C]/40 bg-[#00FF9C]/15 px-4 text-sm font-bold text-[#F4FBF8] hover:bg-[#00FF9C]/25"
          >
            Enter Presale
          </Link>
        </div>
      </div>
    </div>
  )
}

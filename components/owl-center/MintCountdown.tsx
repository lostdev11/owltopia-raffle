'use client'

import { useEffect, useMemo, useState } from 'react'

import type { MintCountdownInfo } from '@/lib/owl-center/phase-schedule'
import { getMintCountdownInfo } from '@/lib/owl-center/phase-schedule'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Live'
  const s = Math.floor(ms / 1000) % 60
  const m = Math.floor(ms / 60000) % 60
  const h = Math.floor(ms / 3600000) % 24
  const d = Math.floor(ms / 86400000)
  return `${d}d ${h}h ${m}m ${s}s`
}

type Props = {
  launch: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule' | 'active_phase'>
  /** Precomputed server-side (optional — avoids hydration flicker). */
  initial?: MintCountdownInfo | null
  compact?: boolean
}

export function MintCountdown({ launch, initial, compact = false }: Props) {
  const targetMs = useMemo(() => {
    const info = initial ?? getMintCountdownInfo(launch)
    if (!info) return null
    const ms = new Date(info.target_at).getTime()
    return Number.isFinite(ms) ? { ms, label: info.label } : null
  }, [launch, initial])

  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!targetMs) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [targetMs])

  if (!targetMs) return null

  const remaining = Math.max(0, targetMs.ms - now)
  const live = remaining <= 0

  if (compact) {
    return (
      <p className="font-mono text-xs text-[#9BA8B4]">
        <span className="text-[#5C6773]">{targetMs.label}</span>{' '}
        <span className={live ? 'text-[#00FF9C]' : 'tabular-nums text-[#00FF9C]'}>
          {live ? 'Live' : formatRemaining(remaining)}
        </span>
      </p>
    )
  }

  return (
    <div className="rounded border border-[#00FF9C]/35 bg-[#00FF9C]/8 px-4 py-3 text-center touch-manipulation">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">{targetMs.label}</p>
      <p className={`mt-1 font-mono text-xl font-bold tabular-nums md:text-2xl ${live ? 'text-[#00FF9C]' : 'text-[#F4FBF8]'}`}>
        {live ? 'Live' : formatRemaining(remaining)}
      </p>
    </div>
  )
}

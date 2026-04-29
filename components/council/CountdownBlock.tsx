'use client'

import { useEffect, useState } from 'react'
import { Timer } from 'lucide-react'

type CountdownBlockProps = {
  endTimeIso: string
  label?: string
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00:00'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function CountdownBlock({
  endTimeIso,
  label = 'Voting closes in',
}: CountdownBlockProps) {
  const endMs = new Date(endTimeIso).getTime()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!Number.isFinite(endMs)) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [endMs])

  const remaining = Number.isFinite(endMs) ? Math.max(0, endMs - now) : 0

  return (
    <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/[0.07] px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="flex items-center gap-2 text-sm font-medium text-emerald-100/95">
        <Timer className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
        {label}
      </div>
      <p className="font-mono text-lg sm:text-xl tabular-nums text-theme-prime drop-shadow-[0_0_8px_rgba(0,255,136,0.35)]">
        {formatRemaining(remaining)}
      </p>
    </div>
  )
}

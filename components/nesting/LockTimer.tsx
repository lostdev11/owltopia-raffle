'use client'

import { useEffect, useState } from 'react'
import { Hourglass } from 'lucide-react'

/** Countdown until unlockMs; switches to elapsed when unlocked. No RPC — local clock only. */
export function LockTimer({
  unlockAtIso,
}: {
  unlockAtIso: string | null
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  if (!unlockAtIso) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Hourglass className="h-3 w-3" aria-hidden />
        No lock
      </span>
    )
  }

  const unlockMs = new Date(unlockAtIso).getTime()
  if (Number.isNaN(unlockMs)) return <span className="text-xs text-muted-foreground">—</span>

  const delta = unlockMs - now
  if (delta <= 0) {
    return <span className="text-xs font-medium text-emerald-400">Unlocked</span>
  }

  const s = Math.floor(delta / 1000)
  const days = Math.floor(s / 86400)
  const hrs = Math.floor((s % 86400) / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const secs = s % 60

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hrs > 0 || days > 0) parts.push(`${hrs}h`)
  parts.push(`${mins}m`)
  parts.push(`${secs}s`)

  return (
    <span className="inline-flex items-center gap-1 tabular-nums text-xs text-theme-prime">
      <Hourglass className="h-3 w-3 shrink-0" aria-hidden />
      {parts.join(' ')}
    </span>
  )
}

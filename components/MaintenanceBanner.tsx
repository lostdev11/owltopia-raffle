'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

const BASE_TICKER =
  'Maintenance mode — things may not work as expected. Thanks for your patience.'

export function MaintenanceBanner() {
  const [active, setActive] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [endsAt, setEndsAt] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const pull = async () => {
      try {
        const res = await fetch('/api/maintenance-status', { cache: 'no-store' })
        const data = (await res.json().catch(() => ({}))) as {
          active?: boolean
          message?: string | null
          endsAt?: string | null
        }
        if (cancelled) return
        setActive(data.active === true)
        setMessage(typeof data.message === 'string' ? data.message : null)
        setEndsAt(typeof data.endsAt === 'string' ? data.endsAt : null)
      } catch {
        if (!cancelled) setActive(false)
      }
    }
    void pull()
    const id = setInterval(pull, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const line = useMemo(() => {
    const parts: string[] = [BASE_TICKER]
    const custom = message?.trim()
    if (custom) parts.push(custom)
    if (endsAt) {
      try {
        const label = new Date(endsAt).toLocaleString(undefined, {
          dateStyle: 'short',
          timeStyle: 'short',
        })
        parts.push(`Estimated clear: ${label}`)
      } catch {
        /* ignore */
      }
    }
    return parts.join('   •   ')
  }, [message, endsAt])

  if (!active) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'sticky top-0 z-[100] w-full border-b border-amber-500/45',
        'bg-gradient-to-r from-amber-950 via-amber-900 to-amber-950 text-amber-50',
        'shadow-md touch-manipulation',
        'pt-[max(0.375rem,env(safe-area-inset-top,0px))]'
      )}
    >
      {/* Reduced motion: static centered copy */}
      <div className="hidden motion-reduce:flex w-full items-center justify-center px-4 py-3 text-center text-sm font-medium leading-snug">
        {line}
      </div>
      {/* Scrolling ticker */}
      <div className="overflow-hidden py-3 min-h-11 flex items-center motion-reduce:hidden">
        <div className="flex w-max shrink-0 animate-maintenance-marquee whitespace-nowrap text-sm sm:text-base font-medium">
          <span className="inline-block pl-6 pr-20 sm:pr-32">{line}</span>
          <span className="inline-block pr-20 sm:pr-32" aria-hidden>
            {line}
          </span>
        </div>
      </div>
    </div>
  )
}

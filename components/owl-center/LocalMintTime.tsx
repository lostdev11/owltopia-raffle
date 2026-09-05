'use client'

import { useEffect, useState } from 'react'

import { formatMintDate, formatPhaseStartShort } from '@/lib/owl-center/phase-schedule'

type LocalMintTimeProps = {
  iso: string | null | undefined
  /** `full` → "Sep 5, 2026, 7:30 AM"; `short` → "Sep 5, 7:30 AM" */
  variant?: 'full' | 'short'
  /** Shown before the browser timezone is applied (avoids UTC SSR flash). */
  placeholder?: string
  className?: string
}

/**
 * Format mint timestamps in the viewer's local timezone.
 * Server Components calling `formatMintDate` / `formatPhaseStartShort` use the
 * deploy host TZ (UTC on Vercel), which shifts times vs the mint console.
 */
export function LocalMintTime({
  iso,
  variant = 'full',
  placeholder = '…',
  className,
}: LocalMintTimeProps) {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    if (variant === 'short') {
      setLabel(formatPhaseStartShort(iso))
    } else {
      setLabel(formatMintDate(iso))
    }
  }, [iso, variant])

  const text = label ?? (iso ? placeholder : variant === 'short' ? null : 'TBA')
  if (text == null) return null
  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  )
}

'use client'

import { useEffect, useState } from 'react'

import { formatMintDate, formatPhaseStartShort } from '@/lib/owl-center/phase-schedule'
import {
  MINT_TIME_ZONE_CHANGE_EVENT,
  readMintTimeZoneMode,
  type MintTimeZoneMode,
} from '@/lib/owl-center/mint-time-preference'

type LocalMintTimeProps = {
  iso: string | null | undefined
  /** `full` → "Sep 5, 2026, 7:30 AM"; `short` → "Sep 5, 7:30 AM" */
  variant?: 'full' | 'short'
  /** Shown before preference is applied (avoids hydration mismatch). */
  placeholder?: string
  className?: string
}

/**
 * Format mint timestamps using the shared UTC/local preference (default UTC).
 * Prefer this over calling formatMintDate in Server Components so hub cards
 * match the mint console after hydration.
 */
export function LocalMintTime({
  iso,
  variant = 'full',
  placeholder = '…',
  className,
}: LocalMintTimeProps) {
  const [mode, setMode] = useState<MintTimeZoneMode>('utc')
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    const apply = () => setMode(readMintTimeZoneMode())
    apply()
    window.addEventListener(MINT_TIME_ZONE_CHANGE_EVENT, apply)
    window.addEventListener('storage', apply)
    return () => {
      window.removeEventListener(MINT_TIME_ZONE_CHANGE_EVENT, apply)
      window.removeEventListener('storage', apply)
    }
  }, [])

  useEffect(() => {
    if (variant === 'short') {
      setLabel(formatPhaseStartShort(iso, mode))
    } else {
      setLabel(formatMintDate(iso, mode))
    }
  }, [iso, variant, mode])

  const text = label ?? (iso ? placeholder : variant === 'short' ? null : 'TBA')
  if (text == null) return null
  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  )
}

'use client'

import { useEffect, useState } from 'react'

import {
  MINT_TIME_ZONE_CHANGE_EVENT,
  readMintTimeZoneMode,
  type MintTimeZoneMode,
} from '@/lib/owl-center/mint-time-preference'

/** Subscribe to UTC/local mint time preference (default UTC). */
export function useMintTimeZoneMode(): MintTimeZoneMode {
  const [mode, setMode] = useState<MintTimeZoneMode>('utc')

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

  return mode
}

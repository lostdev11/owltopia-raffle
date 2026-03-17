'use client'

import { useEffect, useState, useRef } from 'react'

/** Short delay after tab becomes visible so wallet adapter can update connection state first. */
const VISIBLE_DELAY_MS = 150

/**
 * Returns a tick that increments each time the document becomes visible (after a short delay).
 * Use as a dependency in effects that load dashboard/admin data so they re-run when the user
 * returns to the tab (e.g. after wallet redirect on mobile), ensuring connection-dependent
 * data loads right away.
 */
export function useVisibilityTick(): number {
  const [tick, setTick] = useState(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null
        setTick((t) => t + 1)
      }, VISIBLE_DELAY_MS)
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  return tick
}

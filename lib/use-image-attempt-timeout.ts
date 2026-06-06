'use client'

import { useEffect } from 'react'

const DEFAULT_IMAGE_ATTEMPT_TIMEOUT_MS = 8000

/**
 * Advance the raffle image fallback chain when an `<img>` hangs without firing error
 * (common on flaky NFT gateways over mobile data).
 */
export function useImageAttemptTimeout(
  active: boolean,
  attemptKey: string,
  onTimeout: () => void,
  ms = DEFAULT_IMAGE_ATTEMPT_TIMEOUT_MS
) {
  useEffect(() => {
    if (!active || !attemptKey) return
    const id = window.setTimeout(onTimeout, ms)
    return () => window.clearTimeout(id)
  }, [active, attemptKey, onTimeout, ms])
}

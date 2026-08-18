'use client'

import { useEffect } from 'react'
import { preloadPackAnimationVideos } from '@/lib/packs/animations'

/**
 * Warms the opening clip once checkout starts so OPEN PACK is not a cold buffer.
 * Hover is already on-screen — do not decode extra hover copies in the background.
 */
export function PackAnimationPreload({ opening = false }: { opening?: boolean }) {
  useEffect(() => {
    preloadPackAnimationVideos({ opening })
  }, [opening])

  return null
}

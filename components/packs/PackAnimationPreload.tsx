'use client'

import { useEffect } from 'react'
import { PACK_ANIMATIONS, preloadPackAnimationVideos } from '@/lib/packs/animations'

/**
 * Keeps both pack clips in the document so OPEN PACK does not wait on a cold buffer.
 */
export function PackAnimationPreload() {
  useEffect(() => {
    preloadPackAnimationVideos()
  }, [])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed h-px w-px overflow-hidden opacity-0"
    >
      <video preload="auto" muted playsInline tabIndex={-1}>
        <source src={PACK_ANIMATIONS.hovering} type="video/webm" />
      </video>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={PACK_ANIMATIONS.hoveringAlpha} alt="" />
      <video preload="auto" muted playsInline tabIndex={-1}>
        <source src={PACK_ANIMATIONS.opening} type="video/mp4" />
      </video>
    </div>
  )
}

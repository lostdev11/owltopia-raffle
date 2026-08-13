'use client'

import { useEffect, useRef, useState } from 'react'
import {
  PACK_ANIMATION_POSTER,
  PACK_ANIMATIONS,
} from '@/lib/packs/animations'
import { PackVisual } from '@/components/packs/PackVisual'
import { cn } from '@/lib/utils'

type Props = {
  /** idle = loop hover; paying = keep hover with subtle urgency */
  phase?: 'idle' | 'paying'
  className?: string
}

/**
 * On-page looping sealed-pack clip (pre-purchase). Falls back to PackVisual
 * if the video cannot play (e.g. unsupported codec).
 */
export function PackHoverVideo({ phase = 'idle', className }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (failed) return
    const el = videoRef.current
    if (!el) return
    const play = el.play()
    if (play && typeof play.then === 'function') {
      play.catch(() => {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[packs] hover video autoplay failed — using PackVisual fallback')
        }
        setFailed(true)
      })
    }
  }, [failed])

  if (failed) {
    return <PackVisual phase={phase} className={className} />
  }

  return (
    <div
      className={cn(
        'relative mx-auto flex w-full max-w-[min(90vw,520px)] flex-col items-center select-none',
        className
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute left-1/2 top-[20%] h-[65%] w-[85%] -translate-x-1/2 rounded-full',
          'bg-[radial-gradient(circle,rgba(0,255,156,0.22),transparent_68%)] blur-3xl transition-opacity duration-700',
          phase === 'paying' ? 'opacity-100' : 'opacity-70'
        )}
        aria-hidden
      />
      <video
        ref={videoRef}
        className={cn(
          'relative z-[1] mx-auto w-full max-h-[min(78dvh,520px)] object-contain',
          phase === 'paying' ? 'animate-pack-pay-pulse' : ''
        )}
        poster={PACK_ANIMATION_POSTER}
        autoPlay
        loop
        muted
        playsInline
        controls={false}
        preload="auto"
        onError={() => {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[packs] hover video error — using PackVisual fallback')
          }
          setFailed(true)
        }}
      >
        <source src={PACK_ANIMATIONS.hovering} type="video/mp4" />
        <source src={PACK_ANIMATIONS.hoveringFallback} type="video/quicktime" />
      </video>
      {phase === 'paying' ? (
        <p className="mt-3 text-center text-xs uppercase tracking-[0.28em] text-[#00FF9C]/85">
          Confirm payment…
        </p>
      ) : (
        <p className="mt-3 text-center text-xs uppercase tracking-[0.28em] text-white/35">
          Your pack is ready
        </p>
      )}
    </div>
  )
}

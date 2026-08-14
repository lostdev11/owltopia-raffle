'use client'

import { useEffect, useRef, useState } from 'react'
import {
  PACK_ANIMATION_POSTER,
  PACK_ANIMATIONS,
} from '@/lib/packs/animations'
import { usePackHoverPlayback } from '@/lib/packs/hover-alpha'
import { PackVisual } from '@/components/packs/PackVisual'
import { cn } from '@/lib/utils'

type Props = {
  /** idle = loop hover; paying = keep hover with subtle urgency */
  phase?: 'idle' | 'paying'
  className?: string
}

type ClipProps = {
  className?: string
  onHoverFailed?: () => void
}

const CLIP_CLASS =
  'bg-transparent object-contain [backface-visibility:hidden] [transform:translateZ(0)]'

/**
 * Transparent looping pack. WebM+alpha on Chromium/Firefox; animated WebP on
 * iOS/WebKit (MP4 cannot store transparency).
 */
export function PackHoverClip({ className, onHoverFailed }: ClipProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const { format, mobile } = usePackHoverPlayback()
  const [webpOnly, setWebpOnly] = useState(false)

  const showWebm = format === 'webm' && !webpOnly
  const webmSrc = mobile ? PACK_ANIMATIONS.hoveringMobile : PACK_ANIMATIONS.hovering

  useEffect(() => {
    if (!showWebm) return
    const el = videoRef.current
    if (!el) return
    const play = el.play()
    if (play && typeof play.then === 'function') {
      play.catch(() => setWebpOnly(true))
    }
  }, [showWebm, webmSrc])

  if (format === 'pending') {
    return <div className={cn('aspect-[180/305] w-full bg-transparent', className)} aria-hidden />
  }

  if (showWebm) {
    return (
      <video
        ref={videoRef}
        className={cn(CLIP_CLASS, className)}
        poster={PACK_ANIMATION_POSTER}
        autoPlay
        loop
        muted
        playsInline
        controls={false}
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        onError={() => setWebpOnly(true)}
      >
        <source src={webmSrc} type="video/webm" />
      </video>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- animated WebP with alpha; next/image does not loop it
    <img
      src={PACK_ANIMATIONS.hoveringAlpha}
      alt=""
      draggable={false}
      decoding="async"
      className={cn(CLIP_CLASS, className)}
      onError={() => onHoverFailed?.()}
    />
  )
}

/**
 * On-page looping sealed-pack clip (pre-purchase).
 */
export function PackHoverVideo({ phase = 'idle', className }: Props) {
  const [failed, setFailed] = useState(false)

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
          'bg-[radial-gradient(circle,rgba(0,255,156,0.26),transparent_70%)] md:blur-3xl',
          'transition-opacity duration-700',
          phase === 'paying' ? 'opacity-100' : 'opacity-70'
        )}
        aria-hidden
      />
      <div className="relative z-[1] w-full [contain:layout_paint] [transform:translateZ(0)]">
        <PackHoverClip
          className={cn(
            'relative mx-auto w-full max-h-[min(52dvh,400px)] sm:max-h-[min(78dvh,520px)]',
            phase === 'paying' ? 'animate-pack-pay-pulse' : ''
          )}
          onHoverFailed={() => setFailed(true)}
        />
      </div>
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

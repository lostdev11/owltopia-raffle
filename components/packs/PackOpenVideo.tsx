'use client'

import { useEffect, useRef, useState } from 'react'
import { PACK_OPEN_VIDEO_POSTER, PACK_OPEN_VIDEO_SRC } from '@/lib/packs/media'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  /** When true, mount and autoplay the opening clip. */
  active: boolean
  /** Called once the clip finishes, errors, or the user skips. */
  onFinished: () => void
}

/**
 * Full-bleed pack-rip clip. Plays after payment confirms; parent reveals prize when
 * this finishes (and the open API result is ready).
 */
export function PackOpenVideo({ active, onFinished }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const finishedRef = useRef(false)
  const [showSkip, setShowSkip] = useState(false)
  const [failed, setFailed] = useState(false)
  const [entered, setEntered] = useState(false)

  const finish = () => {
    if (finishedRef.current) return
    finishedRef.current = true
    onFinished()
  }

  useEffect(() => {
    if (!active) {
      finishedRef.current = false
      setShowSkip(false)
      setFailed(false)
      setEntered(false)
      return
    }

    finishedRef.current = false
    setFailed(false)
    setShowSkip(false)
    // Fade the overlay in on the next frame for a cleaner enter
    const enterRaf = window.requestAnimationFrame(() => setEntered(true))

    const skipTimer = window.setTimeout(() => setShowSkip(true), 1200)
    const failSafe = window.setTimeout(() => {
      // If autoplay/load hangs, never trap the user
      finish()
    }, 45_000)

    const el = videoRef.current
    if (el) {
      el.currentTime = 0
      const playPromise = el.play()
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.catch(() => {
          // Autoplay blocked or missing file — proceed without trapping UX
          setFailed(true)
          window.setTimeout(() => finish(), 400)
        })
      }
    }

    return () => {
      window.cancelAnimationFrame(enterRaf)
      window.clearTimeout(skipTimer)
      window.clearTimeout(failSafe)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish closes over onFinished; active is the gate
  }, [active])

  if (!active) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black transition-opacity duration-500',
        entered ? 'opacity-100' : 'opacity-0'
      )}
      role="dialog"
      aria-label="Pack opening"
      aria-modal="true"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,255,156,0.12),transparent_60%)]" />
      <div className="relative w-full max-w-4xl px-3 sm:px-6">
        <video
          ref={videoRef}
          className="mx-auto max-h-[78vh] w-full object-contain shadow-[0_0_120px_-24px_rgba(0,255,156,0.55)]"
          poster={PACK_OPEN_VIDEO_POSTER}
          playsInline
          // Muted required for reliable autoplay on mobile wallets after async payment confirm
          muted
          controls={false}
          preload="auto"
          onEnded={finish}
          onError={() => {
            setFailed(true)
            finish()
          }}
        >
          <source src={PACK_OPEN_VIDEO_SRC} type="video/quicktime" />
          <source src={PACK_OPEN_VIDEO_SRC} type="video/mp4" />
        </video>
        <div className="mt-5 flex flex-col items-center gap-2">
          {failed ? (
            <p className="flex items-center gap-2 text-sm text-emerald-100/70">
              <Loader2 className="h-4 w-4 animate-spin" />
              Opening your pack…
            </p>
          ) : (
            <p className="font-display text-2xl tracking-[0.18em] text-[#EAFBF4]/90">
              Ripping…
            </p>
          )}
          {showSkip && (
            <button
              type="button"
              onClick={finish}
              className="min-h-[44px] px-4 text-xs uppercase tracking-[0.2em] text-[#00FF9C]/85 underline-offset-4 hover:underline"
            >
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

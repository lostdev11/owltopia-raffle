'use client'

import { useEffect, useRef, useState } from 'react'
import { PACK_OPEN_VIDEO_POSTER, PACK_OPEN_VIDEO_SRC } from '@/lib/packs/media'
import { Loader2 } from 'lucide-react'

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
      return
    }

    finishedRef.current = false
    setFailed(false)
    setShowSkip(false)

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
      window.clearTimeout(skipTimer)
      window.clearTimeout(failSafe)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish closes over onFinished; active is the gate
  }, [active])

  if (!active) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
      role="dialog"
      aria-label="Pack opening"
      aria-modal="true"
    >
      <div className="relative w-full max-w-3xl px-3 sm:px-6">
        <video
          ref={videoRef}
          className="mx-auto max-h-[80vh] w-full rounded-lg object-contain shadow-[0_0_80px_-20px_rgba(16,185,129,0.5)]"
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
        <div className="mt-4 flex flex-col items-center gap-2">
          {failed ? (
            <p className="flex items-center gap-2 text-sm text-emerald-100/70">
              <Loader2 className="h-4 w-4 animate-spin" />
              Opening your pack…
            </p>
          ) : (
            <p className="text-sm text-emerald-100/70">Ripping pack…</p>
          )}
          {showSkip && (
            <button
              type="button"
              onClick={finish}
              className="text-xs text-emerald-400/80 underline-offset-2 hover:underline"
            >
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

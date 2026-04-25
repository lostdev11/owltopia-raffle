'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import {
  RAFFLE_AMBIENT_AUDIO_PATH,
  RAFFLE_AMBIENT_TRACK_TITLE,
} from '@/lib/raffle-ambient-audio'

const USER_PAUSED_KEY = 'owl-platform-music-user-paused'
const DEFAULT_VOLUME = 0.32

type PlatformMusicContextValue = {
  audioRef: React.RefObject<HTMLAudioElement | null>
  isPlaying: boolean
  loadError: boolean
  toggle: () => void
  play: () => Promise<void>
  pause: () => void
}

const PlatformMusicContext = createContext<PlatformMusicContextValue | null>(null)

export function usePlatformMusic(): PlatformMusicContextValue {
  const ctx = useContext(PlatformMusicContext)
  if (!ctx) {
    throw new Error('usePlatformMusic must be used within PlatformMusicProvider')
  }
  return ctx
}

/**
 * Site-wide ambient music: one `<audio>` element, survives route changes.
 * Playback stops only when the user pauses (preference stored in localStorage).
 */
export function PlatformMusicProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [audioMounted, setAudioMounted] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const gestureCleanupRef = useRef<(() => void) | null>(null)

  /** RaffleOwlPlayer hides this via `body[data-owl-raffle-list-owl="1"]` in globals.css — not React state, so we don't re-render the app (Radix/Dialog ref issues). */
  const showFloatingControl = !loadError

  const syncPlaying = useCallback(() => {
    const a = audioRef.current
    setIsPlaying(!!a && !a.paused && !a.ended)
  }, [])

  const pause = useCallback(() => {
    const a = audioRef.current
    if (!a || loadError) return
    try {
      localStorage.setItem(USER_PAUSED_KEY, 'true')
    } catch {
      /* ignore */
    }
    a.pause()
    syncPlaying()
  }, [loadError, syncPlaying])

  const play = useCallback(async () => {
    const a = audioRef.current
    if (!a || loadError) return
    try {
      localStorage.setItem(USER_PAUSED_KEY, 'false')
    } catch {
      /* ignore */
    }
    a.loop = true
    a.volume = DEFAULT_VOLUME
    try {
      await a.play()
    } catch {
      /* blocked until gesture */
    }
    syncPlaying()
  }, [loadError, syncPlaying])

  const toggle = useCallback(() => {
    const a = audioRef.current
    if (!a || loadError) return
    if (a.paused) void play()
    else pause()
  }, [loadError, pause, play])

  useEffect(() => {
    if (!audioMounted || loadError) return
    const a = audioRef.current
    if (!a) return
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    syncPlaying()
    return () => {
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
    }
  }, [audioMounted, loadError, syncPlaying])

  useEffect(() => {
    if (!audioMounted || loadError) return
    const a = audioRef.current
    if (!a) return

    let cancelled = false
    a.loop = true
    a.volume = DEFAULT_VOLUME

    const detachGesture = () => {
      gestureCleanupRef.current?.()
      gestureCleanupRef.current = null
    }

    const tryStart = async () => {
      let userPaused = false
      try {
        userPaused = localStorage.getItem(USER_PAUSED_KEY) === 'true'
      } catch {
        /* ignore */
      }
      if (cancelled || userPaused) {
        syncPlaying()
        return
      }

      try {
        await a.play()
        detachGesture()
      } catch {
        const onGesture = () => {
          if (cancelled) return
          let paused = false
          try {
            paused = localStorage.getItem(USER_PAUSED_KEY) === 'true'
          } catch {
            /* ignore */
          }
          if (paused) return
          void a
            .play()
            .then(() => {
              detachGesture()
              syncPlaying()
            })
            .catch(() => {})
        }
        detachGesture()
        window.addEventListener('pointerdown', onGesture, { passive: true })
        window.addEventListener('keydown', onGesture)
        gestureCleanupRef.current = () => {
          window.removeEventListener('pointerdown', onGesture)
          window.removeEventListener('keydown', onGesture)
        }
      }
      if (!cancelled) syncPlaying()
    }

    void tryStart()
    return () => {
      cancelled = true
      detachGesture()
    }
  }, [audioMounted, loadError, syncPlaying])

  // Never call setState from a ref callback — it can re-enter commit and, with Radix ref composition
  // down the tree, trigger "Maximum update depth exceeded" in dev.
  useLayoutEffect(() => {
    if (audioRef.current) {
      setAudioMounted(true)
    }
  }, [])

  const value = useMemo<PlatformMusicContextValue>(
    () => ({
      audioRef,
      isPlaying,
      loadError,
      toggle,
      play,
      pause,
    }),
    [isPlaying, loadError, toggle, play, pause]
  )

  return (
    <PlatformMusicContext.Provider value={value}>
      <audio
        ref={audioRef}
        src={RAFFLE_AMBIENT_AUDIO_PATH}
        preload="auto"
        playsInline
        className="hidden"
        aria-hidden
        onError={() => {
          if (process.env.NODE_ENV === 'development') {
            console.warn(
              '[PlatformMusic] Failed to load track. Expected file at public/audio/owltopia-move-in-silence.wav'
            )
          }
          setLoadError(true)
        }}
      />
      {showFloatingControl && (
        <button
          type="button"
          onClick={toggle}
          className="platform-music-floating-ctl fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-[150] flex h-11 w-11 touch-manipulation items-center justify-center rounded-full border border-emerald-400/35 bg-black/55 text-emerald-100 shadow-lg backdrop-blur-md transition-[transform,background-color] hover:bg-black/70 active:scale-[0.96] motion-reduce:transition-none md:h-12 md:w-12"
          style={{ touchAction: 'manipulation' }}
          aria-label={
            isPlaying
              ? `Pause ${RAFFLE_AMBIENT_TRACK_TITLE}`
              : `Play ${RAFFLE_AMBIENT_TRACK_TITLE}`
          }
          aria-pressed={isPlaying}
          title={`${RAFFLE_AMBIENT_TRACK_TITLE} — tap to play or pause`}
        >
          {isPlaying ? (
            <Pause className="h-5 w-5 md:h-6 md:w-6" aria-hidden strokeWidth={2.25} />
          ) : (
            <Play className="ml-0.5 h-5 w-5 md:h-6 md:w-6" aria-hidden fill="currentColor" strokeWidth={2.25} />
          )}
        </button>
      )}
      {children}
    </PlatformMusicContext.Provider>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Button } from '@/components/ui/button'
import { Loader2, Music2, Pause } from 'lucide-react'
import { RAFFLE_AMBIENT_AUDIO_PATH } from '@/lib/raffle-ambient-audio'

const DEFAULT_VOLUME = 0.32

type RaffleOwlPlayerProps = {
  /** When false, audio is paused and the control is hidden (e.g. raffle not in its live window). */
  enabled: boolean
}

/**
 * Ambient loop for the raffle detail page. Pauses when the wallet disconnects, the tab/screen is hidden,
 * or the user navigates away (unmount). Respects mobile autoplay: may require a tap to start.
 */
export function RaffleOwlPlayer({ enabled }: RaffleOwlPlayerProps) {
  const { connected } = useWallet()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [tabVisible, setTabVisible] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'visible'
  )
  /** User opted out via Pause; stays off until they tap Play again. */
  const [userSoundOn, setUserSoundOn] = useState(true)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVis = () => setTabVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const shouldPlay =
    enabled && connected && tabVisible && userSoundOn && !loadError

  const syncPlayingState = useCallback(() => {
    const a = audioRef.current
    setIsPlaying(!!a && !a.paused && !a.ended)
  }, [])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return

    if (!enabled || !connected) {
      a.pause()
      setAutoplayBlocked(false)
      syncPlayingState()
      return
    }

    a.loop = true
    a.volume = DEFAULT_VOLUME

    if (!shouldPlay) {
      a.pause()
      syncPlayingState()
      return
    }

    const run = a.play()
    if (run !== undefined) {
      run
        .then(() => {
          setAutoplayBlocked(false)
          syncPlayingState()
        })
        .catch(() => {
          setAutoplayBlocked(true)
          syncPlayingState()
        })
    }
  }, [connected, enabled, shouldPlay, syncPlayingState])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    return () => {
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
    }
  }, [])

  useEffect(() => {
    if (!connected) {
      setUserSoundOn(true)
      setAutoplayBlocked(false)
    }
  }, [connected])

  const showPause = isPlaying
  const showStartOrResume =
    connected && !isPlaying && (!userSoundOn || autoplayBlocked)
  const showLoadingSound =
    connected &&
    tabVisible &&
    enabled &&
    userSoundOn &&
    !autoplayBlocked &&
    !isPlaying &&
    !loadError

  const handleTapPlay = useCallback(() => {
    const a = audioRef.current
    if (!a || loadError) return
    setUserSoundOn(true)
    setAutoplayBlocked(false)
    a.loop = true
    a.volume = DEFAULT_VOLUME
    void a.play().catch(() => setAutoplayBlocked(true))
  }, [loadError])

  const handlePause = useCallback(() => {
    setUserSoundOn(false)
    audioRef.current?.pause()
    setAutoplayBlocked(false)
  }, [])

  if (!enabled || loadError) {
    return null
  }

  return (
    <>
      <audio
        ref={audioRef}
        src={RAFFLE_AMBIENT_AUDIO_PATH}
        preload="metadata"
        playsInline
        className="hidden"
        onError={() => {
          if (process.env.NODE_ENV === 'development') {
            console.warn(
              '[RaffleOwlPlayer] Failed to load ambient track. Add your file at public/audio/owl-raffle-ambient.mp3 (or update lib/raffle-ambient-audio.ts).'
            )
          }
          setLoadError(true)
        }}
      />
      {!connected ? (
        <span className="inline-flex min-h-[44px] items-center rounded-md border border-dashed border-muted-foreground/40 px-3 text-xs text-muted-foreground sm:text-sm">
          Owl player — connect wallet for sound
        </span>
      ) : showPause ? (
        <Button
          type="button"
          variant="outline"
          size="default"
          onClick={handlePause}
          className="touch-manipulation min-h-[44px] text-sm sm:text-base"
          title="Pause background music for this raffle."
        >
          <Pause className="mr-2 h-4 w-4" aria-hidden />
          Pause music
        </Button>
      ) : showStartOrResume ? (
        <Button
          type="button"
          variant="outline"
          size="default"
          onClick={handleTapPlay}
          className="touch-manipulation min-h-[44px] text-sm sm:text-base border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
          title={
            !userSoundOn
              ? 'Resume the Owl soundtrack.'
              : 'Browsers require a tap to start audio, especially on mobile.'
          }
        >
          <Music2 className="mr-2 h-4 w-4" aria-hidden />
          {!userSoundOn ? 'Resume music' : 'Play Owl soundtrack'}
        </Button>
      ) : showLoadingSound ? (
        <span
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border/80 bg-muted/20 px-3 text-xs text-muted-foreground sm:text-sm"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          Loading sound…
        </span>
      ) : null}
    </>
  )
}

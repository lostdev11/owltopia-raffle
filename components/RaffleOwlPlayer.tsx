'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Loader2, Pause, Play } from 'lucide-react'
import {
  RAFFLE_AMBIENT_AUDIO_PATH,
  RAFFLE_AMBIENT_TRACK_TITLE,
} from '@/lib/raffle-ambient-audio'

const DEFAULT_VOLUME = 0.32
/** Fixed size for clamping and default placement (icon-only glass button). */
const PLAYER_W = 56
const PLAYER_H = 56
/** Analyser: lower bins ≈ bass / kick energy for glow pulse. */
const GLOW_BASS_BIN_MAX = 18
const GLOW_SMOOTH = 0.78
const GLOW_ATTACK = 0.35
const DRAG_THRESHOLD_PX = 8
const POS_STORAGE_KEY = 'owl-raffle-player-pos'
const EDGE = 12

type Pos = { x: number; y: number }

type SafeInsets = { bottom: number; right: number; left: number; top: number }

/** Only the listings page `/raffles` (ignores trailing slash; query strings are not in pathname). */
function isRafflesListPathname(pathname: string | null): boolean {
  if (pathname == null) return false
  const normalized = pathname.replace(/\/+$/, '') || '/'
  return normalized === '/raffles'
}

function measureSafeInsets(): SafeInsets {
  if (typeof document === 'undefined' || typeof document.body === 'undefined') {
    return { bottom: 0, right: 0, left: 0, top: 0 }
  }
  const div = document.createElement('div')
  div.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);'
  document.body.appendChild(div)
  const cs = getComputedStyle(div)
  const top = parseFloat(cs.paddingTop) || 0
  const right = parseFloat(cs.paddingRight) || 0
  const bottom = parseFloat(cs.paddingBottom) || 0
  const left = parseFloat(cs.paddingLeft) || 0
  document.body.removeChild(div)
  return { top, right, bottom, left }
}

function clampPosition(p: Pos, safe: SafeInsets): Pos {
  if (typeof window === 'undefined') return p
  const maxX = window.innerWidth - PLAYER_W - EDGE - safe.right
  const maxY = window.innerHeight - PLAYER_H - EDGE - safe.bottom
  const minX = EDGE + safe.left
  const minY = EDGE + safe.top
  return {
    x: Math.min(Math.max(minX, p.x), maxX),
    y: Math.min(Math.max(minY, p.y), maxY),
  }
}

/** Bottom-center above safe area. */
function defaultPosition(safe: SafeInsets): Pos {
  if (typeof window === 'undefined') return { x: 16, y: 16 }
  const x = (window.innerWidth - PLAYER_W) / 2
  const y = window.innerHeight - PLAYER_H - EDGE - safe.bottom
  return clampPosition({ x, y }, safe)
}

type RaffleOwlPlayerProps = {
  /** When false, audio is paused and the overlay is hidden. */
  enabled: boolean
}

type DragSession = {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  dragging: boolean
}

/**
 * Draggable floating control for the raffle ambient track — **only** on `/raffles` (listings).
 * Renders via portal; attempts autoplay on load (may require a tap on mobile). Tap Play / Pause or drag to move.
 */
function getAudioContextCtor(): (typeof AudioContext) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

export function RaffleOwlPlayer({ enabled }: RaffleOwlPlayerProps) {
  const pathname = usePathname()
  const onRafflesListPage = isRafflesListPathname(pathname)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const mediaSourceWiredRef = useRef(false)
  const glowRafRef = useRef(0)
  const glowEnergyRef = useRef(0)
  const webAudioUnavailableRef = useRef(false)
  const freqDataRef = useRef<Uint8Array | null>(null)

  const safeRef = useRef<SafeInsets>({ top: 0, right: 0, bottom: 0, left: 0 })
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const dragRef = useRef<DragSession | null>(null)

  const [tabVisible, setTabVisible] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'visible'
  )
  const [loadError, setLoadError] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playPending, setPlayPending] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document.body === 'undefined') return
    safeRef.current = measureSafeInsets()
    let next: Pos = defaultPosition(safeRef.current)
    try {
      const raw = localStorage.getItem(POS_STORAGE_KEY)
      if (raw) {
        const p = JSON.parse(raw) as Pos
        if (typeof p?.x === 'number' && typeof p?.y === 'number') {
          next = clampPosition(p, safeRef.current)
        }
      }
    } catch {
      /* ignore */
    }
    setMounted(true)
    setPos(next)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVis = () => setTabVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const syncPlaying = useCallback(() => {
    const a = audioRef.current
    setIsPlaying(!!a && !a.paused && !a.ended)
  }, [])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    if (!enabled || !tabVisible || !onRafflesListPage) {
      a.pause()
      syncPlaying()
    }
  }, [enabled, onRafflesListPage, tabVisible, syncPlaying])

  /** Re-bind when `<audio>` exists (first paint had `return null` so `[]` never saw the element). */
  useEffect(() => {
    if (!mounted || !pos) return
    const a = audioRef.current
    if (!a) return
    const onPlay = () => {
      setIsPlaying(true)
      setPlayPending(false)
    }
    const onPause = () => {
      setIsPlaying(false)
      setPlayPending(false)
    }
    const onPlaying = () => setPlayPending(false)
    a.addEventListener('play', onPlay)
    a.addEventListener('playing', onPlaying)
    a.addEventListener('pause', onPause)
    return () => {
      a.removeEventListener('play', onPlay)
      a.removeEventListener('playing', onPlaying)
      a.removeEventListener('pause', onPause)
    }
  }, [mounted, pos])

  /** Try to start on `/raffles` (often blocked on mobile until a gesture — then Play still works). */
  useEffect(() => {
    if (!mounted || !onRafflesListPage || !enabled || loadError || !tabVisible) return
    const a = audioRef.current
    if (!a) return
    a.loop = true
    a.volume = DEFAULT_VOLUME
    let cancelled = false
    const p = a.play()
    if (p !== undefined) {
      p
        .then(() => {
          if (!cancelled) syncPlaying()
        })
        .catch(() => {
          /* autoplay blocked — ignore */
        })
    }
    return () => {
      cancelled = true
    }
  }, [mounted, onRafflesListPage, enabled, loadError, tabVisible, syncPlaying])

  const persistPos = useCallback((p: Pos) => {
    safeRef.current = measureSafeInsets()
    const c = clampPosition(p, safeRef.current)
    try {
      localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(c))
    } catch {
      /* ignore */
    }
    setPos(c)
  }, [])

  useEffect(() => {
    if (!pos || typeof window === 'undefined') return
    const onResize = () => {
      safeRef.current = measureSafeInsets()
      setPos((p) => (p ? clampPosition(p, safeRef.current) : p))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [pos])

  const stopBeatGlowLoop = useCallback(() => {
    if (glowRafRef.current) {
      cancelAnimationFrame(glowRafRef.current)
      glowRafRef.current = 0
    }
    glowEnergyRef.current = 0
    const btn = buttonRef.current
    if (btn) btn.style.boxShadow = ''
  }, [])

  /** One graph per `<audio>`; drives glow from bass energy (not strict beat detection, but follows kicks). */
  const ensureWebAudioGraph = useCallback((audio: HTMLAudioElement): boolean => {
    if (webAudioUnavailableRef.current) return false
    if (mediaSourceWiredRef.current) {
      const ctx = audioCtxRef.current
      return !!(analyserRef.current && ctx && ctx.state !== 'closed')
    }
    const AC = getAudioContextCtor()
    if (!AC) {
      webAudioUnavailableRef.current = true
      return false
    }
    try {
      const ctx = new AC()
      const src = ctx.createMediaElementSource(audio)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.55
      src.connect(analyser).connect(ctx.destination)
      audioCtxRef.current = ctx
      analyserRef.current = analyser
      mediaSourceWiredRef.current = true
      return true
    } catch {
      webAudioUnavailableRef.current = true
      return false
    }
  }, [])

  const startBeatGlowLoop = useCallback(() => {
    stopBeatGlowLoop()
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const tick = () => {
      const analyser = analyserRef.current
      const btn = buttonRef.current
      const audio = audioRef.current
      if (!analyser || !btn || !audio || audio.paused) {
        stopBeatGlowLoop()
        return
      }
      const n = analyser.frequencyBinCount
      let buf = freqDataRef.current
      if (!buf || buf.length !== n) {
        buf = new Uint8Array(n)
        freqDataRef.current = buf
      }
      analyser.getByteFrequencyData(buf)
      const hi = Math.min(GLOW_BASS_BIN_MAX, buf.length)
      let sum = 0
      for (let i = 0; i < hi; i++) sum += buf[i]!
      const instant = hi > 0 ? sum / (hi * 255) : 0
      const e = glowEnergyRef.current
      glowEnergyRef.current = e * GLOW_SMOOTH + instant * (1 - GLOW_SMOOTH)
      const pulse = Math.min(1, Math.pow(glowEnergyRef.current + instant * GLOW_ATTACK, 0.92))
      const spread = 10 + pulse * 56
      const alpha = 0.28 + pulse * 0.55
      const spread2 = 4 + pulse * 22
      btn.style.boxShadow = [
        `0 0 ${spread}px rgba(52,211,153,${alpha.toFixed(3)})`,
        `0 0 ${spread2}px rgba(16,185,129,${(0.35 + pulse * 0.4).toFixed(3)})`,
        `0 8px 28px rgba(5,150,105,${(0.2 + pulse * 0.25).toFixed(3)})`,
        '0 0 0 1px rgba(209,250,229,0.18) inset',
        'inset 0 1px 0 rgba(255,255,255,0.38)',
      ].join(', ')
      glowRafRef.current = requestAnimationFrame(tick)
    }
    glowRafRef.current = requestAnimationFrame(tick)
  }, [stopBeatGlowLoop])

  useEffect(() => {
    if (!isPlaying || loadError) {
      stopBeatGlowLoop()
      return
    }
    const audio = audioRef.current
    if (!audio) return

    let cancelled = false
    const run = async () => {
      if (!ensureWebAudioGraph(audio) || cancelled) return
      const ctx = audioCtxRef.current
      if (ctx?.state === 'suspended') {
        try {
          await ctx.resume()
        } catch {
          /* blocked until gesture on some browsers */
        }
      }
      if (!cancelled) startBeatGlowLoop()
    }
    void run()
    return () => {
      cancelled = true
      stopBeatGlowLoop()
    }
  }, [ensureWebAudioGraph, isPlaying, loadError, startBeatGlowLoop, stopBeatGlowLoop])

  useEffect(() => {
    return () => {
      stopBeatGlowLoop()
      mediaSourceWiredRef.current = false
      webAudioUnavailableRef.current = false
      analyserRef.current = null
      void audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
    }
  }, [stopBeatGlowLoop])

  const togglePlayPause = useCallback(() => {
    const a = audioRef.current
    if (!a || loadError) return
    a.loop = true
    a.volume = DEFAULT_VOLUME
    if (a.paused) {
      setPlayPending(true)
      void a
        .play()
        .then(async () => {
          setPlayPending(false)
          syncPlaying()
          if (ensureWebAudioGraph(a)) {
            try {
              await audioCtxRef.current?.resume()
            } catch {
              /* ignore */
            }
          }
        })
        .catch(() => setPlayPending(false))
    } else {
      a.pause()
      setPlayPending(false)
    }
  }, [ensureWebAudioGraph, loadError, syncPlaying])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (loadError || e.button !== 0) return
      if (!pos) return
      safeRef.current = measureSafeInsets()
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: pos.x,
        originY: pos.y,
        dragging: false,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [loadError, pos]
  )

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.dragging) {
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
      d.dragging = true
    }
    setPos(clampPosition({ x: d.originX + dx, y: d.originY + dy }, safeRef.current))
  }, [])

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
      dragRef.current = null
      if (d.dragging) {
        const nx = d.originX + (e.clientX - d.startX)
        const ny = d.originY + (e.clientY - d.startY)
        persistPos({ x: nx, y: ny })
      } else {
        togglePlayPause()
      }
    },
    [persistPos, togglePlayPause]
  )

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      dragRef.current = null
      if (d.dragging) {
        const nx = d.originX + (e.clientX - d.startX)
        const ny = d.originY + (e.clientY - d.startY)
        persistPos({ x: nx, y: ny })
      }
    },
    [persistPos]
  )

  if (!enabled || !mounted || !pos || !onRafflesListPage) {
    return null
  }

  const label = loadError
    ? 'Soundtrack unavailable'
    : isPlaying
      ? `Pause — ${RAFFLE_AMBIENT_TRACK_TITLE}`
      : `Play — ${RAFFLE_AMBIENT_TRACK_TITLE}`

  const content = (
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
              '[RaffleOwlPlayer] Failed to load ambient track. Add your WAV at public/audio/owltopia-move-in-silence.wav (see lib/raffle-ambient-audio.ts).'
            )
          }
          setLoadError(true)
        }}
      />
      <button
        ref={buttonRef}
        type="button"
        style={{ left: pos.x, top: pos.y, width: PLAYER_W, height: PLAYER_H }}
        className={`fixed z-[160] flex touch-none select-none items-center justify-center rounded-full transition-[transform,background-color] active:scale-[0.97] motion-reduce:transition-none ${
          loadError
            ? 'border border-red-400/35 bg-gradient-to-br from-red-500/25 to-red-900/30 text-red-100 backdrop-blur-xl shadow-[0_8px_28px_rgba(220,38,38,0.25),inset_0_1px_0_rgba(255,255,255,0.18)]'
            : isPlaying
              ? 'border border-emerald-200/40 bg-gradient-to-br from-emerald-300/35 via-emerald-500/25 to-teal-800/40 text-emerald-50 backdrop-blur-xl backdrop-saturate-150 shadow-[0_8px_36px_rgba(16,185,129,0.45),0_0_0_1px_rgba(167,243,208,0.15)_inset,inset_0_1px_0_rgba(255,255,255,0.35)]'
              : 'border border-emerald-200/45 bg-gradient-to-br from-emerald-400/30 via-emerald-500/20 to-teal-700/35 text-emerald-50 backdrop-blur-xl backdrop-saturate-150 shadow-[0_8px_36px_rgba(5,150,105,0.4),0_0_0_1px_rgba(209,250,229,0.2)_inset,inset_0_1px_0_rgba(255,255,255,0.4)]'
        }`}
        aria-label={label}
        title={`${RAFFLE_AMBIENT_TRACK_TITLE} — tap to play or pause, drag to move`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {loadError ? (
          <span className="pointer-events-none text-sm font-bold tabular-nums" aria-hidden>
            !
          </span>
        ) : playPending && !isPlaying ? (
          <Loader2
            className="pointer-events-none h-7 w-7 shrink-0 animate-spin text-emerald-100/90"
            aria-hidden
          />
        ) : isPlaying ? (
          <Pause className="pointer-events-none h-7 w-7 shrink-0" aria-hidden strokeWidth={2.25} />
        ) : (
          <Play className="pointer-events-none ml-0.5 h-7 w-7 shrink-0" fill="currentColor" aria-hidden />
        )}
      </button>
    </>
  )

  return createPortal(content, document.body)
}

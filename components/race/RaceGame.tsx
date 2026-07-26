'use client'

import { Suspense, useCallback, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader } from '@react-three/drei'
import { Flag, Play, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RaceControls } from '@/components/race/RaceControls'
import { RaceWorld } from '@/components/race/RaceWorld'
import { useRaceGameStore } from '@/lib/race/store'

const BEST_TIME_KEY = 'owltopia-flight-league-best-v1'

function formatTime(milliseconds: number): string {
  const totalSeconds = milliseconds / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  const hundredths = Math.floor((milliseconds % 1000) / 10)
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`
}

export function RaceGame() {
  const stamina = useRaceGameStore((state) => state.stamina)
  const motion = useRaceGameStore((state) => state.motion)
  const status = useRaceGameStore((state) => state.status)
  const countdown = useRaceGameStore((state) => state.countdown)
  const currentCheckpoint = useRaceGameStore(
    (state) => state.currentCheckpoint
  )
  const checkpointCount = useRaceGameStore((state) => state.checkpointCount)
  const elapsedMs = useRaceGameStore((state) => state.elapsedMs)
  const bestTimeMs = useRaceGameStore((state) => state.bestTimeMs)
  const feedback = useRaceGameStore((state) => state.feedback)
  const prepareRace = useRaceGameStore((state) => state.prepareRace)
  const setCountdown = useRaceGameStore((state) => state.setCountdown)
  const beginRace = useRaceGameStore((state) => state.beginRace)
  const updateElapsed = useRaceGameStore((state) => state.updateElapsed)
  const loadBestTime = useRaceGameStore((state) => state.loadBestTime)
  const clearFeedback = useRaceGameStore((state) => state.clearFeedback)

  const startRace = useCallback(() => {
    window.dispatchEvent(new Event('owl-race-reset'))
    prepareRace()
  }, [prepareRace])

  useEffect(() => {
    const saved = window.localStorage.getItem(BEST_TIME_KEY)
    const parsed = saved === null ? null : Number(saved)
    loadBestTime(
      parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null
    )
  }, [loadBestTime])

  useEffect(() => {
    if (status !== 'countdown') return

    const timeout = window.setTimeout(() => {
      if (countdown <= 1) beginRace()
      else setCountdown(countdown - 1)
    }, 1000)

    return () => window.clearTimeout(timeout)
  }, [beginRace, countdown, setCountdown, status])

  useEffect(() => {
    if (status !== 'racing') return
    const interval = window.setInterval(updateElapsed, 33)
    return () => window.clearInterval(interval)
  }, [status, updateElapsed])

  useEffect(() => {
    if (status === 'finished' && bestTimeMs !== null) {
      window.localStorage.setItem(BEST_TIME_KEY, String(bestTimeMs))
    }
  }, [bestTimeMs, status])

  useEffect(() => {
    if (!feedback || status === 'finished') return
    const timeout = window.setTimeout(clearFeedback, 1600)
    return () => window.clearTimeout(timeout)
  }, [clearFeedback, feedback, status])

  return (
    <div className="relative h-[min(78vh,760px)] min-h-[520px] w-full overflow-hidden rounded-2xl border border-emerald-400/25 bg-[#07120d] shadow-2xl shadow-emerald-950/40 [touch-action:none]">
      <Canvas
        shadows
        dpr={[1, 1.6]}
        camera={{ fov: 55, near: 0.1, far: 130, position: [0, 8, 15] }}
      >
        <Suspense fallback={null}>
          <RaceWorld />
        </Suspense>
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 w-52 rounded-xl border border-white/15 bg-black/60 p-3 text-white backdrop-blur">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-300">
          <span>Boost stamina</span>
          <span>{Math.round(stamina)}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-300 transition-[width] duration-100"
            style={{ width: `${stamina}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-2 text-[11px] text-zinc-400">
          <span>
            <strong className="block text-sm font-semibold text-white">
              {formatTime(elapsedMs)}
            </strong>
            Time
          </span>
          <span className="text-right">
            <strong className="block text-sm font-semibold text-emerald-300">
              {Math.min(currentCheckpoint + 1, checkpointCount)}/{checkpointCount}
            </strong>
            Next gate
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
          <span className="capitalize">{motion}</span>
          <span className="capitalize">{status}</span>
        </div>
      </div>

      {bestTimeMs !== null ? (
        <div className="pointer-events-none absolute right-3 top-14 rounded-lg border border-amber-300/20 bg-black/60 px-3 py-2 text-xs text-amber-200 backdrop-blur">
          <Trophy className="mr-1 inline h-3.5 w-3.5" />
          Best {formatTime(bestTimeMs)}
        </div>
      ) : null}

      {feedback ? (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded-full border border-emerald-300/30 bg-black/75 px-5 py-2 text-sm font-semibold text-emerald-200 backdrop-blur">
          {feedback}
        </div>
      ) : null}

      {status === 'ready' ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35 backdrop-blur-[2px]">
          <div className="rounded-2xl border border-emerald-300/25 bg-black/80 p-7 text-center text-white shadow-2xl">
            <Flag className="mx-auto h-9 w-9 text-emerald-300" />
            <h2 className="mt-3 text-2xl font-bold">Forest Flight Trial</h2>
            <p className="mt-2 max-w-sm text-sm text-zinc-400">
              Clear all five glowing gates in order. Skipping a gate will not
              advance your run.
            </p>
            <Button className="mt-5" size="lg" onClick={startRace}>
              <Play className="mr-2 h-5 w-5" />
              Start race
            </Button>
          </div>
        </div>
      ) : null}

      {status === 'countdown' ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/20">
          <span className="font-display text-8xl text-emerald-300 drop-shadow-[0_0_28px_rgba(52,211,153,0.8)]">
            {countdown}
          </span>
        </div>
      ) : null}

      {status === 'finished' ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="w-[min(90%,420px)] rounded-2xl border border-emerald-300/30 bg-black/90 p-7 text-center text-white shadow-2xl">
            <Trophy className="mx-auto h-11 w-11 text-amber-300" />
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">
              Flight complete
            </p>
            <h2 className="mt-2 font-display text-5xl">
              {formatTime(elapsedMs)}
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Personal best: {bestTimeMs === null ? '—' : formatTime(bestTimeMs)}
            </p>
            <Button className="mt-5" size="lg" onClick={startRace}>
              Race again
            </Button>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 rounded-lg border border-white/10 bg-black/55 px-4 py-2 text-xs text-zinc-200 backdrop-blur md:block">
        W/S speed · A/D steer · Shift boost · Space climb · E dive
      </div>

      <RaceControls />
      <Loader
        containerStyles={{ background: 'rgba(2, 8, 5, 0.94)' }}
        innerStyles={{ width: 180, height: 6, background: 'rgba(255,255,255,.12)' }}
        barStyles={{ height: 6, background: '#34d399' }}
        dataStyles={{ color: '#d1fae5', fontSize: 12 }}
      />
    </div>
  )
}

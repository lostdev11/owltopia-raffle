'use client'

import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader } from '@react-three/drei'
import { RaceControls } from '@/components/race/RaceControls'
import { RaceWorld } from '@/components/race/RaceWorld'
import { useRaceGameStore } from '@/lib/race/store'

export function RaceGame() {
  const stamina = useRaceGameStore((state) => state.stamina)
  const grounded = useRaceGameStore((state) => state.grounded)
  const motion = useRaceGameStore((state) => state.motion)

  return (
    <div className="relative h-[min(78vh,760px)] min-h-[520px] w-full overflow-hidden rounded-2xl border border-emerald-400/25 bg-[#07120d] shadow-2xl shadow-emerald-950/40 [touch-action:none]">
      <Canvas
        shadows
        dpr={[1, 1.6]}
        camera={{ fov: 55, near: 0.1, far: 130, position: [0, 4, 13] }}
      >
        <Suspense fallback={null}>
          <RaceWorld />
        </Suspense>
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 w-48 rounded-xl border border-white/15 bg-black/60 p-3 text-white backdrop-blur">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-300">
          <span>Stamina</span>
          <span>{Math.round(stamina)}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-300 transition-[width] duration-100"
            style={{ width: `${stamina}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
          <span className="capitalize">{motion}</span>
          <span>{grounded ? 'Grounded' : 'Airborne'}</span>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 rounded-lg border border-white/10 bg-black/55 px-4 py-2 text-xs text-zinc-200 backdrop-blur md:block">
        WASD move · Shift sprint · Space jump · E glide
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

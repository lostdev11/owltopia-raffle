'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'

type PackPhase = 'idle' | 'paying' | 'video' | 'reveal'

type Props = {
  phase: PackPhase
  className?: string
}

/**
 * Foil pack on a glowing pedestal — matches the Owltopia Pack open-experience mock.
 * Motions: idle float, energy sparks while paying, shine sweep.
 */
export function PackVisual({ phase, className }: Props) {
  const paying = phase === 'paying' || phase === 'video'
  const reveal = phase === 'reveal'

  return (
    <div
      className={cn(
        'relative mx-auto flex w-full max-w-[min(82vw,380px)] flex-col items-center select-none',
        className
      )}
      aria-hidden
    >
      {/* Atmospheric bloom */}
      <div
        className={cn(
          'pointer-events-none absolute left-1/2 top-[18%] h-[70%] w-[90%] -translate-x-1/2 rounded-full',
          'bg-[radial-gradient(circle,rgba(0,255,156,0.28),transparent_68%)] blur-3xl transition-opacity duration-700',
          paying || reveal ? 'opacity-100' : 'opacity-75'
        )}
      />

      {paying ? (
        <>
          <span className="pointer-events-none absolute left-[12%] top-[22%] h-2 w-2 rounded-full bg-[#00FF9C] shadow-[0_0_12px_#00FF9C] animate-pack-spark" />
          <span
            className="pointer-events-none absolute right-[16%] top-[30%] h-1.5 w-1.5 rounded-full bg-[#7DFFB8] shadow-[0_0_10px_#00FF9C] animate-pack-spark"
            style={{ animationDelay: '0.35s' }}
          />
          <span
            className="pointer-events-none absolute left-[22%] top-[48%] h-1.5 w-1.5 rounded-full bg-amber-200 shadow-[0_0_10px_rgba(251,191,36,0.8)] animate-pack-spark"
            style={{ animationDelay: '0.7s' }}
          />
          <span
            className="pointer-events-none absolute right-[20%] top-[55%] h-2 w-2 rounded-full bg-[#00E58B] shadow-[0_0_12px_#00FF9C] animate-pack-spark"
            style={{ animationDelay: '1s' }}
          />
        </>
      ) : null}

      <div
        className={cn(
          'relative z-[1] aspect-[3/4] w-[78%]',
          reveal
            ? 'animate-pack-reveal-burst'
            : paying
              ? 'animate-pack-pay-pulse'
              : 'animate-pack-float motion-reduce:animate-none'
        )}
      >
        {/* Pack body — black foil */}
        <div
          className={cn(
            'absolute inset-0 overflow-hidden rounded-[1.1rem]',
            'bg-gradient-to-b from-[#1a1f1c] via-[#0a0d0b] to-[#050706]',
            'ring-1 ring-[#00FF9C]/30',
            'shadow-[0_30px_90px_-20px_rgba(0,255,156,0.55),inset_0_1px_0_rgba(255,255,255,0.08)]'
          )}
        >
          {/* Foil grain */}
          <div
            className="absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(118deg, rgba(0,255,156,0.35) 0 1px, transparent 1px 11px), repeating-linear-gradient(28deg, rgba(255,255,255,0.12) 0 1px, transparent 1px 13px)',
            }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(0,255,156,0.22),transparent_52%)]" />

          {/* Diagonal shine */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className={cn(
                'absolute -left-1/3 top-0 h-full w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent',
                paying ? 'animate-pack-shine' : 'animate-pack-shine [animation-duration:4.8s]'
              )}
            />
          </div>

          {/* Brand strip */}
          <div className="absolute inset-x-0 top-[9%] flex flex-col items-center gap-3 px-4 text-center">
            <p className="font-display text-[clamp(1.05rem,4.2vw,1.45rem)] tracking-[0.28em] text-[#00FF9C] drop-shadow-[0_0_12px_rgba(0,255,156,0.55)]">
              OWLTOPIA
            </p>
            <div
              className={cn(
                'relative flex h-[min(38%,120px)] w-[min(52%,140px)] items-center justify-center',
                'rounded-2xl bg-black/40 ring-1 ring-[#00FF9C]/35',
                'shadow-[0_0_40px_-8px_rgba(0,255,156,0.7)]'
              )}
            >
              <Image
                src="/images/nesting-owl-cube-mark.png"
                alt=""
                width={112}
                height={112}
                className="h-[78%] w-[78%] object-contain drop-shadow-[0_0_18px_rgba(0,255,156,0.45)]"
                priority
              />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/55">
              Premium pack
            </p>
          </div>

          {/* Tear notch hint */}
          <div className="absolute inset-x-[18%] top-0 h-2 rounded-b-full bg-gradient-to-b from-[#00FF9C]/35 to-transparent" />
        </div>
      </div>

      {/* Glowing pedestal */}
      <div className="relative z-0 -mt-3 flex w-[88%] flex-col items-center">
        <div
          className={cn(
            'h-3 w-[72%] rounded-full bg-[radial-gradient(ellipse_at_center,#00FF9C,transparent_70%)] blur-[2px]',
            paying ? 'animate-pack-pedestal-glow' : 'opacity-90'
          )}
        />
        <div
          className={cn(
            'mt-1 h-[18px] w-full rounded-[50%] border border-[#00FF9C]/25',
            'bg-[radial-gradient(ellipse_at_center,rgba(0,255,156,0.35)_0%,rgba(8,14,11,0.95)_55%,#050807_100%)]',
            'shadow-[0_0_40px_rgba(0,255,156,0.35),inset_0_0_24px_rgba(0,255,156,0.15)]',
            paying ? 'animate-pack-pedestal-glow' : ''
          )}
        />
        <div className="mt-0.5 h-2 w-[92%] rounded-[50%] bg-black/70 blur-[1px]" />
      </div>
    </div>
  )
}

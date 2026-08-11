'use client'

import { cn } from '@/lib/utils'

type PackPhase = 'idle' | 'paying' | 'video' | 'reveal'

type Props = {
  phase: PackPhase
  className?: string
}

/**
 * Dominant pack artwork for the hero — CSS composition, not a card.
 * Motions: idle float, pay pulse + seal spin, reveal burst rings.
 */
export function PackVisual({ phase, className }: Props) {
  const paying = phase === 'paying' || phase === 'video'
  const reveal = phase === 'reveal'

  return (
    <div
      className={cn(
        'relative mx-auto aspect-square w-full max-w-[min(72vw,340px)] select-none',
        className
      )}
      aria-hidden
    >
      {/* Soft atmospheric glow behind the pack */}
      <div
        className={cn(
          'absolute inset-[-12%] rounded-full bg-[radial-gradient(circle,rgba(0,255,156,0.22),transparent_68%)] blur-2xl transition-opacity duration-700',
          paying || reveal ? 'opacity-100' : 'opacity-70'
        )}
      />

      {reveal ? (
        <>
          <div className="absolute inset-[8%] rounded-full border border-[#00FF9C]/35 animate-pack-ring-expand" />
          <div
            className="absolute inset-[8%] rounded-full border border-amber-300/30 animate-pack-ring-expand"
            style={{ animationDelay: '0.35s' }}
          />
        </>
      ) : null}

      <div
        className={cn(
          'relative h-full w-full',
          reveal
            ? 'animate-pack-reveal-burst'
            : paying
              ? 'animate-pack-pay-pulse'
              : 'animate-pack-float motion-reduce:animate-none'
        )}
      >
        {/* Pack body */}
        <div
          className={cn(
            'absolute inset-[8%] overflow-hidden rounded-[1.35rem]',
            'bg-gradient-to-br from-[#163528] via-[#0d1a14] to-[#08110c]',
            'ring-1 ring-[#00E58B]/25',
            'shadow-[0_24px_80px_-28px_rgba(0,255,156,0.55)]'
          )}
        >
          {/* Forest grain / atmosphere */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(0,255,156,0.18),transparent_55%),radial-gradient(circle_at_80%_90%,rgba(251,191,36,0.12),transparent_45%)]" />
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,255,255,0.35) 0 1px, transparent 1px 14px)',
            }}
          />

          {/* Diagonal shine sweep */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className={cn(
                'absolute -left-1/3 top-0 h-full w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent',
                paying || reveal ? 'animate-pack-shine' : 'animate-pack-shine [animation-duration:4.5s]'
              )}
            />
          </div>

          {/* Center emblem */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="font-display text-[clamp(2.4rem,10vw,3.6rem)] leading-none tracking-[0.06em] text-[#EAFBF4]">
              OWL
            </p>
            <p className="font-display text-[clamp(1.35rem,5vw,1.9rem)] leading-none tracking-[0.22em] text-[#00FF9C]">
              PACK
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.32em] text-[#A9CBB9]/80">
              Every open wins
            </p>
          </div>

          {/* Wax seal */}
          <div
            className={cn(
              'absolute bottom-[12%] left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full',
              'bg-gradient-to-br from-amber-300 via-amber-500 to-amber-700',
              'ring-2 ring-amber-200/40 shadow-[0_0_24px_rgba(251,191,36,0.45)]',
              paying ? 'animate-pack-seal-spin' : ''
            )}
          >
            <span className="font-display text-lg leading-none text-[#1a1205]">OT</span>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { Zap } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = {
  className?: string
  /** From stats `presale_live`; omit while still loading first stats fetch. */
  live?: boolean
  statsLoading?: boolean
}

function presaleUsdcFromEnv(): number {
  const n = Number(process.env.NEXT_PUBLIC_GEN2_PRESALE_PRICE_USDC)
  return Number.isFinite(n) && n > 0 ? n : 20
}

export function Gen2PresaleBanner({ className, live, statsLoading }: Props) {
  const paused = live === false
  const pending = statsLoading || live === undefined
  const spotUsdc = presaleUsdcFromEnv()

  return (
    <div
      className={cn(
        'sticky top-0 z-50 border-b bg-[#0B0F12]/95 backdrop-blur-md',
        paused
          ? 'border-[#FFD769]/35 animate-none'
          : 'border-[#00E58B]/25 animate-gen2-border-pulse',
        className
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 bg-gradient-to-r via-transparent',
          paused ? 'from-[#FFD769]/10 to-[#FFD769]/10' : 'from-[#00E58B]/10 to-[#00E58B]/10'
        )}
      />
      <div className="relative mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-3 sm:flex-row sm:gap-4">
        <p className="flex flex-wrap items-center justify-center gap-2 text-center text-sm font-semibold text-[#EAFBF4] sm:text-left">
          <Zap className={cn('h-4 w-4 shrink-0', paused ? 'text-[#FFD769]' : 'text-[#FFD769]')} aria-hidden />
          <span>
            <span
              className={cn(
                'inline font-black',
                paused ? 'text-[#FFD769]' : 'animate-gen2-live-blink text-[#00FF9C]'
              )}
            >
              OWLTOPIA GEN2
            </span>
            <span className="mx-1.5 text-[#A9CBB9]">·</span>
            <span className={cn('font-black', paused ? 'text-[#A9CBB9]' : 'text-[#00FF9C]')}>PRESALE</span>
            {pending ? (
              <span className="mx-1 font-black text-[#A9CBB9]">…</span>
            ) : paused ? (
              <span className="mx-1 font-black text-[#FFD769]">PAUSED</span>
            ) : (
              <span className="mx-1 font-black text-[#FFD769]">LIVE</span>
            )}
            <span className="text-[#A9CBB9]">
              — 1 spot = 1 Gen2 mint ·{' '}
              <span className="font-semibold text-[#EAFBF4]">${spotUsdc} USDC</span>{' '}
              <span className="text-[#A9CBB9]">(paid in SOL)</span>
            </span>
          </span>
        </p>
        {paused ? (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="min-h-[44px] shrink-0 touch-manipulation border-[#1F6F54] bg-[#10161C] px-5 font-semibold text-[#A9CBB9]"
          >
            <Link href="#gen2-purchase">Details</Link>
          </Button>
        ) : (
          <Button
            asChild
            size="sm"
            className="min-h-[44px] shrink-0 touch-manipulation border border-[#00FF9C]/40 bg-[#00E58B]/15 px-5 font-bold text-[#EAFBF4] shadow-[0_0_24px_rgba(0,255,156,0.25)] hover:bg-[#00E58B]/25"
          >
            <Link href="#gen2-purchase">{pending ? 'Presale' : 'Buy Presale'}</Link>
          </Button>
        )}
      </div>
    </div>
  )
}

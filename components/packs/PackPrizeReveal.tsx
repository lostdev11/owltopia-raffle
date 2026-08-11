'use client'

import Link from 'next/link'
import { Coins, ImageIcon, Sparkles, Ticket } from 'lucide-react'
import type { PackOpenClientResult } from '@/lib/client/execute-pack-purchase'
import { cn } from '@/lib/utils'

type Props = {
  result: PackOpenClientResult
  onRipAgain: () => void
  className?: string
}

function PrizeCategoryGlyph({ category }: { category: string }) {
  const className = 'h-9 w-9 text-[#00FF9C]'
  if (category === 'sol') return <Coins className={className} aria-hidden />
  if (category === 'nft') return <ImageIcon className={className} aria-hidden />
  return <Sparkles className={className} aria-hidden />
}

export function PackPrizeReveal({ result, onRipAgain, className }: Props) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-md text-center animate-pack-reveal-burst',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="relative mx-auto mb-5 flex h-24 w-24 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-[#00FF9C]/15 blur-xl" />
        <div className="absolute inset-[-10%] rounded-full border border-[#00FF9C]/30 animate-pack-ring-expand" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#163528] to-[#0a1210] ring-1 ring-[#00E58B]/40">
          <PrizeCategoryGlyph category={result.category} />
        </div>
      </div>

      <p className="font-display text-4xl tracking-[0.08em] text-[#EAFBF4] sm:text-5xl">
        You won
      </p>
      <p className="mt-2 text-xl font-semibold text-amber-200 sm:text-2xl">{result.prizeLabel}</p>
      <p className="mt-3 text-sm leading-relaxed text-[#A9CBB9]">{result.revealMessage}</p>

      {result.category === 'owl' && result.freeTicketCredits > 0 ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#00E58B]/25 bg-[#00E58B]/10 px-3 py-1.5 text-sm text-[#00FF9C]">
          <Ticket className="h-4 w-4" aria-hidden />
          {result.freeTicketCredits} free raffle ticket
          {result.freeTicketCredits === 1 ? '' : 's'} credited
        </p>
      ) : null}

      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={onRipAgain}
          className="inline-flex min-h-[48px] min-w-[180px] items-center justify-center rounded-xl bg-[#00FF9C] px-6 text-sm font-bold uppercase tracking-wider text-[#062016] transition hover:bg-[#7DFFB8]"
        >
          Rip another
        </button>
        <Link
          href={`/packs/verify/${result.openId}`}
          className="text-sm text-[#00FF9C]/80 underline-offset-4 hover:underline"
        >
          Verify this open
        </Link>
      </div>
    </div>
  )
}

'use client'

import Image from 'next/image'
import Link from 'next/link'
import { CheckCircle2, Coins, ImageIcon, Ticket } from 'lucide-react'
import type { PackOpenClientResult } from '@/lib/client/execute-pack-purchase'
import { PackOwlPrizeImage } from '@/components/packs/PackOwlPrizeImage'
import { cn } from '@/lib/utils'

type Props = {
  result: PackOpenClientResult
  onRipAgain: () => void
  className?: string
}

function categoryLabel(category: string) {
  if (category === 'jackpot') return 'Jackpot'
  if (category === 'sol') return 'SOL'
  if (category === 'nft') return 'NFT'
  return '$OWL'
}

function PrizeArt({ result }: { result: PackOpenClientResult }) {
  if (result.category === 'nft' && result.nftImageUrl) {
    return (
      <Image
        src={result.nftImageUrl}
        alt={result.nftName || result.prizeLabel}
        width={280}
        height={280}
        className="h-full w-full object-cover"
        unoptimized
      />
    )
  }
  if (result.category === 'sol' || result.category === 'jackpot') {
    return <Coins className="h-16 w-16 text-[#00FF9C]" aria-hidden />
  }
  if (result.category === 'owl') {
    return <PackOwlPrizeImage size={280} priority />
  }
  return <ImageIcon className="h-16 w-16 text-[#00FF9C]" aria-hidden />
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
      <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[#00FF9C]/80">
        Congratulations
      </p>
      <h2 className="mt-2 font-display text-3xl tracking-[0.04em] text-white sm:text-4xl">
        {result.category === 'jackpot' ? (
          <>
            <span className="text-amber-300">Jackpot!</span>
          </>
        ) : (
          <>
            You revealed a{' '}
            <span className="text-[#00FF9C]">{categoryLabel(result.category)}</span>
          </>
        )}
      </h2>
      <p className="mt-2 text-sm text-white/55">Your reward appears!</p>

      <div className="relative mx-auto mt-6 aspect-[3/4] w-[min(72%,260px)]">
        <div className="absolute inset-[-12%] rounded-full bg-[radial-gradient(circle,rgba(0,255,156,0.35),transparent_68%)] blur-2xl" />
        <div className="absolute inset-[-6%] rounded-full border border-[#00FF9C]/25 animate-pack-ring-expand" />
        <div
          className={cn(
            'relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl',
            'bg-gradient-to-b from-[#121816] to-[#070a08]',
            'ring-1 ring-[#00FF9C]/40',
            'shadow-[0_0_60px_-12px_rgba(0,255,156,0.65)]'
          )}
        >
          <PrizeArt result={result} />
        </div>
      </div>

      <p className="mt-5 text-xl font-semibold text-amber-200 sm:text-2xl">{result.prizeLabel}</p>
      <p className="mt-2 text-sm leading-relaxed text-white/60">{result.revealMessage}</p>

      {result.category === 'owl' && result.freeTicketCredits > 0 ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#00E58B]/25 bg-[#00E58B]/10 px-3 py-1.5 text-sm text-[#00FF9C]">
          <Ticket className="h-4 w-4" aria-hidden />
          {result.freeTicketCredits} free raffle ticket
          {result.freeTicketCredits === 1 ? '' : 's'} credited
        </p>
      ) : null}

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link
          href={`/packs/verify/${result.openId}`}
          className="inline-flex min-h-[48px] min-w-[180px] items-center justify-center gap-2 rounded-xl bg-[#00FF9C] px-6 text-sm font-bold uppercase tracking-wider text-[#062016] transition hover:bg-[#7DFFB8]"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Verify open
        </Link>
        <button
          type="button"
          onClick={onRipAgain}
          className="inline-flex min-h-[48px] min-w-[180px] items-center justify-center rounded-xl border border-[#00FF9C]/45 bg-transparent px-6 text-sm font-bold uppercase tracking-wider text-[#00FF9C] transition hover:bg-[#00FF9C]/10"
        >
          Open another
        </button>
      </div>
    </div>
  )
}

'use client'

import type { TouchEventHandler } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { TrendingUp, Trophy } from 'lucide-react'
import type { Raffle } from '@/lib/types'
import { getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'
import {
  normalizeRaffleTicketCurrency,
  revenueInCurrency,
  type RaffleProfitInfo,
} from '@/lib/raffle-profit'
import { OwltopiaOverThresholdBrandBanner } from '@/components/OwltopiaOverThresholdBrandBanner'

export type RaffleOverThresholdItem = {
  raffle: Raffle
  profitInfo?: RaffleProfitInfo
}

type RaffleOverThresholdFlexShowcaseProps = {
  items: RaffleOverThresholdItem[]
  /** e.g. touch handlers from parent to avoid scroll→nav on mobile */
  onFeaturedTouchStart?: TouchEventHandler<HTMLAnchorElement>
  onFeaturedTouchMove?: TouchEventHandler<HTMLAnchorElement>
  onFeaturedTouchEnd?: TouchEventHandler<HTMLAnchorElement>
}

/**
 * Prominent “flex” block for raffles where ticket revenue is over the platform revenue threshold
 * (floor / draw goal / prize value). Showcases that creators can outpace a traditional marketplace
 * list-only play when the community shows up.
 */
export function RaffleOverThresholdFlexShowcase({
  items,
  onFeaturedTouchStart,
  onFeaturedTouchMove,
  onFeaturedTouchEnd,
}: RaffleOverThresholdFlexShowcaseProps) {
  if (items.length === 0) return null

  return (
    <section className="mt-4" aria-labelledby="over-threshold-flex-heading">
      <div className="overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-b from-emerald-950/50 via-background to-background shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_20px_50px_rgba(0,0,0,0.45)]">
        <OwltopiaOverThresholdBrandBanner
          topLeft={
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-500/30 px-2.5 py-1 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-emerald-50 shadow-[0_0_20px_rgba(16,185,129,0.35)]">
              <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Past listed floor
            </span>
          }
          bottomContent={
            <p className="max-w-md text-sm font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] sm:text-base">
              Ticket revenue is above the creator&apos;s listed floor—more than a static marketplace listing.
            </p>
          }
        />
        <div className="space-y-3 px-3 pb-3 pt-2 sm:px-4 sm:pb-4 sm:pt-3">
          <div className="space-y-2">
            <h2
              id="over-threshold-flex-heading"
              className="text-base sm:text-lg font-semibold tracking-tight text-foreground"
            >
              Beating the floor on Owltopia
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              Compared to each raffle&apos;s <span className="font-medium text-foreground">listed floor price</span> (shown
              on the prize), gross ticket revenue is higher than that floor—or, when only a blended threshold applies, past
              the full revenue bar. Same flex: discovery with tickets, not only a floor ask.
            </p>
          </div>
          <ul
            className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3"
            role="list"
            aria-label="Over-threshold raffles"
          >
            {items.slice(0, 3).map(({ raffle, profitInfo }) => {
              const ticketCur = normalizeRaffleTicketCurrency(raffle.currency)
              const thresholdCur =
                profitInfo?.thresholdCurrency != null
                  ? normalizeRaffleTicketCurrency(profitInfo.thresholdCurrency)
                  : ticketCur
              const displayCur =
                profitInfo?.floorComparisonCurrency != null
                  ? normalizeRaffleTicketCurrency(profitInfo.floorComparisonCurrency)
                  : thresholdCur
              const cardImageSrc =
                getRaffleDisplayImageUrl(raffle.image_url) ??
                getRaffleDisplayImageUrl(raffle.image_fallback_url)
              const revenueValue =
                profitInfo != null ? revenueInCurrency(profitInfo.revenue, displayCur) : null
              const displayBar =
                profitInfo?.floorComparisonValue ?? profitInfo?.threshold ?? null
              const surplus =
                profitInfo?.surplusOverFloor ?? profitInfo?.surplusOverThreshold ?? null
              const chipLabel =
                profitInfo?.floorComparisonValue != null ? 'Above floor' : 'Over threshold'
              const barLabelShort =
                profitInfo?.floorComparisonValue != null
                  ? 'Floor'
                  : raffle.prize_type === 'nft'
                    ? 'Bar'
                    : 'Threshold'

              return (
                <li key={raffle.id} className="min-w-0">
                  <Link
                    href={`/raffles/${raffle.slug}`}
                    className="group flex h-full min-h-[44px] flex-col justify-between gap-2 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/[0.07] to-transparent px-3 py-3 sm:px-4 sm:py-3.5 transition-all hover:border-emerald-400/60 hover:shadow-[0_0_24px_rgba(16,185,129,0.25)] touch-manipulation"
                    onTouchStart={onFeaturedTouchStart}
                    onTouchMove={onFeaturedTouchMove}
                    onTouchEnd={onFeaturedTouchEnd}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="relative mt-0.5 h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-emerald-500/30 bg-emerald-950/50">
                        {cardImageSrc ? (
                          <Image
                            src={cardImageSrc}
                            alt={raffle.title}
                            fill
                            sizes="56px"
                            className="object-cover"
                            unoptimized={cardImageSrc.startsWith('/api/proxy-image')}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-emerald-200/90">
                            NFT
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-2 min-w-0 text-sm sm:text-base font-semibold text-foreground group-hover:underline">
                            {raffle.title}
                          </p>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-700/25 bg-emerald-600/15 px-2 py-0.5 text-[10px] sm:text-xs font-semibold text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-500/20 dark:text-emerald-100">
                            <Trophy className="h-3 w-3 shrink-0" aria-hidden />
                            {chipLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                    {revenueValue != null && (
                      <p className="text-[11px] sm:text-xs text-foreground/90">
                        <span className="text-muted-foreground">Revenue</span>{' '}
                        <span className="font-semibold">
                          {revenueValue.toFixed(displayCur === 'USDC' ? 2 : 4)} {displayCur}
                        </span>
                        {displayBar != null && (
                          <>
                            {' '}
                            <span className="text-muted-foreground">·</span> {barLabelShort}{' '}
                            <span className="font-semibold">
                              {displayBar.toFixed(displayCur === 'USDC' ? 2 : 4)} {displayCur}
                            </span>
                          </>
                        )}
                        {surplus != null && surplus > 0 && (
                          <>
                            {' '}
                            <span className="text-muted-foreground">·</span>{' '}
                            <span className="text-emerald-700 dark:text-emerald-200/95 font-medium">
                              +{surplus.toFixed(displayCur === 'USDC' ? 2 : 4)} {displayCur}{' '}
                              {profitInfo?.floorComparisonValue != null ? 'past floor' : 'past bar'}
                            </span>
                          </>
                        )}
                      </p>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </section>
  )
}

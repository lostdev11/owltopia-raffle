'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Raffle, Entry } from '@/lib/types'
import { RaffleCard } from '@/components/RaffleCard'
import { Users } from 'lucide-react'
import { RAFFLES_LIST_ENTRIES_POLL_MS } from '@/lib/dev-budget'
import { PARTNER_LOGOS } from '@/lib/partner-logos'
import {
  PURCHASE_COMPLETED_EVENT,
  type PurchaseCompletedDetail,
} from '@/lib/cart/purchase-complete-events'
import { fetchEntriesByRaffleIdsClient } from '@/lib/raffles/fetch-entries-bulk-client'

type Item = { raffle: Raffle; entries: Entry[] }

/** Same idea as RafflesList: SSR sends entries: []; keep fetched rows across router.refresh. */
function mergeCarouselProps(prev: Item[], next: Item[]): Item[] {
  const prevById = new Map(prev.map((x) => [x.raffle.id, x]))
  return next.map((item) => {
    const prevItem = prevById.get(item.raffle.id)
    const nextEmpty = !item.entries?.length
    const prevHas = !!(prevItem?.entries?.length)
    if (nextEmpty && prevHas && prevItem) {
      return { raffle: item.raffle, entries: prevItem.entries }
    }
    return item
  })
}

/**
 * Partner featured strip: CSS transform marquee (duplicated row + translate -50%),
 * not scrollLeft — works consistently on mobile and desktop.
 * Pause: `animation-play-state: paused` while user interacts.
 */
export function PartnerRafflesCarousel({
  items,
  serverNow,
}: {
  items: Item[]
  serverNow?: Date
}) {
  const [displayItems, setDisplayItems] = useState<Item[]>(items)
  const itemsRef = useRef(items)
  const [marqueePaused, setMarqueePaused] = useState(false)
  const resumeAfterPointerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const itemsKey = useMemo(
    () =>
      items
        .map(({ raffle }) => raffle.id)
        .slice()
        .sort()
        .join(','),
    [items]
  )

  // Refresh raffle snapshots from props; preserve fetched entries when props still carry entries: [] (matches RafflesList).
  useEffect(() => {
    setDisplayItems((prev) => mergeCarouselProps(prev, items))
  }, [items])

  useEffect(() => {
    if (items.length === 0) return
    let cancelled = false

    const loadEntries = async () => {
      const batch = itemsRef.current
      if (batch.length === 0 || cancelled) return
      const apiBase = typeof window !== 'undefined' ? window.location.origin : ''

      type FetchOk = { id: string; entries: Entry[]; ok: true }
      type FetchFail = { id: string; ok: false }
      const results = await Promise.all(
        batch.map(async ({ raffle }): Promise<FetchOk | FetchFail> => {
          try {
            const url = `${apiBase}/api/entries?raffleId=${encodeURIComponent(raffle.id)}&t=${Date.now()}`
            const response = await fetch(url)
            if (!response.ok) return { id: raffle.id, ok: false }
            const data = await response.json()
            const entries = Array.isArray(data) ? (data as Entry[]) : []
            return { id: raffle.id, entries, ok: true }
          } catch {
            return { id: raffle.id, ok: false }
          }
        })
      )

      if (cancelled) return

      setDisplayItems((prev) => {
        const prevById = new Map(prev.map((x) => [x.raffle.id, x]))
        const mergedProps = mergeCarouselProps(prev, itemsRef.current)
        const mergedById = new Map(mergedProps.map((x) => [x.raffle.id, x]))
        for (const r of results) {
          if (r.ok) {
            const row = mergedById.get(r.id)
            if (row) mergedById.set(r.id, { raffle: row.raffle, entries: r.entries })
          }
        }
        return itemsRef.current.map(({ raffle }) => {
          const updated = mergedById.get(raffle.id)
          if (updated) return updated
          return { raffle, entries: prevById.get(raffle.id)?.entries ?? [] }
        })
      })
    }

    void loadEntries()
    const interval = setInterval(() => void loadEntries(), RAFFLES_LIST_ENTRIES_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [itemsKey, items.length])

  useEffect(() => {
    const onPurchase = (e: Event) => {
      const d = (e as CustomEvent<PurchaseCompletedDetail>).detail
      if (!d?.raffleIds?.length) return
      const idSet = new Set(d.raffleIds)
      const carouselIds = itemsRef.current.filter(({ raffle }) => idSet.has(raffle.id)).map((x) => x.raffle.id)
      if (carouselIds.length === 0) return
      void (async () => {
        const fetched = await fetchEntriesByRaffleIdsClient(carouselIds)
        if (fetched.size === 0) return
        setDisplayItems((prev) => {
          const prevById = new Map(prev.map((x) => [x.raffle.id, x]))
          const mergedProps = mergeCarouselProps(prev, itemsRef.current)
          const mergedById = new Map(mergedProps.map((x) => [x.raffle.id, x]))
          for (const id of carouselIds) {
            const entries = fetched.get(id)
            const row = mergedById.get(id)
            if (entries && row) mergedById.set(id, { raffle: row.raffle, entries })
          }
          return itemsRef.current.map(({ raffle }) => {
            const updated = mergedById.get(raffle.id)
            if (updated) return updated
            return { raffle, entries: prevById.get(raffle.id)?.entries ?? [] }
          })
        })
      })()
    }
    window.addEventListener(PURCHASE_COMPLETED_EVENT, onPurchase)
    return () => window.removeEventListener(PURCHASE_COMPLETED_EVENT, onPurchase)
  }, [])

  useEffect(() => {
    return () => {
      if (resumeAfterPointerRef.current) clearTimeout(resumeAfterPointerRef.current)
    }
  }, [])

  // New partner list / refresh: do not leave the strip stuck paused from a prior interaction.
  useEffect(() => {
    setMarqueePaused(false)
    if (resumeAfterPointerRef.current) {
      clearTimeout(resumeAfterPointerRef.current)
      resumeAfterPointerRef.current = null
    }
  }, [itemsKey])

  const loopItems = useMemo(() => {
    if (displayItems.length === 0) return []
    return [...displayItems, ...displayItems]
  }, [displayItems])

  const pauseMarquee = () => {
    setMarqueePaused(true)
    if (resumeAfterPointerRef.current) {
      clearTimeout(resumeAfterPointerRef.current)
      resumeAfterPointerRef.current = null
    }
  }

  const scheduleResume = () => {
    if (resumeAfterPointerRef.current) clearTimeout(resumeAfterPointerRef.current)
    resumeAfterPointerRef.current = setTimeout(() => {
      resumeAfterPointerRef.current = null
      setMarqueePaused(false)
    }, 3000)
  }

  const n = displayItems.length
  const durationSec = Math.max(20, n * 8)
  const logoDurationSec = Math.max(20, PARTNER_LOGOS.length * 6)

  if (items.length === 0) return null

  return (
    <section
      className="w-full min-w-0 mb-6 sm:mb-8"
      aria-labelledby="partner-raffles-carousel-heading"
    >
      <div className="mb-3 min-w-0 sm:mb-4">
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <Users className="h-5 w-5 shrink-0 text-violet-400" aria-hidden />
          <h2 id="partner-raffles-carousel-heading" className="truncate text-base font-bold sm:text-lg">
            Partner Spotlight
          </h2>
        </div>
        <div
          className="partner-logos-marquee-outer w-full min-w-0 max-w-full overflow-x-hidden pb-1"
          style={{ touchAction: 'manipulation' as const }}
          onPointerDown={pauseMarquee}
          onPointerUp={scheduleResume}
          onPointerCancel={scheduleResume}
          role="region"
          aria-label="Partner logos, auto-scrolling. Tap to pause."
        >
          <div
            className="partner-logos-marquee-track flex w-max flex-nowrap items-center gap-2.5 sm:gap-3"
            dir="ltr"
            style={
              {
                animationPlayState: marqueePaused ? 'paused' : 'running',
                '--partner-logos-marquee-duration': `${logoDurationSec}s`,
              } as CSSProperties
            }
          >
            {[...PARTNER_LOGOS, ...PARTNER_LOGOS].map((logo, idx) => (
              <div
                key={`${logo.src}-${idx}`}
                className="flex h-[78px] w-[126px] shrink-0 items-center justify-center overflow-hidden rounded-xl sm:h-[92px] sm:w-[152px]"
              >
                <Image
                  src={logo.src}
                  alt={logo.alt}
                  width={140}
                  height={84}
                  className="h-full w-full rounded-xl object-contain"
                />
              </div>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted-foreground sm:text-base">
          <Link
            href="/partner-program"
            className="font-medium text-foreground/90 underline-offset-4 hover:underline touch-manipulation min-h-[44px] inline-flex items-center"
          >
            About the program
          </Link>
        </p>
      </div>
      <div
        className="partner-raffles-marquee-outer w-full min-w-0 max-w-full overflow-x-hidden overflow-y-visible pt-4 pb-8 -mx-1 px-3 sm:pt-6 sm:pb-10 sm:px-5"
        style={{ touchAction: 'manipulation' as const }}
        onPointerDown={pauseMarquee}
        onPointerUp={scheduleResume}
        onPointerCancel={scheduleResume}
        role="region"
        aria-label="Featured partner raffles, auto-scrolling. Tap to pause."
      >
        <div
          className="partner-raffles-marquee-track gap-4 sm:gap-5"
          dir="ltr"
          style={
            {
              animationPlayState: marqueePaused ? 'paused' : 'running',
              '--partner-marquee-duration': `${durationSec}s`,
            } as CSSProperties
          }
        >
          {loopItems.map(({ raffle, entries }, i) => (
            <div
              key={`${raffle.id}-${i}`}
              className="flex min-h-0 w-[calc(100vw-1.5rem)] max-w-[26rem] shrink-0 self-stretch min-w-0 sm:w-[23rem] md:w-[25rem] lg:w-[26rem]"
            >
              <div className="flex h-full min-h-0 w-full flex-1 flex-col">
                <RaffleCard
                  raffle={raffle}
                  entries={entries}
                  size="small"
                  section="active"
                  serverNow={serverNow}
                  priority={i === 0}
                  isPartnerCommunity
                  partnerFeaturedStrip
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

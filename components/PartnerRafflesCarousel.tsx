'use client'

import Link from 'next/link'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { Raffle, Entry } from '@/lib/types'
import { RaffleCard } from '@/components/RaffleCard'
import { Users } from 'lucide-react'
import { RAFFLES_LIST_ENTRIES_POLL_MS } from '@/lib/dev-budget'
import {
  PURCHASE_COMPLETED_EVENT,
  type PurchaseCompletedDetail,
} from '@/lib/cart/purchase-complete-events'
import { fetchEntriesByRaffleIdsClient } from '@/lib/raffles/fetch-entries-bulk-client'
import { getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'

type Item = { raffle: Raffle; entries: Entry[] }

/** Spotlight strip: quick thumb from raffle row data (matches RaffleCard primary image logic without mint fetch). */
function partnerSpotlightThumbSrc(raffle: Raffle): string {
  const fromDb = getRaffleDisplayImageUrl(raffle.image_url)
  const prizeCurrency = (raffle.prize_currency || '').trim().toUpperCase()
  const isLegacyOwltopiaPlaceholder =
    typeof raffle.image_url === 'string' &&
    (/\/logo\.gif$/i.test(raffle.image_url.trim()) || /\/icon\.png$/i.test(raffle.image_url.trim()))
  const cryptoCurrencyArt =
    (raffle.prize_type === 'crypto' || raffle.prize_type == null) &&
    (prizeCurrency === 'SOL' || prizeCurrency === 'USDC')
      ? prizeCurrency === 'SOL'
        ? '/solana-mark.svg'
        : '/usdc.png'
      : null
  if (cryptoCurrencyArt && (!fromDb || isLegacyOwltopiaPlaceholder)) return cryptoCurrencyArt
  return fromDb || ''
}

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
  const [partnerMarqueeLoop, setPartnerMarqueeLoop] = useState(false)
  const partnerMarqueeOuterRef = useRef<HTMLDivElement>(null)
  const partnerMarqueeTrackRef = useRef<HTMLDivElement>(null)
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

  useLayoutEffect(() => {
    const outer = partnerMarqueeOuterRef.current
    const track = partnerMarqueeTrackRef.current
    const len = displayItems.length
    if (!outer || !track || len === 0) {
      setPartnerMarqueeLoop(false)
      return
    }
    if (len === 1) {
      setPartnerMarqueeLoop(false)
      return
    }

    const decide = () => {
      const n = displayItems.length
      if (n <= 1) {
        setPartnerMarqueeLoop(false)
        return
      }
      setPartnerMarqueeLoop((prevLoop) => {
        const singleW = prevLoop ? track.scrollWidth / 2 : track.scrollWidth
        return singleW > outer.clientWidth + 1
      })
    }

    decide()
    const ro = new ResizeObserver(decide)
    ro.observe(outer)
    ro.observe(track)
    return () => ro.disconnect()
  }, [itemsKey, displayItems.length])

  const loopItems = useMemo(() => {
    if (displayItems.length === 0) return []
    if (displayItems.length === 1 || !partnerMarqueeLoop) return displayItems
    return [...displayItems, ...displayItems]
  }, [displayItems, partnerMarqueeLoop])

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
  const durationSec = Math.max(24, n * 10)

  if (items.length === 0) return null

  return (
    <section
      className="w-full min-w-0 mb-6 sm:mb-8"
      aria-labelledby="partner-raffles-carousel-heading"
    >
      <div className="mb-4 min-w-0 sm:mb-5">
        <div className="mb-3 flex min-w-0 items-center gap-2">
          <Users className="h-5 w-5 shrink-0 text-violet-400" aria-hidden />
          <h2 id="partner-raffles-carousel-heading" className="truncate text-base font-bold sm:text-lg">
            Partner Spotlight
          </h2>
        </div>
        <div
          className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]"
          style={{ touchAction: 'manipulation' as const }}
          role="list"
          aria-label="Featured prize thumbnails from partner raffles"
        >
          {displayItems.map(({ raffle }) => {
            const src = partnerSpotlightThumbSrc(raffle)
            const label = raffle.title?.trim() || 'Raffle'
            return (
              <Link
                key={raffle.id}
                href={`/raffles/${raffle.slug}`}
                className="group relative shrink-0 snap-start touch-manipulation [-webkit-tap-highlight-color:transparent]"
                role="listitem"
                title={label}
              >
                <div className="relative h-[4.25rem] w-[4.25rem] overflow-hidden rounded-xl border border-white/10 bg-muted ring-1 ring-white/5 transition-transform duration-200 group-active:scale-[0.98] sm:h-[4.75rem] sm:w-[4.75rem]">
                  {src ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- IPFS/proxy URLs */
                    <img
                      src={src}
                      alt=""
                      className={`h-full w-full ${src === '/solana-mark.svg' || src === '/usdc.png' ? 'object-contain p-2' : 'object-cover object-center'}`}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-muted px-1 text-center text-[9px] text-muted-foreground">
                      NFT
                    </div>
                  )}
                </div>
              </Link>
            )
          })}
        </div>

        <div className="mt-5 border-t border-border/60 pt-4">
          <h3 className="text-base font-bold text-foreground sm:text-lg">About the program</h3>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Verified partner community hosts are highlighted here with a reduced platform fee on tickets.{' '}
            <Link
              href="/partner-program"
              className="font-semibold text-foreground/90 underline-offset-4 hover:underline touch-manipulation"
            >
              Partner program details
            </Link>
          </p>
        </div>
      </div>
      <div
        ref={partnerMarqueeOuterRef}
        className={`partner-raffles-marquee-outer w-full min-w-0 max-w-full overflow-x-hidden overflow-y-visible pt-2 pb-8 -mx-1 px-3 sm:pb-10 sm:px-5 ${!partnerMarqueeLoop ? 'flex justify-center' : ''}`}
        style={{ touchAction: 'manipulation' as const }}
        onPointerDown={pauseMarquee}
        onPointerUp={scheduleResume}
        onPointerCancel={scheduleResume}
        role="region"
        aria-label="Featured partner raffles, auto-scrolling. Tap to pause."
      >
        <div
          ref={partnerMarqueeTrackRef}
          className="partner-raffles-marquee-track gap-4 sm:gap-5"
          dir="ltr"
          style={
            {
              animationPlayState: marqueePaused ? 'paused' : 'running',
              animation: partnerMarqueeLoop ? undefined : 'none',
              '--partner-marquee-duration': `${durationSec}s`,
            } as CSSProperties
          }
        >
          {loopItems.map(({ raffle, entries }, i) => (
            <div
              key={`${raffle.id}-${i}`}
              className="flex min-h-0 w-[calc(100vw-2rem)] max-w-[min(92vw,36rem)] shrink-0 self-stretch min-w-0 sm:max-w-[34rem]"
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

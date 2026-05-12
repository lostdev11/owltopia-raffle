'use client'

import Link from 'next/link'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Raffle, Entry } from '@/lib/types'
import { RaffleCard } from '@/components/RaffleCard'
import { Users } from 'lucide-react'
import { RAFFLES_LIST_ENTRIES_POLL_MS } from '@/lib/dev-budget'
import {
  PURCHASE_COMPLETED_EVENT,
  type PurchaseCompletedDetail,
} from '@/lib/cart/purchase-complete-events'
import { fetchEntriesByRaffleIdsClient } from '@/lib/raffles/fetch-entries-bulk-client'
import {
  getPartnerSpotlightLogo,
  PARTNER_SPOTLIGHT_BRANDS,
  partnerSpotlightImageCandidates,
  type PartnerLogo,
} from '@/lib/partner-logos'

type Item = { raffle: Raffle; entries: Entry[] }

/** Horizontal speed for Partner Spotlight without rendering duplicate logos. */
const SPOTLIGHT_MARQUEE_PX_PER_SEC = 28

/** One row per partner host — used to link each brand logo to a live raffle when possible. */
function spotlightStripDedupeKey(r: Raffle): string {
  const w = (r.creator_wallet || r.created_by || '').trim()
  return w || `raffle:${r.id}`
}

function dedupeSpotlightStripItems(items: Item[]): Item[] {
  const seen = new Set<string>()
  const out: Item[] = []
  for (const item of items) {
    const key = spotlightStripDedupeKey(item.raffle)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function PartnerSpotlightLogoImg({ logo }: { logo: PartnerLogo }) {
  const candidates = useMemo(() => partnerSpotlightImageCandidates(logo.src), [logo.src])
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    setIdx(0)
  }, [logo.src])
  const src = candidates[Math.min(idx, candidates.length - 1)] ?? logo.src
  const hideAlt = src.endsWith('partner-slot-placeholder.svg')

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- static /public + multi-extension fallbacks */
    <img
      src={src}
      alt={hideAlt ? '' : logo.alt}
      className="h-full w-full object-contain"
      loading="lazy"
      decoding="async"
      onError={() => setIdx((i) => (i + 1 < candidates.length ? i + 1 : i))}
    />
  )
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

  const [spotlightMarqueePaused, setSpotlightMarqueePaused] = useState(false)
  const spotlightResumeAfterPointerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spotlightOuterRef = useRef<HTMLDivElement>(null)
  const spotlightTrackRef = useRef<HTMLDivElement>(null)
  const spotlightPosRef = useRef(0)
  const spotlightDirRef = useRef(1)
  const spotlightRafRef = useRef(0)
  const [spotlightShouldMarquee, setSpotlightShouldMarquee] = useState(false)

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
      if (spotlightResumeAfterPointerRef.current) clearTimeout(spotlightResumeAfterPointerRef.current)
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

  const spotlightHrefPool = useMemo(() => dedupeSpotlightStripItems(displayItems), [displayItems])

  const spotlightMarqueeRows = useMemo(() => {
    return PARTNER_SPOTLIGHT_BRANDS.map((logo) => {
      const match = spotlightHrefPool.find((item) => {
        const resolved = getPartnerSpotlightLogo(item.raffle)
        return resolved?.src === logo.src
      })
      const href = match ? `/raffles/${match.raffle.slug}` : '/partner-program'
      const title = match
        ? match.raffle.creator_partner_display_name?.trim() ||
          match.raffle.title?.trim() ||
          'Partner raffle'
        : `${logo.alt} - Partner program`
      return { logo, href, title }
    })
  }, [spotlightHrefPool])

  const spotlightStripKey = useMemo(
    () =>
      `${spotlightHrefPool.map(({ raffle }) => raffle.id).join(',')}|${spotlightMarqueeRows.map((r) => r.href).join('|')}`,
    [spotlightHrefPool, spotlightMarqueeRows]
  )

  useEffect(() => {
    setSpotlightMarqueePaused(false)
    if (spotlightResumeAfterPointerRef.current) {
      clearTimeout(spotlightResumeAfterPointerRef.current)
      spotlightResumeAfterPointerRef.current = null
    }
  }, [spotlightStripKey])

  useLayoutEffect(() => {
    const outer = spotlightOuterRef.current
    const track = spotlightTrackRef.current
    if (!outer || !track || spotlightMarqueeRows.length <= 1) {
      setSpotlightShouldMarquee(false)
      spotlightPosRef.current = 0
      spotlightDirRef.current = 1
      if (track) track.style.transform = ''
      return
    }

    const decide = () => {
      const travel = Math.abs(track.scrollWidth - outer.clientWidth)
      const canMarquee = travel > 1
      setSpotlightShouldMarquee(canMarquee)
      if (!canMarquee) {
        spotlightPosRef.current = 0
        spotlightDirRef.current = 1
        track.style.transform = ''
      }
    }

    decide()
    const ro = new ResizeObserver(decide)
    ro.observe(outer)
    ro.observe(track)
    return () => ro.disconnect()
  }, [spotlightStripKey, spotlightMarqueeRows.length])

  useEffect(() => {
    if (!spotlightShouldMarquee || spotlightMarqueePaused) return
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const outer = spotlightOuterRef.current
    const track = spotlightTrackRef.current
    if (!outer || !track) return

    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.064)
      last = now
      const rowOverflows = track.scrollWidth > outer.clientWidth
      const maxOffset = Math.abs(track.scrollWidth - outer.clientWidth)
      if (maxOffset <= 1) {
        spotlightPosRef.current = 0
        track.style.transform = ''
        return
      }

      spotlightPosRef.current += spotlightDirRef.current * SPOTLIGHT_MARQUEE_PX_PER_SEC * dt
      if (spotlightPosRef.current >= maxOffset) {
        spotlightPosRef.current = maxOffset
        spotlightDirRef.current = -1
      } else if (spotlightPosRef.current <= 0) {
        spotlightPosRef.current = 0
        spotlightDirRef.current = 1
      }

      const x = rowOverflows ? -spotlightPosRef.current : spotlightPosRef.current
      track.style.transform = `translate3d(${x}px,0,0)`
      spotlightRafRef.current = requestAnimationFrame(step)
    }

    spotlightRafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(spotlightRafRef.current)
  }, [spotlightShouldMarquee, spotlightMarqueePaused, spotlightStripKey])

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

  const pauseSpotlightMarquee = () => {
    setSpotlightMarqueePaused(true)
    if (spotlightResumeAfterPointerRef.current) {
      clearTimeout(spotlightResumeAfterPointerRef.current)
      spotlightResumeAfterPointerRef.current = null
    }
  }

  const scheduleSpotlightResume = () => {
    if (spotlightResumeAfterPointerRef.current) clearTimeout(spotlightResumeAfterPointerRef.current)
    spotlightResumeAfterPointerRef.current = setTimeout(() => {
      spotlightResumeAfterPointerRef.current = null
      setSpotlightMarqueePaused(false)
    }, 3000)
  }

  const n = displayItems.length
  const durationSec = Math.max(24, n * 10)

  if (items.length === 0) return null

  const renderSpotlightLogos = () =>
    spotlightMarqueeRows.map(({ logo, href, title }, i) => (
      <Link
        key={`${logo.src}-${i}`}
        href={href}
        className="group relative shrink-0 touch-manipulation [-webkit-tap-highlight-color:transparent]"
        title={title}
      >
        <div className="relative h-[4.25rem] w-[4.25rem] overflow-hidden rounded-xl border border-white/10 bg-muted ring-1 ring-white/5 transition-transform duration-200 group-active:scale-[0.98] sm:h-[4.75rem] sm:w-[4.75rem]">
          <PartnerSpotlightLogoImg logo={logo} />
        </div>
      </Link>
    ))

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
        {spotlightMarqueeRows.length > 0 ? (
          <div
            ref={spotlightOuterRef}
            className={`partner-logos-marquee-outer -mx-1 px-1 pb-2 ${!spotlightShouldMarquee ? 'flex justify-center' : ''}`}
            style={{ touchAction: 'manipulation' as const }}
            onPointerDown={pauseSpotlightMarquee}
            onPointerUp={scheduleSpotlightResume}
            onPointerCancel={scheduleSpotlightResume}
            role="region"
            aria-label="Partner logos, auto-scrolling. Tap to pause."
          >
            <div
              ref={spotlightTrackRef}
              className={`flex w-max flex-nowrap items-center gap-3 sm:gap-4 ${spotlightShouldMarquee ? 'will-change-transform' : ''}`}
              dir="ltr"
            >
              {renderSpotlightLogos()}
            </div>
          </div>
        ) : null}

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

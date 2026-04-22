'use client'

import Link from 'next/link'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Raffle, Entry } from '@/lib/types'
import { RaffleCard } from '@/components/RaffleCard'
import { Users } from 'lucide-react'
import { RAFFLES_LIST_ENTRIES_POLL_MS } from '@/lib/dev-budget'

/** Pixels advanced per animation frame (~0.55 → ~33px/s at 60fps). */
const PARTNER_CAROUSEL_AUTO_SCROLL_PX_PER_FRAME = 0.55

function subscribeReducedMotion(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mq.addEventListener('change', onStoreChange)
  return () => mq.removeEventListener('change', onStoreChange)
}

function getReducedMotionSnapshot() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function getReducedMotionServerSnapshot() {
  return false
}

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
 * Featured partner raffles strip on /raffles (All tab): horizontal scroll with seamless
 * auto-advance loop. Respects prefers-reduced-motion; pauses on hover (mouse) or touch.
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
  itemsRef.current = items
  const stripRef = useRef<HTMLDivElement>(null)
  const pauseAutoRef = useRef(false)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot
  )

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
    return () => {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    }
  }, [])

  /** Duplicate slides so we can reset scroll in the middle for a seamless loop. */
  const loopItems = useMemo(() => {
    if (displayItems.length === 0) return []
    return [...displayItems, ...displayItems]
  }, [displayItems])

  useLayoutEffect(() => {
    if (prefersReducedMotion || displayItems.length === 0) return

    let raf = 0
    let cancelled = false

    const tick = () => {
      if (cancelled) return
      const strip = stripRef.current
      if (!strip || pauseAutoRef.current) {
        raf = requestAnimationFrame(tick)
        return
      }

      strip.scrollLeft += PARTNER_CAROUSEL_AUTO_SCROLL_PX_PER_FRAME

      const half = strip.scrollWidth / 2
      if (half > 0 && strip.scrollLeft >= half - 0.5) {
        strip.scrollLeft -= half
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [prefersReducedMotion, displayItems.length, itemsKey])

  const scheduleResumeAfterInteraction = () => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => {
      resumeTimerRef.current = null
      pauseAutoRef.current = false
    }, 3500)
  }

  if (items.length === 0) return null

  return (
    <section
      className="w-full min-w-0 mb-6 sm:mb-8"
      aria-labelledby="partner-raffles-carousel-heading"
    >
      <div className="mb-3 min-w-0 sm:mb-4">
        <div className="mb-1 flex min-w-0 items-center gap-2">
          <Users className="h-5 w-5 shrink-0 text-violet-400" aria-hidden />
          <h2 id="partner-raffles-carousel-heading" className="truncate text-lg font-bold sm:text-xl">
            Owltopia Partner Program
          </h2>
        </div>
        <p className="text-sm text-muted-foreground sm:text-base">
          Featured partner raffles (2% platform fee on tickets) · auto-scrolls · tap or drag to pause ·{' '}
          <Link
            href="/partner-program"
            className="font-medium text-foreground/90 underline-offset-4 hover:underline touch-manipulation min-h-[44px] inline-flex items-center"
          >
            About the program
          </Link>
        </p>
      </div>
      {/* Scroll viewport must not be the flex row: inner `w-max` flex track forces scrollWidth > clientWidth so scrollLeft works reliably. */}
      <div className="w-full min-w-0 max-w-full">
        <div
          ref={stripRef}
          dir="ltr"
          className="w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain pt-4 pb-8 scroll-pl-3 scroll-pr-3 -mx-1 px-3 sm:pt-6 sm:pb-10 sm:scroll-pl-5 sm:scroll-pr-5 sm:px-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            touchAction: 'pan-x manipulation',
            WebkitOverflowScrolling: 'touch',
            scrollBehavior: 'auto',
          }}
          aria-label="Featured partner raffles carousel"
          onPointerDown={() => {
            pauseAutoRef.current = true
            if (resumeTimerRef.current) {
              clearTimeout(resumeTimerRef.current)
              resumeTimerRef.current = null
            }
          }}
          onPointerUp={() => {
            scheduleResumeAfterInteraction()
          }}
        >
          <div className="flex w-max min-w-0 flex-nowrap items-stretch gap-4 sm:gap-5">
            {loopItems.map(({ raffle, entries }, i) => (
              <div
                key={`${raffle.id}-${i}`}
                className="flex min-h-0 w-[calc(100vw-1.5rem)] max-w-[26rem] shrink-0 self-stretch min-w-0 sm:w-[23rem] md:w-[25rem] lg:w-[26rem]"
              >
                {/* self-stretch + h-full chain: all slides match tallest row (avoid h-full on slide — breaks with auto-height scroller) */}
                <div className="flex h-full min-h-0 w-full flex-1 flex-col">
                  <RaffleCard
                    raffle={raffle}
                    entries={entries}
                    size="small"
                    section="active"
                    serverNow={serverNow}
                    priority={i === 0}
                    isPartnerCommunity
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

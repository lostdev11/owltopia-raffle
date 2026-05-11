'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CommunityGiveawayBrowseCard,
  type CommunityGiveawayBrowseItem,
} from '@/components/CommunityGiveawayBrowseCard'
import { cn } from '@/lib/utils'

type Props = {
  /** Stable id for aria-labelledby */
  sectionId: string
  title: string
  description?: string
  items: CommunityGiveawayBrowseItem[]
  /** Only one section on the page should pass true so LCP stays sane */
  eagerFirstImage?: boolean
}

/** Match giveaway card visual weight: ~square hero, similar width to 3-col grid tiles */
const CARD_WRAP =
  'w-[min(88vw,18rem)] shrink-0 sm:w-[min(46vw,19rem)] lg:w-72 xl:w-[19rem]'

const MAX_SPEED_PX_PER_FRAME = 0.52
const SPEED_LERP = 0.085

function flexGapPx(parent: HTMLElement | null): number {
  if (!parent) return 16
  const g = getComputedStyle(parent).gap || getComputedStyle(parent).columnGap || '16px'
  const n = parseFloat(g)
  return Number.isFinite(n) ? n : 16
}

/**
 * Horizontal carousel: when the card strip is wider than the viewport, a second copy
 * of the strip enables a seamless translate marquee. When everything fits, only one
 * strip is rendered so cards are not duplicated side-by-side.
 */
export function GiveawayBrowseCarouselSection({
  sectionId,
  title,
  description,
  items,
  eagerFirstImage = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const firstStripRef = useRef<HTMLDivElement>(null)
  const mouseInsideRef = useRef(false)
  const interactionHoldRef = useRef(false)
  const pauseUntilRef = useRef(0)
  const currentSpeedRef = useRef(0)
  const offsetRef = useRef(0)
  const rafIdRef = useRef(0)

  const [stripOverflows, setStripOverflows] = useState(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const [manualScrollMode, setManualScrollMode] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(mq.matches)
    const onChange = () => setPrefersReducedMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useLayoutEffect(() => {
    const container = containerRef.current
    const strip = firstStripRef.current
    if (!container || !strip || items.length === 0) {
      setStripOverflows(false)
      return
    }
    const measure = () => {
      const cw = container.clientWidth
      const sw = strip.scrollWidth
      setStripOverflows(sw > cw + 2)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    ro.observe(strip)
    return () => ro.disconnect()
  }, [items])

  const marqueeActive = stripOverflows && !prefersReducedMotion && !manualScrollMode

  useLayoutEffect(() => {
    if (marqueeActive) return
    offsetRef.current = 0
    const track = trackRef.current
    if (track) track.style.transform = ''
  }, [marqueeActive])

  const bumpManualPause = useCallback(() => {
    pauseUntilRef.current = Date.now() + 9000
    currentSpeedRef.current = 0
  }, [])

  const handleContainerScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      bumpManualPause()
      if (Math.abs(e.currentTarget.scrollLeft) > 1) {
        setManualScrollMode(true)
      }
    },
    [bumpManualPause]
  )

  const handleContainerWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      bumpManualPause()
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setManualScrollMode(true)
      }
    },
    [bumpManualPause]
  )

  /** Any vertical scroll or wheel: user is moving the page — stop marquee immediately (can resume after pause window). */
  useEffect(() => {
    if (items.length === 0) return
    let lastScrollY = typeof window !== 'undefined' ? window.scrollY : 0
    const onScroll = () => {
      const y = window.scrollY
      if (Math.abs(y - lastScrollY) >= 1) {
        lastScrollY = y
        bumpManualPause()
      }
    }
    const onWheel = () => bumpManualPause()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('wheel', onWheel)
    }
  }, [items.length, bumpManualPause])

  useEffect(() => {
    if (items.length === 0 || !marqueeActive) return

    const tick = () => {
      const track = trackRef.current
      const strip = firstStripRef.current
      if (!track || !strip) {
        rafIdRef.current = requestAnimationFrame(tick)
        return
      }

      let desired = MAX_SPEED_PX_PER_FRAME
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') desired = 0
      else if (mouseInsideRef.current) desired = 0
      else if (interactionHoldRef.current) desired = 0
      else if (Date.now() < pauseUntilRef.current) desired = 0

      const userInterrupted =
        interactionHoldRef.current || (typeof document !== 'undefined' && Date.now() < pauseUntilRef.current)

      if (userInterrupted) {
        currentSpeedRef.current = 0
      } else {
        currentSpeedRef.current += (desired - currentSpeedRef.current) * SPEED_LERP
      }

      const loopPoint = strip.offsetWidth + flexGapPx(track)
      if (loopPoint > 8 && currentSpeedRef.current > 0.0001) {
        offsetRef.current += currentSpeedRef.current
        while (offsetRef.current >= loopPoint) {
          offsetRef.current -= loopPoint
        }
      }

      track.style.transform = `translate3d(${-offsetRef.current}px,0,0)`

      rafIdRef.current = requestAnimationFrame(tick)
    }

    rafIdRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafIdRef.current)
  }, [items, marqueeActive])

  const releaseHoldSoon = useCallback(() => {
    window.setTimeout(() => {
      interactionHoldRef.current = false
    }, 350)
  }, [])

  if (items.length === 0) return null

  const headingId = `${sectionId}-heading`

  const renderCards = (dup: boolean) =>
    items.map((g, i) => (
      <div key={dup ? `${g.id}-dup` : g.id} className={CARD_WRAP} role={dup ? undefined : 'listitem'}>
        <CommunityGiveawayBrowseCard
          g={g}
          priorityImage={!dup && Boolean(eagerFirstImage && i === 0)}
        />
      </div>
    ))

  return (
    <section className="space-y-4" aria-labelledby={headingId}>
      <div className="max-w-3xl space-y-1 pr-2">
        <h3 id={headingId} className="text-lg font-semibold tracking-tight">
          {title}
        </h3>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>

      <div
        ref={containerRef}
        className={cn(
          'relative w-full min-w-0 pl-[max(0px,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]',
          stripOverflows
            ? 'overflow-x-auto overflow-y-hidden overscroll-x-contain touch-manipulation [-webkit-overflow-scrolling:touch]'
            : 'overflow-hidden'
        )}
        tabIndex={0}
        role="region"
        aria-label={
          stripOverflows && (prefersReducedMotion || manualScrollMode)
            ? `${title}: scroll horizontally to see all giveaways`
            : `${title}: auto-scrolling giveaways; swipe or scroll horizontally to take manual control`
        }
        onMouseEnter={() => {
          mouseInsideRef.current = true
        }}
        onMouseLeave={() => {
          mouseInsideRef.current = false
        }}
        onPointerDownCapture={() => {
          interactionHoldRef.current = true
          currentSpeedRef.current = 0
        }}
        onPointerUpCapture={releaseHoldSoon}
        onPointerCancelCapture={releaseHoldSoon}
        onScroll={handleContainerScroll}
        onWheel={handleContainerWheel}
      >
        <div
          ref={trackRef}
          className={cn(
            'flex w-max max-w-none flex-nowrap gap-4 sm:gap-5',
            marqueeActive && 'will-change-transform'
          )}
        >
          <div ref={firstStripRef} role="list" className="flex flex-nowrap gap-4 sm:gap-5">
            {renderCards(false)}
          </div>
          {marqueeActive ? (
            <div className="flex flex-nowrap gap-4 sm:gap-5" aria-hidden>
              {renderCards(true)}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

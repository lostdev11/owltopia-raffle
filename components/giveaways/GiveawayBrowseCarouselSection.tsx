'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  CommunityGiveawayBrowseCard,
  type CommunityGiveawayBrowseItem,
} from '@/components/CommunityGiveawayBrowseCard'

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
 * Duplicated strip + translate3d marquee (works when all cards fit on wide screens).
 */
export function GiveawayBrowseCarouselSection({
  sectionId,
  title,
  description,
  items,
  eagerFirstImage = false,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const firstStripRef = useRef<HTMLDivElement>(null)
  const mouseInsideRef = useRef(false)
  const interactionHoldRef = useRef(false)
  const pauseUntilRef = useRef(0)
  const reducedMotionRef = useRef(false)
  const currentSpeedRef = useRef(0)
  const offsetRef = useRef(0)
  const rafIdRef = useRef(0)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotionRef.current = mq.matches
    const onChange = () => {
      reducedMotionRef.current = mq.matches
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const bumpManualPause = useCallback(() => {
    pauseUntilRef.current = Date.now() + 9000
  }, [])

  useEffect(() => {
    if (items.length === 0) return

    const tick = () => {
      const track = trackRef.current
      const strip = firstStripRef.current
      if (!track || !strip) {
        rafIdRef.current = requestAnimationFrame(tick)
        return
      }

      let desired = MAX_SPEED_PX_PER_FRAME
      if (reducedMotionRef.current) desired = 0
      else if (typeof document !== 'undefined' && document.visibilityState !== 'visible') desired = 0
      else if (mouseInsideRef.current) desired = 0
      else if (interactionHoldRef.current) desired = 0
      else if (Date.now() < pauseUntilRef.current) desired = 0

      currentSpeedRef.current += (desired - currentSpeedRef.current) * SPEED_LERP

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
  }, [items])

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
        className="relative w-full min-w-0 overflow-hidden pl-[max(0px,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
        tabIndex={0}
        role="region"
        aria-label={`${title}: swipe or scroll horizontally; pauses on hover`}
        onMouseEnter={() => {
          mouseInsideRef.current = true
        }}
        onMouseLeave={() => {
          mouseInsideRef.current = false
        }}
        onPointerDownCapture={() => {
          interactionHoldRef.current = true
        }}
        onPointerUpCapture={releaseHoldSoon}
        onPointerCancelCapture={releaseHoldSoon}
        onWheel={bumpManualPause}
      >
        <div
          ref={trackRef}
          className="flex w-max max-w-none flex-nowrap gap-4 sm:gap-5 will-change-transform"
        >
          <div ref={firstStripRef} role="list" className="flex flex-nowrap gap-4 sm:gap-5">
            {renderCards(false)}
          </div>
          <div className="flex flex-nowrap gap-4 sm:gap-5" aria-hidden>
            {renderCards(true)}
          </div>
        </div>
      </div>
    </section>
  )
}

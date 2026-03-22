'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const SWIPE_COMMIT_PX = 56
const HORIZONTAL_LOCK_PX = 14
const VERTICAL_CANCEL_PX = 18
const SUPPRESS_CLICK_MS = 450

function clampIndex(i: number, total: number) {
  if (total <= 0) return 0
  if (i < 0) return total - 1
  if (i >= total) return 0
  return i
}

/** Passed when rendering each visible slot (single / dual / triple row). */
export interface RafflesSwipeDeckRenderOptions {
  fillDeckWidth: boolean
  /** Center / highlighted raffle in the row */
  isFocused: boolean
}

export interface RafflesSwipeDeckProps<T> {
  items: T[]
  getKey: (item: T) => string
  renderItem: (
    item: T,
    index: number,
    options: RafflesSwipeDeckRenderOptions
  ) => React.ReactNode
  /** Accessible name for the carousel region */
  ariaLabel: string
  /** Optional subtitle, e.g. "3 of 12" or custom heading */
  counterLabel?: ReactNode
  /** Auto-advance interval in ms; omit or 0 to disable */
  autoAdvanceMs?: number
  className?: string
}

export function RafflesSwipeDeck<T>({
  items,
  getKey,
  renderItem,
  ariaLabel,
  counterLabel,
  autoAdvanceMs = 0,
  className = '',
}: RafflesSwipeDeckProps<T>) {
  const list = items ?? []
  const total = list.length
  const [index, setIndex] = useState(0)
  const [dragPx, setDragPx] = useState(0)
  const [reduceMotion, setReduceMotion] = useState(false)
  const suppressClickUntilRef = useRef(0)
  const totalRef = useRef(total)
  const trackRef = useRef<HTMLDivElement>(null)
  /** Latest horizontal drag offset (native listeners read this; state is for paint). */
  const dragRef = useRef(0)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduceMotion(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    totalRef.current = total
    setIndex((prev) => clampIndex(prev, total))
  }, [total])

  const idsKey = useMemo(
    () => list.map((item) => getKey(item)).join('\0'),
    [list, getKey]
  )

  useEffect(() => {
    setIndex((prev) => clampIndex(prev, total))
  }, [idsKey, total])

  const goPrev = useCallback(() => {
    suppressClickUntilRef.current = Date.now() + SUPPRESS_CLICK_MS
    dragRef.current = 0
    setIndex((prev) => clampIndex(prev - 1, totalRef.current))
    setDragPx(0)
  }, [])

  const goNext = useCallback(() => {
    suppressClickUntilRef.current = Date.now() + SUPPRESS_CLICK_MS
    dragRef.current = 0
    setIndex((prev) => clampIndex(prev + 1, totalRef.current))
    setDragPx(0)
  }, [])

  useEffect(() => {
    if (autoAdvanceMs <= 0 || total <= 1) return
    const id = window.setInterval(() => {
      setIndex((prev) => clampIndex(prev + 1, totalRef.current))
    }, autoAdvanceMs)
    return () => window.clearInterval(id)
  }, [autoAdvanceMs, total])

  useEffect(() => {
    const el = trackRef.current
    if (!el || total <= 1) return

    let startX = 0
    let startY = 0
    let mode: 'undecided' | 'horizontal' | 'vertical' = 'undecided'

    const touchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      mode = 'undecided'
    }

    const touchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const x = e.touches[0].clientX
      const y = e.touches[0].clientY
      const dx = x - startX
      const dy = y - startY

      if (mode === 'undecided') {
        if (
          Math.abs(dx) >= HORIZONTAL_LOCK_PX &&
          Math.abs(dx) > Math.abs(dy)
        ) {
          mode = 'horizontal'
        } else if (
          Math.abs(dy) >= VERTICAL_CANCEL_PX &&
          Math.abs(dy) > Math.abs(dx)
        ) {
          mode = 'vertical'
          return
        } else {
          return
        }
      }

      if (mode === 'horizontal') {
        e.preventDefault()
        dragRef.current = dx
        setDragPx(dx)
      }
    }

    const touchEnd = (e: TouchEvent) => {
      if (mode === 'horizontal') {
        const dx = dragRef.current
        dragRef.current = 0
        setDragPx(0)
        if (dx <= -SWIPE_COMMIT_PX) {
          e.preventDefault()
          suppressClickUntilRef.current = Date.now() + SUPPRESS_CLICK_MS
          goNext()
        } else if (dx >= SWIPE_COMMIT_PX) {
          e.preventDefault()
          suppressClickUntilRef.current = Date.now() + SUPPRESS_CLICK_MS
          goPrev()
        }
      }
      mode = 'undecided'
    }

    el.addEventListener('touchstart', touchStart, { passive: true })
    el.addEventListener('touchmove', touchMove, { passive: false })
    el.addEventListener('touchend', touchEnd, { passive: false })
    el.addEventListener('touchcancel', touchEnd, { passive: false })

    return () => {
      el.removeEventListener('touchstart', touchStart)
      el.removeEventListener('touchmove', touchMove)
      el.removeEventListener('touchend', touchEnd)
      el.removeEventListener('touchcancel', touchEnd)
    }
  }, [total, goNext, goPrev])

  const pointerIdRef = useRef<number | null>(null)
  const pointerStartRef = useRef({ x: 0, y: 0 })
  const pointerModeRef = useRef<'undecided' | 'horizontal' | 'vertical'>(
    'undecided'
  )

  const onPointerDown = (e: React.PointerEvent) => {
    if (total <= 1) return
    if (e.pointerType === 'touch') return
    const target = e.target
    if (
      target instanceof Element &&
      target.closest(
        'button, a, input, textarea, select, label, [data-deck-stop-nav], [role="button"]'
      )
    ) {
      // Do not capture the pointer — otherwise Enter raffle / links never get pointerup
      // and our Button (pointer-up invoke) and other controls break on desktop.
      return
    }
    pointerIdRef.current = e.pointerId
    pointerStartRef.current = { x: e.clientX, y: e.clientY }
    pointerModeRef.current = 'undecided'
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId || total <= 1) return
    const dx = e.clientX - pointerStartRef.current.x
    const dy = e.clientY - pointerStartRef.current.y
    if (pointerModeRef.current === 'undecided') {
      if (
        Math.abs(dx) >= HORIZONTAL_LOCK_PX &&
        Math.abs(dx) > Math.abs(dy)
      ) {
        pointerModeRef.current = 'horizontal'
      } else if (
        Math.abs(dy) >= VERTICAL_CANCEL_PX &&
        Math.abs(dy) > Math.abs(dx)
      ) {
        pointerModeRef.current = 'vertical'
        return
      } else {
        return
      }
    }
    if (pointerModeRef.current === 'horizontal') {
      e.preventDefault()
      dragRef.current = dx
      setDragPx(dx)
    }
  }

  const endPointer = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    pointerIdRef.current = null
    if (pointerModeRef.current === 'horizontal') {
      const dx = dragRef.current
      dragRef.current = 0
      setDragPx(0)
      if (dx <= -SWIPE_COMMIT_PX) {
        suppressClickUntilRef.current = Date.now() + SUPPRESS_CLICK_MS
        goNext()
      } else if (dx >= SWIPE_COMMIT_PX) {
        suppressClickUntilRef.current = Date.now() + SUPPRESS_CLICK_MS
        goPrev()
      }
    }
    pointerModeRef.current = 'undecided'
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (total <= 1) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      goPrev()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      goNext()
    }
  }

  const captureNavClick = (e: React.MouseEvent) => {
    if (Date.now() < suppressClickUntilRef.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  if (total === 0) return null

  const safeIndex = clampIndex(index, total)
  const transition =
    reduceMotion || dragPx !== 0
      ? 'none'
      : 'transform 0.22s ease-out'

  const showNav = total > 1

  const prevIndex = total >= 3 ? clampIndex(safeIndex - 1, total) : safeIndex
  const nextIndex = total >= 3 ? clampIndex(safeIndex + 1, total) : safeIndex

  let slideRow: React.ReactNode
  if (total === 1) {
    slideRow = renderItem(list[0], 0, {
      fillDeckWidth: false,
      isFocused: true,
    })
  } else if (total === 2) {
    slideRow = (
      <div className="grid w-full grid-cols-2 gap-2 sm:gap-3 items-start">
        {list.map((item, i) => (
          <div
            key={getKey(item)}
            className={`min-w-0 transition-[transform,opacity] duration-200 ${
              i === safeIndex
                ? 'z-10 scale-[1.01]'
                : 'opacity-95 scale-[0.98]'
            }`}
          >
            {renderItem(item, i, {
              fillDeckWidth: true,
              isFocused: i === safeIndex,
            })}
          </div>
        ))}
      </div>
    )
  } else {
    slideRow = (
      <div className="grid w-full grid-cols-3 gap-1.5 items-start sm:gap-2 md:gap-3">
        {[
          { itemIndex: prevIndex, slot: 0 as const },
          { itemIndex: safeIndex, slot: 1 as const },
          { itemIndex: nextIndex, slot: 2 as const },
        ].map(({ itemIndex, slot }) => {
          const item = list[itemIndex]
          const isCenter = slot === 1
          return (
            <div
              key={`${slot}-${getKey(item)}`}
              className={`min-w-0 transition-[transform,opacity] duration-200 ${
                isCenter
                  ? 'z-10 scale-[1.02]'
                  : 'opacity-90 scale-[0.96] sm:scale-[0.97]'
              }`}
            >
              {renderItem(item, itemIndex, {
                fillDeckWidth: true,
                isFocused: isCenter,
              })}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className={`w-full min-w-0 ${className}`}
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
    >
      {showNav && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3 sm:mb-4">
          <div className="text-sm text-muted-foreground min-h-[44px] flex items-center">
            {counterLabel ?? (
              <span>
                <span className="font-medium text-foreground">{safeIndex + 1}</span>
                {' '}
                of {total}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goPrev}
              className="inline-flex h-11 w-11 sm:h-10 sm:w-10 touch-manipulation items-center justify-center rounded-full border border-border bg-background text-foreground hover:bg-accent disabled:opacity-40"
              disabled={total <= 1}
              aria-label="Previous raffle"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={goNext}
              className="inline-flex h-11 w-11 sm:h-10 sm:w-10 touch-manipulation items-center justify-center rounded-full border border-border bg-background text-foreground hover:bg-accent disabled:opacity-40"
              disabled={total <= 1}
              aria-label="Next raffle"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <div
        ref={trackRef}
        className="relative w-full min-w-0 touch-pan-y px-0.5 sm:px-0"
        style={{ touchAction: 'pan-y' }}
        tabIndex={showNav ? 0 : undefined}
        onKeyDown={showNav ? onKeyDown : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <div
          className="will-change-transform"
          style={{
            transform: `translateX(${dragPx}px)`,
            transition,
          }}
          onClickCapture={captureNavClick}
        >
          {slideRow}
        </div>
      </div>

      {showNav && total <= 15 && (
        <div className="flex justify-center gap-1.5 mt-3 flex-wrap max-w-full">
          {list.map((item, i) => (
            <button
              key={getKey(item)}
              type="button"
              onClick={() => {
                suppressClickUntilRef.current = Date.now() + SUPPRESS_CLICK_MS
                setIndex(i)
                setDragPx(0)
              }}
              className={`h-2.5 w-2.5 shrink-0 rounded-full touch-manipulation transition-colors ${
                i === safeIndex ? 'bg-primary scale-110' : 'bg-muted hover:bg-muted/80'
              }`}
              aria-label={`Go to raffle ${i + 1}`}
              aria-current={i === safeIndex ? 'true' : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

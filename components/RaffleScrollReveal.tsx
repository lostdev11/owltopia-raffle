'use client'

import { useEffect, useRef, useState } from 'react'
import { isMobileDevice } from '@/lib/utils'

interface RaffleScrollRevealProps {
  children: React.ReactNode
  /** Optional delay (in ms) before observing, e.g. to avoid flash on fast scroll */
  delay?: number
}

/**
 * Wraps raffle list items and triggers a scroll-in animation when the element
 * enters the viewport. Used on mobile for the raffles list (75% of users).
 * Respects prefers-reduced-motion via CSS.
 */
export function RaffleScrollReveal({ children, delay = 0 }: RaffleScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [enableReveal, setEnableReveal] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const isMobile = isMobileDevice()
    if (!isMobile) {
      setVisible(true)
      return
    }
    setEnableReveal(true)
  }, [])

  useEffect(() => {
    if (!enableReveal || !ref.current) return

    const el = ref.current
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.unobserve(entry.target)
          }
        }
      },
      {
        root: null,
        rootMargin: '0px 0px 60px 0px',
        threshold: 0.05,
      }
    )

    const id = delay > 0 ? window.setTimeout(() => observer.observe(el), delay) : null
    if (delay === 0) observer.observe(el)

    return () => {
      if (id != null) clearTimeout(id)
      observer.disconnect()
    }
  }, [enableReveal, delay])

  if (!enableReveal) {
    return <>{children}</>
  }

  return (
    <div
      ref={ref}
      className={`raffle-scroll-reveal ${visible ? 'raffle-scroll-visible' : ''}`}
    >
      {children}
    </div>
  )
}

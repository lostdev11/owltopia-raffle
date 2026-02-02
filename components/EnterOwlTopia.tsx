'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Logo } from '@/components/Logo'

const fadeIn = (delay: string) => ({
  animationDelay: delay,
  animationFillMode: 'forwards' as const,
})

/**
 * Entry page: "Enter Owl Topia" with entrance animation.
 * Warms the backend (GET /api/raffles) on mount so /raffles is more likely to load quickly.
 * Uses Link instead of useRouter to avoid useContext hydration issues.
 */
export function EnterOwlTopia() {
  useEffect(() => {
    fetch('/api/raffles', { cache: 'no-store' }).catch(() => {})
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-col items-center gap-6 sm:gap-8 max-w-sm w-full">
        <div
          className="opacity-0 animate-enter-fade-in"
          style={fadeIn('0.1s')}
        >
          <Logo width={280} height={105} priority />
        </div>
        <h1
          className="text-2xl sm:text-3xl font-semibold text-center opacity-0 animate-enter-fade-in text-theme-prime animate-glow-pulse"
          style={fadeIn('0.3s')}
        >
          Enter Owl Topia
        </h1>
        <p
          className="text-muted-foreground text-center text-sm opacity-0 animate-enter-fade-in"
          style={fadeIn('0.5s')}
        >
          Trusted raffles with full transparency
        </p>
        <Link
          href="/raffles"
          className="w-full max-w-[200px] min-h-[44px] inline-flex items-center justify-center rounded-lg px-8 py-4 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90 opacity-0 animate-enter-fade-in animate-button-glow-pulse transition-all hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 touch-manipulation"
          style={fadeIn('0.7s')}
        >
          Enter Raffles
        </Link>
      </div>
    </div>
  )
}

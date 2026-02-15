'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Coins } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { AnnouncementsBlock } from '@/components/AnnouncementsBlock'

const fadeIn = (delay: string) => ({
  animationDelay: delay,
  animationFillMode: 'forwards' as const,
})

const externalLinks = [
  { name: 'Staking', url: 'https://www.nftstake.app/owltopia' },
  { name: 'X', url: 'https://x.com/Owltopia_sol' },
  { name: 'ME', url: 'https://magiceden.io/marketplace/owltopia' },
  { name: 'Tensor', url: 'https://www.tensor.trade/trade/owltopia' },
  { name: 'Discord', url: 'https://discord.gg/nRD2wyg2vq' },
]

type NextRevShareSchedule = {
  next_date: string | null
  total_sol: number | null
  total_usdc: number | null
}

/**
 * Entry page: "Enter Owl Topia" with entrance animation.
 * Warms the backend (GET /api/raffles) on mount so /raffles is more likely to load quickly.
 * Rev Share card shows founder-set "next rev share" date and total SOL/USDC (editable in admin).
 */
export function EnterOwlTopia() {
  const [schedule, setSchedule] = useState<NextRevShareSchedule | null>(null)

  useEffect(() => {
    fetch('/api/raffles', { cache: 'no-store' }).catch(() => {})
  }, [])

  // Fetch next rev share schedule (founder-editable)
  useEffect(() => {
    const fetchSchedule = () => {
      fetch('/api/rev-share-schedule', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data): NextRevShareSchedule | null =>
          data && (data.next_date != null || data.total_sol != null || data.total_usdc != null)
            ? {
                next_date: data.next_date ?? null,
                total_sol: data.total_sol != null ? Number(data.total_sol) : null,
                total_usdc: data.total_usdc != null ? Number(data.total_usdc) : null,
              }
            : null
        )
        .then(setSchedule)
        .catch(() => setSchedule(null))
    }
    fetchSchedule()
    const interval = setInterval(fetchSchedule, 30_000) // refresh every 30s
    return () => clearInterval(interval)
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
        <AnnouncementsBlock placement="hero" variant="hero" className="opacity-0 animate-enter-fade-in" />
        <h1
          className="text-2xl sm:text-3xl font-semibold text-center opacity-0 animate-enter-fade-in text-theme-prime animate-glow-pulse"
          style={fadeIn('0.3s')}
        >
          Enter Owl Topia
        </h1>

        {/* Rev Share card — founder-set next rev share (date + total SOL/USDC) */}
        <div
          className="rev-share-pool-card w-full max-w-[360px] rounded-xl p-4 sm:p-5 opacity-0 animate-enter-fade-in"
          style={fadeIn('0.35s')}
        >
          <div className="flex items-center gap-2 mb-2">
            <Coins className="h-5 w-5 text-theme-prime drop-shadow-[0_0_6px_rgba(0,255,136,0.5)]" aria-hidden />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-theme-prime drop-shadow-[0_0_8px_rgba(0,255,136,0.4)]">
              Rev Share
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Any amount over each raffle&apos;s threshold is split 50% founder, 50% community.
          </p>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Next rev share</p>
              <p className="pool-value-glow text-xl sm:text-2xl font-bold text-theme-prime tabular-nums">
                {schedule?.next_date ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Total SOL to be shared</p>
              <p className="pool-value-glow text-2xl sm:text-3xl font-bold text-theme-prime tabular-nums">
                {schedule?.total_sol != null ? schedule.total_sol.toFixed(4) : '—'} <span className="text-xl sm:text-2xl">SOL</span>
              </p>
            </div>
            {(schedule?.total_usdc != null && schedule.total_usdc > 0) && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Total USDC to be shared</p>
                <p className="pool-value-glow text-2xl sm:text-3xl font-bold text-theme-prime tabular-nums">
                  {schedule.total_usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xl sm:text-2xl">USDC</span>
                </p>
              </div>
            )}
          </div>
        </div>

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
        {/* Links: external only */}
        <div
          className="relative z-10 flex flex-wrap items-center justify-center gap-2 text-xs sm:text-sm opacity-0 animate-enter-fade-in"
          style={fadeIn('0.9s')}
          role="navigation"
        >
          {externalLinks.map((link) => (
            <a
              key={link.name}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link-tab group relative flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full text-muted-foreground hover:text-foreground bg-white/5 border border-white/10 hover:border-green-500/50 transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_0_20px_rgba(34,197,94,0.25)] hover:bg-green-500/10 touch-manipulation min-h-[44px] text-center cursor-pointer"
            >
              <span>{link.name}</span>
              <ExternalLink className="h-3 w-3 sm:h-3.5 sm:w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

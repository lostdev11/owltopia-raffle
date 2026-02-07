'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { Logo } from '@/components/Logo'

const fadeIn = (delay: string) => ({
  animationDelay: delay,
  animationFillMode: 'forwards' as const,
})

const externalLinks = [
  { name: 'Staking', url: 'https://www.nftstake.app/owltopia' },
  { name: 'X', url: 'https://x.com/Owltopia_sol' },
  { name: 'Whitepaper', url: 'https://tinyurl.com/owltopia' },
  { name: 'ME', url: 'https://magiceden.io/marketplace/owltopia' },
  { name: 'Tensor', url: 'https://www.tensor.trade/trade/owltopia' },
  { name: 'Atlas3', url: 'https://atlas3.io/project/owltopia' },
  { name: 'Discord', url: 'https://discord.gg/nRD2wyg2vq' },
]

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
        {/* Links: internal + external */}
        <div
          className="relative z-10 flex flex-wrap items-center justify-center gap-2 text-xs sm:text-sm opacity-0 animate-enter-fade-in"
          style={fadeIn('0.9s')}
          role="navigation"
        >
          <Link
            href="/how-it-works"
            className="footer-link-tab group relative flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full text-muted-foreground hover:text-foreground bg-white/5 border border-white/10 hover:border-green-500/50 transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_0_20px_rgba(34,197,94,0.25)] hover:bg-green-500/10 touch-manipulation min-h-[44px] text-center cursor-pointer"
          >
            How It Works
          </Link>
          <Link
            href="/terms"
            className="footer-link-tab group relative flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full text-muted-foreground hover:text-foreground bg-white/5 border border-white/10 hover:border-green-500/50 transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_0_20px_rgba(34,197,94,0.25)] hover:bg-green-500/10 touch-manipulation min-h-[44px] text-center cursor-pointer"
          >
            Terms
          </Link>
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

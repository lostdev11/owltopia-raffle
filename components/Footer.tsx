'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

const externalLinks = [
  { name: 'Staking', url: 'https://www.gotmlabz.io/nftstake/owltopia' },
  { name: 'X', url: 'https://x.com/Owltopia_sol' },
  { name: 'Whitepaper', url: 'https://tinyurl.com/owltopia' },
  { name: 'ME', url: 'https://magiceden.io/marketplace/owltopia' },
  { name: 'Tensor', url: 'https://www.tensor.trade/trade/owltopia' },
  { name: 'Atlas3', url: 'https://atlas3.io/project/owltopia' },
  { name: 'Discord', url: 'https://discord.gg/nRD2wyg2vq' },
]

export function Footer() {
  return (
    <footer className="w-full bg-black border-t border-green-500/40 mt-auto">
      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="flex flex-col gap-4 sm:gap-6">
          {/* Owltopia neon branding */}
          <p className="owltopia-neon text-lg sm:text-xl md:text-2xl font-semibold tracking-wider text-center">
            owltopia
          </p>
          {/* Links Section - pill tabs with flair */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-xs sm:text-sm">
            <Link
              href="/how-it-works"
              className="footer-link-tab group relative flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full text-muted-foreground hover:text-foreground
                bg-white/5 border border-white/10 hover:border-green-500/50
                transition-all duration-300 ease-out
                hover:scale-105 hover:shadow-[0_0_20px_rgba(34,197,94,0.25)]
                hover:bg-green-500/10
                touch-manipulation min-h-[44px] text-center"
            >
              <span>How It Works</span>
            </Link>
            {externalLinks.map((link) => (
              <a
                key={link.name}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link-tab group relative flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full text-muted-foreground hover:text-foreground
                  bg-white/5 border border-white/10 hover:border-green-500/50
                  transition-all duration-300 ease-out
                  hover:scale-105 hover:shadow-[0_0_20px_rgba(34,197,94,0.25)]
                  hover:bg-green-500/10
                  touch-manipulation min-h-[44px] text-center"
              >
                <span>{link.name}</span>
                <ExternalLink className="h-3 w-3 sm:h-3.5 sm:w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            ))}
          </div>
          
          {/* Copyright and Terms Section */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 text-xs sm:text-sm text-muted-foreground border-t border-green-500/40 pt-3 sm:pt-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <span>© {new Date().getFullYear()} Owl Raffle</span>
            </div>
            <div className="flex items-center gap-4 sm:gap-6">
              <Link 
                href="/terms" 
                className="hover:text-foreground transition-colors underline-offset-4 hover:underline touch-manipulation min-h-[44px] flex items-center"
              >
                Terms of Service
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}

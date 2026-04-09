'use client'

import React from 'react'
import Link from 'next/link'
import { ExternalLink, Twitter, MessageCircle, FileText, Coins, Info, Trophy } from 'lucide-react'
import { MagicEdenIcon } from '@/components/icons/MagicEdenIcon'
import { TensorIcon } from '@/components/icons/TensorIcon'
import { SocialGlassCard } from '@/components/SocialGlassCard'
import { PLATFORM_NAME } from '@/lib/site-config'

const externalLinks = [
  { name: 'Staking', url: 'https://www.gotmlabz.io/nftstake/owltopia' },
  { name: 'X', url: 'https://x.com/Owltopia_sol' },
  { name: 'Whitepaper', url: 'https://tinyurl.com/owltopia' },
  { name: 'ME', url: 'https://magiceden.io/marketplace/owltopia' },
  { name: 'Tensor', url: 'https://www.tensor.trade/trade/owltopia' },
  { name: 'Discord', url: 'https://discord.gg/nRD2wyg2vq' },
]

const iconByLink: Record<string, React.ReactNode> = {
  Staking: <Coins className="h-6 w-6" />,
  X: <Twitter className="h-6 w-6" />,
  Whitepaper: <FileText className="h-6 w-6" />,
  ME: <MagicEdenIcon className="h-6 w-6" />,
  Tensor: <TensorIcon className="h-6 w-6" />,
  Discord: <MessageCircle className="h-6 w-6" />,
}

const glassCardItems = [
  {
    label: 'How It Works',
    href: '/how-it-works',
    icon: <Info className="h-6 w-6" />,
  },
  {
    label: 'Leaderboard',
    href: '/leaderboard',
    icon: <Trophy className="h-6 w-6" />,
  },
  ...externalLinks.map((link) => ({
    label: link.name,
    href: link.url,
    icon: iconByLink[link.name] ?? <ExternalLink className="h-6 w-6" />,
    external: true,
  })),
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
          {/* Primary links: glass icon card (mobile-first, always visible) */}
          <div className="w-full flex justify-center px-1">
            <SocialGlassCard items={glassCardItems} className="w-full max-w-2xl mx-auto glass-icon-card-row glass-icon-card-mobile" />
          </div>
          
          {/* Copyright and Terms Section */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 text-xs sm:text-sm text-muted-foreground border-t border-green-500/40 pt-3 sm:pt-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <span>© {new Date().getFullYear()} {PLATFORM_NAME}</span>
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

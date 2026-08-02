'use client'

import React from 'react'
import Link from 'next/link'
import { Twitter, MessageCircle, FileText, Coins, Info, Trophy, HeartHandshake, Landmark } from 'lucide-react'
import { MagicEdenIcon } from '@/components/icons/MagicEdenIcon'
import { OrbisIcon } from '@/components/icons/OrbisIcon'
import { TensorIcon } from '@/components/icons/TensorIcon'
import { SocialGlassCard, type GlassIconItem } from '@/components/SocialGlassCard'
import { COMMUNITY_DISCORD_INVITE_URL, PLATFORM_NAME } from '@/lib/site-config'
import {
  OWLTOPIA_MAGIC_EDEN_COLLECTION_LINKS,
  OWLTOPIA_ORBIS_COLLECTION_LINKS,
} from '@/lib/owltopia-marketplace-links'

const glassCardItems: GlassIconItem[] = [
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
  {
    label: 'Nesting',
    href: '/nesting',
    icon: <Coins className="h-6 w-6" />,
  },
  {
    label: 'Partner program',
    href: '/partner-program',
    icon: <HeartHandshake className="h-6 w-6" />,
  },
  {
    label: 'Owl Council',
    href: '/council',
    icon: <Landmark className="h-6 w-6" />,
  },
  {
    label: 'X',
    href: 'https://x.com/Owltopia_sol',
    icon: <Twitter className="h-6 w-6" />,
    external: true,
  },
  {
    label: 'Whitepaper',
    href: 'https://tinyurl.com/owltopia',
    icon: <FileText className="h-6 w-6" />,
    external: true,
  },
  {
    label: 'ME',
    href: 'magic-eden-collections',
    icon: <MagicEdenIcon className="h-6 w-6" />,
    submenu: OWLTOPIA_MAGIC_EDEN_COLLECTION_LINKS,
  },
  {
    label: 'Orbis',
    href: 'orbis-collections',
    icon: <OrbisIcon className="h-6 w-6" />,
    submenu: OWLTOPIA_ORBIS_COLLECTION_LINKS,
  },
  {
    label: 'Tensor',
    href: 'https://www.tensor.trade/trade/owltopia',
    icon: <TensorIcon className="h-6 w-6" />,
    external: true,
  },
  {
    label: 'Discord',
    href: COMMUNITY_DISCORD_INVITE_URL,
    icon: <MessageCircle className="h-6 w-6" />,
    external: true,
  },
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
            <SocialGlassCard items={glassCardItems} className="w-full max-w-3xl mx-auto glass-icon-card-row glass-icon-card-mobile" />
          </div>
          
          {/* Copyright and Terms Section */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 text-xs sm:text-sm border-t border-green-500/40 pt-3 sm:pt-4 text-zinc-300">
            <div className="flex items-center gap-3 sm:gap-4">
              <span>
                © {new Date().getFullYear()}{' '}
                <span className="font-semibold text-white">{PLATFORM_NAME}</span>
              </span>
            </div>
            <div className="flex items-center gap-4 sm:gap-6">
              <Link
                href="/terms"
                className="text-zinc-300 hover:text-white transition-colors underline-offset-4 hover:underline touch-manipulation min-h-[44px] flex items-center"
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

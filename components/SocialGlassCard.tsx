'use client'

import React from 'react'
import Link from 'next/link'

export interface GlassIconItem {
  label: string
  href: string
  icon: React.ReactNode
  external?: boolean
}

interface SocialGlassCardProps {
  items: GlassIconItem[]
  className?: string
}

/**
 * Glassmorphism card with icon links and isometric hover effect.
 * Uses styles from globals.css (.glass-icon-card, .glass-icon-iso, etc.).
 */
export function SocialGlassCard({ items, className = '' }: SocialGlassCardProps) {
  return (
    <div className={`glass-icon-card border border-white/10 bg-white/5 ${className}`}>
      <ul>
        {items.map((item) => (
          <li key={item.href} className="glass-icon-iso">
            <span className="glass-icon-layer" aria-hidden />
            <span className="glass-icon-layer" aria-hidden />
            <span className="glass-icon-layer" aria-hidden />
            <Link
              href={item.href}
              target={item.external ? '_blank' : undefined}
              rel={item.external ? 'noopener noreferrer' : undefined}
              className="flex flex-col items-center justify-center gap-0 min-h-[44px] min-w-[44px] touch-manipulation"
              aria-label={item.label}
            >
              <span className="glass-icon-svg flex items-center justify-center flex-shrink-0">
                {item.icon}
              </span>
              <span className="glass-icon-text whitespace-nowrap text-sm font-medium">
                {item.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

'use client'

import React, { useId, useState } from 'react'
import Link from 'next/link'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface GlassIconSubmenuItem {
  label: string
  href: string
}

export interface GlassIconItem {
  label: string
  /** Required for simple links; used as React key (and ignored for navigation when submenu is set). */
  href: string
  icon: React.ReactNode
  external?: boolean
  /** When set, tap opens a collection picker instead of navigating. */
  submenu?: GlassIconSubmenuItem[]
}

interface SocialGlassCardProps {
  items: GlassIconItem[]
  className?: string
}

function GlassIconLayers() {
  return (
    <>
      <span className="glass-icon-layer" aria-hidden />
      <span className="glass-icon-layer" aria-hidden />
      <span className="glass-icon-layer" aria-hidden />
    </>
  )
}

function GlassIconVisual({ item }: { item: GlassIconItem }) {
  return (
    <>
      <span className="glass-icon-svg flex items-center justify-center flex-shrink-0">
        {item.icon}
      </span>
      <span className="glass-icon-text whitespace-nowrap text-sm font-medium">{item.label}</span>
    </>
  )
}

/**
 * Glassmorphism card with icon links and isometric hover effect.
 * Uses styles from globals.css (.glass-icon-card, .glass-icon-iso, etc.).
 * Marketplace items may open a popover submenu (GEN1 / GEN2 / Coins).
 */
export function SocialGlassCard({ items, className = '' }: SocialGlassCardProps) {
  const baseId = useId()
  const [openKey, setOpenKey] = useState<string | null>(null)

  return (
    <div className={`glass-icon-card border border-white/10 bg-white/5 ${className}`}>
      <ul>
        {items.map((item) => {
          const hasSubmenu = Boolean(item.submenu && item.submenu.length > 0)
          const itemKey = item.href
          const isOpen = openKey === itemKey

          if (hasSubmenu && item.submenu) {
            return (
              <li key={itemKey} className="glass-icon-iso">
                <GlassIconLayers />
                <Popover
                  open={isOpen}
                  onOpenChange={(next) => {
                    if (next) setOpenKey(itemKey)
                    else setOpenKey((prev) => (prev === itemKey ? null : prev))
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex flex-col items-center justify-center gap-0 min-h-[44px] min-w-[44px] touch-manipulation bg-transparent border-0 p-0 text-inherit cursor-pointer"
                      aria-label={`${item.label} collections`}
                      aria-haspopup="menu"
                      aria-expanded={isOpen}
                      aria-controls={`${baseId}-menu`}
                    >
                      <GlassIconVisual item={item} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    id={isOpen ? `${baseId}-menu` : undefined}
                    role="menu"
                    aria-label={`${item.label} collections`}
                    align="center"
                    side="top"
                    sideOffset={8}
                    className="w-[min(100vw-2rem,12.5rem)] border-green-500/25 bg-zinc-950 p-1.5 text-zinc-100 shadow-lg shadow-black/50"
                  >
                    <ul className="flex flex-col gap-0.5">
                      {item.submenu.map((sub) => (
                        <li key={sub.href} role="none">
                          <a
                            href={sub.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            role="menuitem"
                            className={cn(
                              'flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium',
                              'text-zinc-100 touch-manipulation',
                              'hover:bg-green-500/15 hover:text-white focus-visible:bg-green-500/15 focus-visible:outline-none',
                            )}
                            onClick={() => setOpenKey(null)}
                          >
                            {sub.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </PopoverContent>
                </Popover>
              </li>
            )
          }

          return (
            <li key={itemKey} className="glass-icon-iso">
              <GlassIconLayers />
              <Link
                href={item.href}
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
                className="flex flex-col items-center justify-center gap-0 min-h-[44px] min-w-[44px] touch-manipulation"
                aria-label={item.label}
              >
                <GlassIconVisual item={item} />
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

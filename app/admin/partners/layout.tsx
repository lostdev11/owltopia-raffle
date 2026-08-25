'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const TABS: { href: string; label: string; exact?: boolean }[] = [
  { href: '/admin/partners', label: 'Overview', exact: true },
  { href: '/admin/partners/creators', label: 'Allowlist' },
  { href: '/admin/partners/discord', label: 'Discord' },
  { href: '/admin/partners/applications', label: 'Applications' },
  { href: '/admin/partners/nesting', label: 'Nesting' },
  { href: '/admin/partners/nest-applications', label: 'Nest requests' },
]

export default function AdminPartnersLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() || ''

  return (
    <div className="min-h-screen">
      <div className="border-b border-border/80 bg-muted/20">
        <div className="container mx-auto max-w-5xl px-4 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Owl Vision</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Partners</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            One place for Partner Pro allowlist, Discord server linking, applications, and nesting.
          </p>
          <nav
            className="-mb-px mt-4 flex gap-1 overflow-x-auto pb-px"
            aria-label="Partners sections"
          >
            {TABS.map((tab) => {
              const active = tab.exact
                ? pathname === tab.href
                : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    'min-h-[44px] shrink-0 touch-manipulation whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'border border-b-0 border-border bg-background text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
      {children}
    </div>
  )
}

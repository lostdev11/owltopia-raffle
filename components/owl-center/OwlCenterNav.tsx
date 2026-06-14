'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useOwlCenterView } from '@/components/owl-center/OwlCenterViewProvider'
import { isOwlCenterNavActive, owlCenterNavItemsForView } from '@/lib/owl-center/nav'
import { cn } from '@/lib/utils'

export function OwlCenterNav() {
  const pathname = usePathname() ?? ''
  const { showAdminFeatures, isOwlCenterAdmin, adminLoading } = useOwlCenterView()
  const items = owlCenterNavItemsForView(showAdminFeatures)

  return (
    <div className="sticky top-0 z-40 border-b border-[#1A222B] bg-[#0F1419]/95 backdrop-blur-md supports-[backdrop-filter]:bg-[#0F1419]/88">
      <div className="mx-auto max-w-6xl px-4 py-2 sm:py-2.5">
        <div className="flex items-center gap-2">
          <nav
            aria-label="Owl Center"
            className="flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {items.map((item) => {
              const active = isOwlCenterNavActive(pathname, item)
              const Icon = item.icon
              const disabled = item.adminOnly && (adminLoading || !isOwlCenterAdmin)

              if (disabled) {
                return (
                  <span
                    key={item.href}
                    title={`${item.description} (admin only)`}
                    aria-disabled="true"
                    className={cn(
                      'inline-flex min-h-[44px] shrink-0 cursor-not-allowed touch-manipulation items-center gap-1.5 rounded-md border border-transparent px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-[#5C6773] opacity-55 sm:px-3.5 sm:text-[11px]'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                    <span className="hidden sm:inline">{item.label}</span>
                    <span className="sm:hidden">{item.shortLabel ?? item.label}</span>
                  </span>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.description}
                  className={cn(
                    'inline-flex min-h-[44px] shrink-0 touch-manipulation items-center gap-1.5 rounded-md border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest transition-colors sm:px-3.5 sm:text-[11px]',
                    active
                      ? 'border-[#00FF9C]/45 bg-[#00FF9C]/12 text-[#E8FDF4]'
                      : 'border-transparent text-[#9BA8B4] hover:border-[#1A222B] hover:bg-[#10161C] hover:text-[#F4FBF8]'
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                  <span className="hidden sm:inline">{item.label}</span>
                  <span className="sm:hidden">{item.shortLabel ?? item.label}</span>
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </div>
  )
}

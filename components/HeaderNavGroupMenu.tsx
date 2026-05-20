'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isPathInNavGroup, type SiteNavGroup } from '@/lib/site-nav'
import { cn } from '@/lib/utils'

const desktopTriggerClass =
  'text-white/90 hover:text-white hover:bg-white/10 active:bg-white/15 text-xs sm:text-sm px-2 sm:px-3 h-9 sm:h-10 min-h-[44px] touch-manipulation'

type DesktopProps = {
  group: SiteNavGroup
  buttonClassName?: string
}

/** Desktop: dropdown for a nav group (Raffles, Community, Owls, Admin, …). */
export function HeaderNavGroupMenuDesktop({ group, buttonClassName }: DesktopProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const isActiveSection = isPathInNavGroup(pathname, group)
  const TriggerIcon = group.triggerIcon
  const iconAccent = group.iconAccentClass ?? 'text-emerald-400/90'

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (group.items.length === 0) return null

  return (
    <div
      ref={rootRef}
      className="relative"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(desktopTriggerClass, buttonClassName, isActiveSection && 'bg-white/10 text-white')}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <TriggerIcon className={cn('mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4', iconAccent)} aria-hidden />
        <span>{group.label}</span>
        <ChevronDown
          className={cn('ml-0.5 h-3.5 w-3.5 opacity-80 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label={group.menuAriaLabel}
          className="absolute left-0 top-full z-50 mt-1 w-[min(100vw-1.5rem,18rem)] rounded-lg border border-green-500/25 bg-zinc-950 py-1 shadow-lg shadow-black/50"
        >
          {group.items.map((item) => {
            const Icon = item.icon
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  'flex gap-3 px-3 py-2.5 min-h-[44px] touch-manipulation hover:bg-white/10 active:bg-white/15',
                  active && 'bg-white/10'
                )}
              >
                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconAccent)} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-white">{item.label}</span>
                  {item.description ? (
                    <span className="mt-0.5 block text-xs leading-snug text-white/60">{item.description}</span>
                  ) : null}
                </span>
              </Link>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

type MobileProps = {
  group: SiteNavGroup
  onNavigate: () => void
  /** When false, omit bottom border (last section). */
  showBorder?: boolean
}

/** Mobile sheet: one labeled section per nav group. */
export function HeaderNavGroupMenuMobile({ group, onNavigate, showBorder = true }: MobileProps) {
  const pathname = usePathname()
  const iconAccent = group.iconAccentClass ?? 'text-emerald-400/90'
  const sectionLabelClass =
    group.id === 'raffles'
      ? 'text-emerald-400/90'
      : group.id === 'admin'
        ? 'text-amber-400/90'
        : 'text-muted-foreground'

  if (group.items.length === 0) return null

  return (
    <div className={cn('mb-2', showBorder && 'border-b border-green-500/20 pb-2')}>
      <p
        className={cn(
          'px-4 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wider',
          sectionLabelClass
        )}
      >
        {group.mobileSectionLabel}
      </p>
      {group.items.map((item) => {
        const Icon = item.icon
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'flex gap-3 px-4 py-3 rounded-lg min-h-[48px] touch-manipulation hover:bg-white/10 active:bg-white/15',
              active && 'bg-white/10'
            )}
          >
            <Icon className={cn('h-5 w-5 shrink-0', iconAccent)} aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{item.label}</span>
              {item.description ? (
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{item.description}</span>
              ) : null}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

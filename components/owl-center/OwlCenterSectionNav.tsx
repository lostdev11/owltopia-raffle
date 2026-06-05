'use client'

import { useCallback, useEffect, useState } from 'react'

import type { OwlCenterGen2Section } from '@/lib/owl-center/nav'
import { cn } from '@/lib/utils'

export function OwlCenterSectionNav({
  sections,
  className,
}: {
  sections: OwlCenterGen2Section[]
  className?: string
}) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '')

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveId(id)
    if (typeof history !== 'undefined' && history.replaceState) {
      history.replaceState(null, '', `#${id}`)
    }
  }, [])

  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : ''
    if (hash && sections.some((s) => s.id === hash)) {
      requestAnimationFrame(() => scrollTo(hash))
    }
  }, [sections, scrollTo])

  useEffect(() => {
    const nodes = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el != null)
    if (nodes.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (b.intersectionRatio ?? 0) - (a.intersectionRatio ?? 0))
        const top = visible[0]?.target
        if (top?.id) setActiveId(top.id)
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.25, 0.5] }
    )

    for (const node of nodes) observer.observe(node)
    return () => observer.disconnect()
  }, [sections])

  return (
    <nav
      aria-label="On this page"
      className={cn(
        'sticky top-[52px] z-30 -mx-4 border-b border-[#1A222B] bg-[#0B0F14]/92 px-4 py-2 backdrop-blur-md sm:top-[56px] md:static md:mx-0 md:mb-8 md:rounded-lg md:border md:bg-[#10161C]/80 md:px-3 md:py-3',
        className
      )}
    >
      <p className="mb-2 font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-[#5C6773] md:sr-only">
        Jump to
      </p>
      <div className="flex gap-1 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => scrollTo(section.id)}
            className={cn(
              'min-h-[44px] shrink-0 touch-manipulation rounded-md border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest transition-colors',
              activeId === section.id
                ? 'border-[#00FF9C]/40 bg-[#00FF9C]/10 text-[#E8FDF4]'
                : 'border-transparent text-[#9BA8B4] hover:bg-[#0F1419] hover:text-[#F4FBF8]'
            )}
          >
            <span className="hidden sm:inline">{section.label}</span>
            <span className="sm:hidden">{section.shortLabel ?? section.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

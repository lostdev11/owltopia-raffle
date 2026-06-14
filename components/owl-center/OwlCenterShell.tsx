import type { ReactNode } from 'react'

import { OWL_CENTER_PAGE_GUTTER } from '@/lib/owl-center/layout'
import { cn } from '@/lib/utils'

export function OwlCenterShell({
  children,
  className,
  eyebrow,
  title,
  subtitle,
}: {
  children: ReactNode
  className?: string
  eyebrow?: string
  title?: string
  subtitle?: string
}) {
  return (
    <div
      className={cn(
        'min-h-[100dvh] w-full min-w-0 bg-[#0F1419] text-[#E8EEF2]',
        'bg-[radial-gradient(ellipse_at_top,rgba(29,255,178,0.06),transparent_55%)]',
        className
      )}
    >
      <div
        className={cn(
          OWL_CENTER_PAGE_GUTTER,
          'py-8 pb-[max(2rem,env(safe-area-inset-bottom))] md:py-12'
        )}
      >
        {(eyebrow || title || subtitle) && (
          <header className="mb-10 min-w-0 border-b border-[#1A222B] pb-8">
            {eyebrow ? (
              <p className="break-words font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#00C97A]/90 sm:tracking-[0.35em]">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h1 className="mt-2 break-words font-display text-4xl tracking-tight text-[#F4FBF8] md:text-5xl">{title}</h1>
            ) : null}
            {subtitle ? (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#9BA8B4] md:text-base">{subtitle}</p>
            ) : null}
          </header>
        )}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}

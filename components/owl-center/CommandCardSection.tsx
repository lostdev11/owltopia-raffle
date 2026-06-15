import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** Subsection inside a single CommandCard (divider + optional label). */
export function CommandCardSection({
  children,
  className,
  first = false,
  id,
  label,
}: {
  children: ReactNode
  className?: string
  first?: boolean
  id?: string
  label?: string
}) {
  return (
    <div
      id={id}
      className={cn(
        id ? 'scroll-mt-[max(6rem,calc(4rem+env(safe-area-inset-top)))]' : null,
        !first && 'mt-6 border-t border-[#1A222B] pt-6',
        className
      )}
    >
      {label ? (
        <p className="mb-4 font-mono text-[9px] font-bold uppercase leading-snug tracking-[0.16em] text-[#00C97A] sm:text-[10px] sm:tracking-[0.28em]">
          {label}
        </p>
      ) : null}
      {children}
    </div>
  )
}

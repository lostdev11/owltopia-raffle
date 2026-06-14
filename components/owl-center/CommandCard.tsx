import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function CommandCard({
  children,
  className,
  id,
  label,
}: {
  children: ReactNode
  className?: string
  id?: string
  label?: string
}) {
  return (
    <section
      id={id}
      className={cn(
        id ? 'scroll-mt-[max(6rem,calc(4rem+env(safe-area-inset-top)))]' : null,
        'rounded-none border border-[#00FF9C]/25 bg-[#10161C]/90 shadow-[0_0_40px_rgba(0,255,156,0.06)] backdrop-blur-sm',
        'motion-reduce:shadow-none',
        className
      )}
    >
      {label ? (
        <div className="break-words border-b border-[#1A222B] bg-[#0F1419]/80 px-3 py-2.5 font-mono text-[9px] font-bold uppercase leading-snug tracking-[0.16em] text-[#00C97A] sm:px-4 sm:text-[10px] sm:tracking-[0.28em]">
          {label}
        </div>
      ) : null}
      <div className="touch-manipulation p-4 sm:p-5 md:p-6">{children}</div>
    </section>
  )
}

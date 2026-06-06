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
        id ? 'scroll-mt-24' : null,
        'rounded-none border border-[#00FF9C]/25 bg-[#10161C]/90 shadow-[0_0_40px_rgba(0,255,156,0.06)] backdrop-blur-sm',
        'motion-reduce:shadow-none',
        className
      )}
    >
      {label ? (
        <div className="border-b border-[#1A222B] bg-[#0F1419]/80 px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-[#00C97A]">
          {label}
        </div>
      ) : null}
      <div className="p-4 md:p-6">{children}</div>
    </section>
  )
}

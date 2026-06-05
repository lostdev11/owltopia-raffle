import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function StatPanel({
  label,
  value,
  hint,
  className,
}: {
  label: string
  value: ReactNode
  hint?: string
  className?: string
}) {
  return (
    <div className={cn('border border-[#1A222B] bg-[#10161C]/80 p-4', className)}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#5C6773]">{label}</p>
      <p className="mt-2 font-mono text-xl font-bold tabular-nums text-[#F4FBF8]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[#9BA8B4]">{hint}</p> : null}
    </div>
  )
}

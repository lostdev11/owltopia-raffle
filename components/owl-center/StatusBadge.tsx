import { cn } from '@/lib/utils'
import type { OwlCenterStatus } from '@/lib/owl-center/types'

const MAP: Record<OwlCenterStatus, string> = {
  DRAFT: 'border-[#5C6773] text-[#9BA8B4]',
  PENDING_REVIEW: 'border-[#FFD769]/50 text-[#FFD769]',
  PRESALE: 'border-[#00FF9C]/45 text-[#00FF9C]',
  WHITELIST: 'border-[#1DFFB2]/40 text-[#1DFFB2]',
  PUBLIC: 'border-[#00C97A]/45 text-[#00C97A]',
  SOLD_OUT: 'border-[#FF6B6B]/45 text-[#FF9C9C]',
  TRADING_ACTIVE: 'border-[#00FF9C]/60 text-[#00FF9C]',
}

export function StatusBadge({ status }: { status: OwlCenterStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-none border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest',
        MAP[status] ?? 'border-[#5C6773] text-[#9BA8B4]'
      )}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}

import { cn } from '@/lib/utils'
import type { OwlCenterMarketplaceTrackStatus } from '@/lib/owl-center/asset-types'

export function MarketplaceStatusBadge({
  label,
  status,
  className,
}: {
  label: string
  status: OwlCenterMarketplaceTrackStatus
  className?: string
}) {
  const terminal = status === 'LISTED' || status === 'CLAIMED' || status === 'VERIFIED'
  const warn = status === 'NEEDS_MANUAL_REVIEW'
  const idle = status === 'NOT_READY'

  return (
    <span
      className={cn(
        'inline-flex min-h-[28px] items-center border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest',
        terminal && 'border-[#00FF9C]/45 text-[#00FF9C]',
        warn && 'border-[#FF9C9C]/45 text-[#FF9C9C]',
        idle && 'border-[#5C6773]/60 text-[#9BA8B4]',
        !terminal && !warn && !idle && 'border-[#5B8DEF]/45 text-[#9BB8F4]',
        className
      )}
    >
      {label} · {status}
    </span>
  )
}

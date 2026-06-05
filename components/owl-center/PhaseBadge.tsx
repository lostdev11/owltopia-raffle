import { cn } from '@/lib/utils'
import { owlCenterPhaseLabel } from '@/lib/owl-center/phase-display'
import type { OwlCenterPhase } from '@/lib/owl-center/types'

const MAP: Record<OwlCenterPhase, string> = {
  AIRDROP: 'bg-[#1A222B] text-[#9BA8B4]',
  PRESALE: 'bg-[#00FF9C]/15 text-[#00FF9C]',
  PRESALE_OVERAGE: 'bg-[#00C97A]/12 text-[#00C97A]',
  WHITELIST: 'bg-[#1DFFB2]/12 text-[#1DFFB2]',
  PUBLIC: 'bg-[#00C97A]/15 text-[#00C97A]',
  SOLD_OUT: 'bg-[#FF6B6B]/12 text-[#FF9C9C]',
  TRADING_ACTIVE: 'bg-[#00FF9C]/25 text-[#00FF9C]',
}

export function PhaseBadge({
  phase,
  pulse,
  presaleSoldOut,
}: {
  phase: OwlCenterPhase
  pulse?: boolean
  presaleSoldOut?: boolean
}) {
  const label =
    phase === 'PRESALE' && presaleSoldOut ? `${owlCenterPhaseLabel(phase)} · sold out` : owlCenterPhaseLabel(phase)

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-none px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.22em]',
        MAP[phase],
        pulse && phase === 'PRESALE' && 'animate-pulse motion-reduce:animate-none'
      )}
    >
      {label}
    </span>
  )
}

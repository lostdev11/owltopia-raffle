import { cn } from '@/lib/utils'
import { owlCenterPhaseLabel } from '@/lib/owl-center/phase-display'
import type { OwlCenterPhase } from '@/lib/owl-center/types'

const ORDER: OwlCenterPhase[] = ['AIRDROP', 'PRESALE', 'PRESALE_OVERAGE', 'WHITELIST', 'PUBLIC', 'TRADING_ACTIVE']

export function LaunchPhaseTimeline({ active }: { active: OwlCenterPhase }) {
  const idx = ORDER.indexOf(active === 'SOLD_OUT' ? 'PUBLIC' : active)
  return (
    <ol className="flex flex-wrap gap-2 md:gap-0 md:divide-x md:divide-[#1A222B]">
      {ORDER.map((p, i) => {
        const done = idx > i || active === 'SOLD_OUT'
        const current = active === p || (active === 'SOLD_OUT' && p === 'PUBLIC')
        return (
          <li
            key={p}
            className={cn(
              'flex min-h-[44px] flex-1 items-center justify-center px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest md:flex-none md:justify-start md:px-4',
              done && 'text-[#00FF9C]',
              current && !done && 'bg-[#00FF9C]/10 text-[#00FF9C]',
              !done && !current && 'text-[#5C6773]'
            )}
          >
            {owlCenterPhaseLabel(p)}
          </li>
        )
      })}
    </ol>
  )
}

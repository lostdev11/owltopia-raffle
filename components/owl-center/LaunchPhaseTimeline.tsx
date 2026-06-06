import { cn } from '@/lib/utils'
import { owlCenterPhaseLabel } from '@/lib/owl-center/phase-display'
import { formatPhaseStartShort, getPhaseStartsAt } from '@/lib/owl-center/phase-schedule'
import type { OwlCenterLaunchPublic, OwlCenterPhase } from '@/lib/owl-center/types'

const ORDER: OwlCenterPhase[] = ['AIRDROP', 'PRESALE', 'PRESALE_OVERAGE', 'WHITELIST', 'PUBLIC', 'TRADING_ACTIVE']

type Props = {
  active: OwlCenterPhase
  launch?: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule'>
  /** Phase where the connected wallet can mint right now. */
  userMintPhase?: OwlCenterPhase | null
  /** Phases with reserved allocation that are not live yet. */
  userReservedPhases?: readonly OwlCenterPhase[]
}

export function LaunchPhaseTimeline({ active, launch, userMintPhase = null, userReservedPhases = [] }: Props) {
  const idx = ORDER.indexOf(active === 'SOLD_OUT' ? 'PUBLIC' : active)
  const reservedSet = new Set(userReservedPhases)

  return (
    <ol className="flex flex-wrap gap-2 md:gap-0 md:divide-x md:divide-[#1A222B]">
      {ORDER.map((p, i) => {
        const done = idx > i || active === 'SOLD_OUT'
        const current = active === p || (active === 'SOLD_OUT' && p === 'PUBLIC')
        const isUserMint = userMintPhase === p
        const isUserReserved = reservedSet.has(p) && !current && !isUserMint
        const startsAt = launch ? getPhaseStartsAt(launch, p) : null
        const startLabel = formatPhaseStartShort(startsAt)

        return (
          <li
            key={p}
            className={cn(
              'relative flex min-h-[44px] flex-1 flex-col items-center justify-center px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest md:flex-none md:items-start md:justify-center md:px-4',
              done && !isUserMint && 'text-[#00FF9C]',
              current && !done && !isUserMint && 'bg-[#00FF9C]/10 text-[#00FF9C]',
              isUserMint && 'bg-[#00FF9C]/15 text-[#00FF9C] ring-2 ring-[#00FF9C]/70 ring-offset-2 ring-offset-[#0B0F14]',
              isUserReserved && 'border border-dashed border-[#00FF9C]/35 bg-[#00FF9C]/5 text-[#9BA8B4]',
              !done && !current && !isUserMint && !isUserReserved && 'text-[#5C6773]'
            )}
          >
            <span>{owlCenterPhaseLabel(p)}</span>
            {startLabel ? (
              <span className="mt-0.5 text-[8px] font-normal normal-case tracking-normal text-[#5C6773]">
                {startLabel}
              </span>
            ) : null}
            {isUserMint ? (
              <span className="mt-0.5 text-[8px] font-bold normal-case tracking-wider text-[#00FF9C]">Your mint</span>
            ) : isUserReserved ? (
              <span className="mt-0.5 text-[8px] font-bold normal-case tracking-wider text-[#7D8A93]">
                Your allocation
              </span>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

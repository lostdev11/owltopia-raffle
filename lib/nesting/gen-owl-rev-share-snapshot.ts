import { countActiveGenOwlNestsByGroup } from '@/lib/db/gen-owl-rev-share-stats'
import { getRevShareSchedule } from '@/lib/db/rev-share-schedule'
import { genOwlStakingGroupLabel } from '@/lib/nesting/gen-owl-staking-groups'
import { buildGenOwlRevSharePreview, type GenOwlRevSharePreview } from '@/lib/nesting/gen-owl-rev-share'

export type GenOwlRevShareSnapshot = {
  next_date: string | null
  gen1: GenOwlRevSharePreview
  gen2: GenOwlRevSharePreview
}

export async function getGenOwlRevShareSnapshot(): Promise<GenOwlRevShareSnapshot | null> {
  const schedule = await getRevShareSchedule()
  if (!schedule) return null

  const counts = await countActiveGenOwlNestsByGroup()

  return {
    next_date: schedule.next_date,
    gen1: buildGenOwlRevSharePreview({
      group: 'gen1-owl',
      label: genOwlStakingGroupLabel('gen1-owl'),
      activeNestCount: counts['gen1-owl'],
      totalSol: schedule.gen1_total_sol,
      totalUsdc: schedule.gen1_total_usdc,
    }),
    gen2: buildGenOwlRevSharePreview({
      group: 'gen2-owl',
      label: genOwlStakingGroupLabel('gen2-owl'),
      activeNestCount: counts['gen2-owl'],
      totalSol: schedule.gen2_total_sol,
      totalUsdc: schedule.gen2_total_usdc,
    }),
  }
}

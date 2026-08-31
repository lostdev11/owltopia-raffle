import { countActiveGenOwlNestsByGroup, listActiveGenOwlNestMintsByGroup } from '@/lib/db/gen-owl-rev-share-stats'
import { getRevShareSchedule } from '@/lib/db/rev-share-schedule'
import { classifyGen1OneOfOneMints } from '@/lib/nesting/gen1-one-of-one'
import { classifyGen2OneOfOneMints } from '@/lib/nesting/gen2-one-of-one'
import { genOwlStakingGroupLabel } from '@/lib/nesting/gen-owl-staking-groups'
import {
  buildGenOwlRevSharePreview,
  computeGenOwlRevShareBucketAmounts,
  type GenOwlRevSharePreview,
} from '@/lib/nesting/gen-owl-rev-share'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'

export type GenOwlRevShareSnapshot = {
  next_date: string | null
  gen1_next_date: string | null
  gen2_next_date: string | null
  gen1: GenOwlRevSharePreview
  gen2: GenOwlRevSharePreview
}

async function buildBucketPreview(params: {
  group: GenOwlStakingGroupKey
  totalSol: number | null
  totalUsdc: number | null
  activeNestCount: number
}): Promise<GenOwlRevSharePreview> {
  const mints = await listActiveGenOwlNestMintsByGroup(params.group)
  const classification =
    params.group === 'gen1-owl'
      ? await classifyGen1OneOfOneMints(mints)
      : await classifyGen2OneOfOneMints(mints)
  let standard_count = 0
  let one_of_one_count = 0
  for (const mint of mints) {
    if (classification.get(mint) === 'one-of-one') one_of_one_count++
    else standard_count++
  }

  const buckets = computeGenOwlRevShareBucketAmounts({
    totalSol: params.totalSol,
    totalUsdc: params.totalUsdc,
    standardCount: standard_count,
    oneOfOneCount: one_of_one_count,
  })

  return buildGenOwlRevSharePreview({
    group: params.group,
    label: genOwlStakingGroupLabel(params.group),
    activeNestCount: params.activeNestCount,
    totalSol: params.totalSol,
    totalUsdc: params.totalUsdc,
    buckets,
  })
}

export async function getGenOwlRevShareSnapshot(): Promise<GenOwlRevShareSnapshot | null> {
  const schedule = await getRevShareSchedule()
  if (!schedule) return null

  const counts = await countActiveGenOwlNestsByGroup()

  const [gen1, gen2] = await Promise.all([
    buildBucketPreview({
      group: 'gen1-owl',
      totalSol: schedule.gen1_total_sol,
      totalUsdc: schedule.gen1_total_usdc,
      activeNestCount: counts['gen1-owl'],
    }),
    buildBucketPreview({
      group: 'gen2-owl',
      totalSol: schedule.gen2_total_sol,
      totalUsdc: schedule.gen2_total_usdc,
      activeNestCount: counts['gen2-owl'],
    }),
  ])

  return {
    next_date: schedule.next_date,
    gen1_next_date: schedule.gen1_next_date,
    gen2_next_date: schedule.gen2_next_date,
    gen1,
    gen2,
  }
}

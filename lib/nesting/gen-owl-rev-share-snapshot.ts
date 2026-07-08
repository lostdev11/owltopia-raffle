import { countActiveGenOwlNestsByGroup, listActiveGenOwlNestMintsByGroup } from '@/lib/db/gen-owl-rev-share-stats'
import { getRevShareSchedule } from '@/lib/db/rev-share-schedule'
import { classifyGen1OneOfOneMints } from '@/lib/nesting/gen1-one-of-one'
import { genOwlStakingGroupLabel } from '@/lib/nesting/gen-owl-staking-groups'
import {
  buildGenOwlRevSharePreview,
  computeGen1RevShareBucketAmounts,
  type GenOwlRevSharePreview,
} from '@/lib/nesting/gen-owl-rev-share'

export type GenOwlRevShareSnapshot = {
  next_date: string | null
  gen1: GenOwlRevSharePreview
  gen2: GenOwlRevSharePreview
}

async function buildGen1BucketPreview(params: {
  totalSol: number | null
  totalUsdc: number | null
  activeNestCount: number
}): Promise<GenOwlRevSharePreview> {
  const mints = await listActiveGenOwlNestMintsByGroup('gen1-owl')
  const classification = await classifyGen1OneOfOneMints(mints)
  let standard_count = 0
  let one_of_one_count = 0
  for (const mint of mints) {
    if (classification.get(mint) === 'one-of-one') one_of_one_count++
    else standard_count++
  }

  const gen1Buckets = computeGen1RevShareBucketAmounts({
    totalSol: params.totalSol,
    totalUsdc: params.totalUsdc,
    standardCount: standard_count,
    oneOfOneCount: one_of_one_count,
  })

  return buildGenOwlRevSharePreview({
    group: 'gen1-owl',
    label: genOwlStakingGroupLabel('gen1-owl'),
    activeNestCount: params.activeNestCount,
    totalSol: params.totalSol,
    totalUsdc: params.totalUsdc,
    gen1Buckets,
  })
}

export async function getGenOwlRevShareSnapshot(): Promise<GenOwlRevShareSnapshot | null> {
  const schedule = await getRevShareSchedule()
  if (!schedule) return null

  const counts = await countActiveGenOwlNestsByGroup()

  const [gen1, gen2] = await Promise.all([
    buildGen1BucketPreview({
      totalSol: schedule.gen1_total_sol,
      totalUsdc: schedule.gen1_total_usdc,
      activeNestCount: counts['gen1-owl'],
    }),
    Promise.resolve(
      buildGenOwlRevSharePreview({
        group: 'gen2-owl',
        label: genOwlStakingGroupLabel('gen2-owl'),
        activeNestCount: counts['gen2-owl'],
        totalSol: schedule.gen2_total_sol,
        totalUsdc: schedule.gen2_total_usdc,
      })
    ),
  ])

  return {
    next_date: schedule.next_date,
    gen1,
    gen2,
  }
}

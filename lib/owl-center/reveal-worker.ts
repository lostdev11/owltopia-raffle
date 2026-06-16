import 'server-only'

import { listOwlCenterLaunchesDueForReveal } from '@/lib/db/owl-center-launch'
import { runRevealDayForLaunch } from '@/lib/owl-center/reveal-day'

export type RevealDayWorkerTickResult = {
  checked: number
  triggered: string[]
  completed: { launch_id: string; refreshed_count: number; skipped_count: number }[]
  failed: { launch_id: string; error: string }[]
}

/** Process scheduled reveal_day launches whose reveal_at has passed. */
export async function runRevealDayWorkerTick(nowMs: number = Date.now()): Promise<RevealDayWorkerTickResult> {
  const due = await listOwlCenterLaunchesDueForReveal(nowMs)
  const triggered: string[] = []
  const completed: RevealDayWorkerTickResult['completed'] = []
  const failed: RevealDayWorkerTickResult['failed'] = []

  for (const launch of due) {
    triggered.push(launch.id)
    const result = await runRevealDayForLaunch(launch.id)
    if (result.ok) {
      completed.push({
        launch_id: launch.id,
        refreshed_count: result.refreshed_count,
        skipped_count: result.skipped_count,
      })
    } else {
      failed.push({ launch_id: launch.id, error: result.error })
    }
  }

  return { checked: due.length, triggered, completed, failed }
}

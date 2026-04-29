import { ENGAGEMENT_MILESTONES } from '@/lib/xp/milestone-catalog'
import { levelProgressFromTotalXp } from '@/lib/xp/level-from-xp'

export type MilestoneListItem = {
  key: string
  title: string
  description: string
  xp: number
  done: boolean
}

export type DashboardEngagementPayload = {
  totalXp: number
  level: number
  xpIntoLevel: number
  xpToNext: number | null
  milestones: MilestoneListItem[]
}

function buildMilestoneList(completed: Set<string>): MilestoneListItem[] {
  return ENGAGEMENT_MILESTONES.map((m) => ({
    key: m.key,
    title: m.title,
    description: m.description,
    xp: m.xp,
    done: completed.has(m.key),
  }))
}

/** Safe default when the milestones table is unavailable, sync fails, or API shape is older. */
export function getEmptyEngagementPayload(): DashboardEngagementPayload {
  const prog = levelProgressFromTotalXp(0)
  return {
    totalXp: 0,
    level: prog.level,
    xpIntoLevel: prog.xpIntoLevel,
    xpToNext: prog.xpToNext,
    milestones: buildMilestoneList(new Set()),
  }
}

export function buildMilestoneListForCompletedKeys(completed: Set<string>): MilestoneListItem[] {
  return buildMilestoneList(completed)
}

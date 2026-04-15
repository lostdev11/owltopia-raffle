import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { ENGAGEMENT_MILESTONES, type MilestoneSnapshot } from '@/lib/xp/milestone-catalog'
import { levelProgressFromTotalXp } from '@/lib/xp/level-from-xp'
import {
  buildMilestoneListForCompletedKeys,
  getEmptyEngagementPayload,
  type DashboardEngagementPayload,
  type MilestoneListItem,
} from '@/lib/xp/engagement-payload'

export type { DashboardEngagementPayload, MilestoneListItem }

export { getEmptyEngagementPayload }

export type WalletMilestoneRow = {
  milestone_key: string
  xp: number
  completed_at: string
}

async function fetchMilestoneRows(wallet: string): Promise<WalletMilestoneRow[]> {
  const w = wallet.trim()
  if (!w) return []

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('wallet_milestones')
    .select('milestone_key, xp, completed_at')
    .eq('wallet_address', w)

  if (error) {
    console.error('[wallet_milestones] fetch:', error.message)
    return []
  }

  const rows: WalletMilestoneRow[] = []
  for (const row of data ?? []) {
    const key = row?.milestone_key != null ? String(row.milestone_key).trim() : ''
    const xp = Number(row?.xp)
    if (!key || !Number.isFinite(xp) || xp <= 0) continue
    rows.push({
      milestone_key: key,
      xp,
      completed_at: row?.completed_at != null ? String(row.completed_at) : '',
    })
  }
  return rows
}

async function tryInsertMilestone(wallet: string, milestoneKey: string, xp: number): Promise<boolean> {
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('wallet_milestones').insert({
    wallet_address: wallet.trim(),
    milestone_key: milestoneKey,
    xp,
    completed_at: new Date().toISOString(),
  })
  if (!error) return true
  if (error.code === '23505') return false
  console.error('[wallet_milestones] insert:', milestoneKey, error.message)
  return false
}

/**
 * Award any newly eligible milestones and return dashboard-friendly engagement payload.
 */
export async function syncEngagementMilestonesAndGetPayload(
  wallet: string,
  snapshot: MilestoneSnapshot
): Promise<DashboardEngagementPayload> {
  const w = wallet.trim()
  if (!w) return getEmptyEngagementPayload()

  let rows = await fetchMilestoneRows(w)
  let completed = new Set(rows.map((r) => r.milestone_key))

  for (const def of ENGAGEMENT_MILESTONES) {
    if (completed.has(def.key)) continue
    if (!def.when(snapshot)) continue
    const inserted = await tryInsertMilestone(w, def.key, def.xp)
    if (inserted) {
      completed.add(def.key)
      rows = rows.concat({
        milestone_key: def.key,
        xp: def.xp,
        completed_at: new Date().toISOString(),
      })
    }
  }

  if (rows.length === 0) {
    const prog = levelProgressFromTotalXp(0)
    return {
      totalXp: 0,
      level: prog.level,
      xpIntoLevel: prog.xpIntoLevel,
      xpToNext: prog.xpToNext,
      milestones: buildMilestoneListForCompletedKeys(completed),
    }
  }

  const totalXp = rows.reduce((sum, r) => sum + r.xp, 0)
  const prog = levelProgressFromTotalXp(totalXp)

  return {
    totalXp,
    level: prog.level,
    xpIntoLevel: prog.xpIntoLevel,
    xpToNext: prog.xpToNext,
    milestones: buildMilestoneListForCompletedKeys(completed),
  }
}

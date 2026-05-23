import type { Raffle } from '@/lib/types'
import { isRaffleLiveForManualDiscordShare } from '@/lib/raffles/discord-live-share'
import {
  buildOwltopiaRaffleShareShortUrl,
  buildOwltopiaRaffleShareText,
  buildOwltopiaRaffleXIntentUrl,
} from '@/lib/raffles/owltopia-share-text'

export const DAILY_RAID_MAX_RAFFLES = 5

/** End calendar day is today or tomorrow in UTC (and still in the future). */
export function isRaffleEndingTodayOrTomorrowUtc(
  endTimeIso: string,
  nowMs: number = Date.now()
): boolean {
  const end = new Date(endTimeIso)
  const endMs = end.getTime()
  if (!Number.isFinite(endMs) || endMs <= nowMs) return false

  const now = new Date(nowMs)
  const todayDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const tomorrowDay = todayDay + 86_400_000
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  return endDay === todayDay || endDay === tomorrowDay
}

export function selectRafflesForDailyRaid(raffles: Raffle[], nowMs: number = Date.now()): Raffle[] {
  return raffles
    .filter((r) => isRaffleLiveForManualDiscordShare(r, nowMs))
    .filter((r) => isRaffleEndingTodayOrTomorrowUtc(r.end_time, nowMs))
    .sort((a, b) => new Date(a.end_time).getTime() - new Date(b.end_time).getTime())
    .slice(0, DAILY_RAID_MAX_RAFFLES)
}

export function buildSuggestedDiscordRaidMessage(count: number): string {
  const n = Math.max(1, Math.min(count, DAILY_RAID_MAX_RAFFLES))
  return `Raid the last ${n} tweet${n === 1 ? '' : 's'} — 1 winner gets 0.1 SOL! 2h timeframe`
}

export type DailyRaidRaffleItem = {
  id: string
  title: string
  slug: string
  endTime: string
  shareText: string
  intentUrl: string
  shortUrl: string
}

export function buildDailyRaidRaffleItems(raffles: Raffle[], nowMs?: number): DailyRaidRaffleItem[] {
  return selectRafflesForDailyRaid(raffles, nowMs).map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    endTime: r.end_time,
    shareText: buildOwltopiaRaffleShareText(r, nowMs),
    intentUrl: buildOwltopiaRaffleXIntentUrl(r, nowMs),
    shortUrl: buildOwltopiaRaffleShareShortUrl(r),
  }))
}

import type { Entry } from '@/lib/types'
import { ownsOwltopia } from '@/lib/platform-fees'
import { isReferralGrowthProgramActive } from '@/lib/referrals/config'
import { raffleSupportsReferralProgram } from '@/lib/referrals/program'
import { getRaffleById } from '@/lib/db/raffles'
import {
  countConfirmedEntriesForWallet,
  countReferrerRewardsThisMonth,
  getReferralRewardSettings,
  getReferrerMonthlyCap,
  hasBuyerReferralRewardForWallet,
  insertReferralReward,
  utcCalendarMonthKey,
  type ReferralRewardRow,
} from '@/lib/db/referral-rewards'

export type ReferralRewardUnlockResult = {
  buyerReward: ReferralRewardRow | null
  referrerReward: ReferralRewardRow | null
}

/**
 * After a paid entry confirms with referral attribution, issue buyer (+ referrer) free-entry credits.
 */
export async function tryIssueReferralRewardsOnPaidEntryConfirm(
  entry: Entry
): Promise<ReferralRewardUnlockResult> {
  const empty = { buyerReward: null, referrerReward: null }
  if (!(await isReferralGrowthProgramActive())) return empty

  if (entry.referral_complimentary === true || Number(entry.amount_paid) <= 0) return empty
  if (entry.status !== 'confirmed') return empty

  const referrer = entry.referrer_wallet?.trim()
  const code = entry.referral_code_used?.trim()
  const buyer = entry.wallet_address.trim()
  if (!referrer || !code || !buyer) return empty
  if (referrer === buyer) return empty

  const raffle = await getRaffleById(entry.raffle_id)
  if (!raffle || !raffleSupportsReferralProgram(raffle)) return empty

  const settings = await getReferralRewardSettings()
  if (settings.reward_mode === 'disabled') return empty

  const confirmedCount = await countConfirmedEntriesForWallet(buyer)
  if (confirmedCount !== 1) return empty

  if (await hasBuyerReferralRewardForWallet(buyer)) return empty

  const monthKey = utcCalendarMonthKey()
  const campaignKey = settings.campaign_key

  const buyerReward = await insertReferralReward({
    campaign_key: campaignKey,
    calendar_month: monthKey,
    reward_recipient_role: 'buyer',
    raffle_id: entry.raffle_id,
    referrer_wallet: referrer,
    referral_code: code,
    referred_wallet: buyer,
    reward_mode: 'free_entry',
    trigger_entry_id: entry.id,
  })

  let referrerReward: ReferralRewardRow | null = null
  const [cap, used] = await Promise.all([
    getReferrerMonthlyCap(referrer),
    countReferrerRewardsThisMonth(referrer, monthKey),
  ])
  if (used < cap) {
    const isHolder = await ownsOwltopia(referrer, { skipCache: true })
    referrerReward = await insertReferralReward({
      campaign_key: campaignKey,
      calendar_month: monthKey,
      reward_recipient_role: 'referrer',
      raffle_id: entry.raffle_id,
      referrer_wallet: referrer,
      referral_code: code,
      referred_wallet: buyer,
      reward_mode: 'free_entry',
      trigger_entry_id: entry.id,
      referrer_is_holder_at_issue: isHolder,
    })
  }

  return { buyerReward, referrerReward }
}

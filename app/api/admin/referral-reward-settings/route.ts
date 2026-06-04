import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getReferralRewardSettings,
  updateReferralRewardSettings,
  type ReferralRewardMode,
} from '@/lib/db/referral-rewards'
import { parseOr400 } from '@/lib/validations'
import { safeErrorMessage } from '@/lib/safe-error'
import { referralEnvKillSwitchStatus } from '@/lib/referrals/config'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  program_enabled: z.boolean().optional(),
  reward_mode: z.enum(['free_entry', 'owl_token', 'disabled']).optional(),
  campaign_key: z.string().min(1).max(64).optional(),
  monthly_cap_holder: z.number().int().min(1).max(100).optional(),
  monthly_cap_non_holder: z.number().int().min(1).max(100).optional(),
  buyer_complimentary_enabled: z.boolean().optional(),
})

export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session
    const settings = await getReferralRewardSettings()
    return NextResponse.json({
      settings,
      env_kill_switch: referralEnvKillSwitchStatus(),
    })
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(patchSchema, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const settings = await updateReferralRewardSettings(
      parsed.data as Partial<{
        program_enabled: boolean
        reward_mode: ReferralRewardMode
        campaign_key: string
        monthly_cap_holder: number
        monthly_cap_non_holder: number
        buyer_complimentary_enabled: boolean
      }>,
      session.wallet
    )

    if (!settings) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    return NextResponse.json({
      settings,
      env_kill_switch: referralEnvKillSwitchStatus(),
    })
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { isAdmin } from '@/lib/db/admins'
import {
  insertPartnerNestApplication,
  listPartnerNestApplicationsByWallet,
  type PartnerNestRewardMode,
} from '@/lib/db/partner-nest-applications'
import { listPartnerStakingPoolsAdmin } from '@/lib/db/staking-pools'
import { resolveSplMintOnChain } from '@/lib/solana/resolve-spl-mint'
import { isProbableSolanaPubkey } from '@/lib/nesting/admin-quick-pool'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

async function requirePartnerOrAdmin(wallet: string): Promise<true | NextResponse> {
  const [feeTier, admin] = await Promise.all([
    getCreatorFeeTier(wallet, { skipCache: true }),
    isAdmin(wallet),
  ])
  if (feeTier.reason === 'partner_community' || admin) return true
  return NextResponse.json(
    { error: 'Partner program access required to request Nesting.' },
    { status: 403 }
  )
}

/**
 * GET /api/partners/nest-applications — own applications + partner-tagged pools for this wallet's slug matches.
 */
export async function GET(request: NextRequest) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session

  const access = await requirePartnerOrAdmin(session.wallet)
  if (access instanceof NextResponse) return access

  try {
    const [applications, allPartnerPools] = await Promise.all([
      listPartnerNestApplicationsByWallet(session.wallet),
      listPartnerStakingPoolsAdmin(),
    ])
    const approvedPoolIds = new Set(
      applications.map((a) => a.approved_pool_id).filter((id): id is string => Boolean(id))
    )
    const pools = allPartnerPools.filter((p) => approvedPoolIds.has(p.id))
    return NextResponse.json({ applications, pools })
  } catch (e) {
    console.error('[partners/nest-applications GET]', e)
    const msg = safeErrorMessage(e)
    if (msg.toLowerCase().includes('partner_nest_applications') || msg.includes('does not exist')) {
      return NextResponse.json(
        { error: 'Partner Nesting applications are not set up yet. Run migration 205.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * POST /api/partners/nest-applications — partner submits collection + optional reward token.
 */
export async function POST(request: NextRequest) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session

  const access = await requirePartnerOrAdmin(session.wallet)
  if (access instanceof NextResponse) return access

  try {
    const body = await request.json().catch(() => ({}))
    const rewardModeRaw =
      typeof body.reward_mode_requested === 'string' ? body.reward_mode_requested.trim() : 'platform_owl'
    const reward_mode_requested: PartnerNestRewardMode =
      rewardModeRaw === 'partner_token' ? 'partner_token' : 'platform_owl'

    let reward_mint: string | null =
      typeof body.reward_mint === 'string' ? body.reward_mint.trim() || null : null
    let reward_decimals: number | null =
      body.reward_decimals !== undefined && body.reward_decimals !== null && body.reward_decimals !== ''
        ? Number(body.reward_decimals)
        : null

    if (reward_mode_requested === 'partner_token') {
      if (!reward_mint || !isProbableSolanaPubkey(reward_mint)) {
        return NextResponse.json(
          { error: 'Reward token mint is required and must be a Solana public key.' },
          { status: 400 }
        )
      }
      const resolved = await resolveSplMintOnChain(reward_mint)
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: 400 })
      }
      reward_mint = resolved.mint.mint
      // Prefer on-chain decimals; ignore a mismatched client value.
      reward_decimals = resolved.mint.decimals
    }

    const nftLockStandard =
      typeof body.nft_lock_standard === 'string' ? body.nft_lock_standard : 'database_only'
    const locked =
      nftLockStandard === 'database_only'
        ? false
        : body.locked === undefined
          ? false
          : Boolean(body.locked)

    const application = await insertPartnerNestApplication({
      creator_wallet: session.wallet,
      collection_key: typeof body.collection_key === 'string' ? body.collection_key : '',
      pool_name: typeof body.pool_name === 'string' ? body.pool_name : null,
      partner_slug: typeof body.partner_slug === 'string' ? body.partner_slug : null,
      locked,
      max_lock_days:
        locked && body.max_lock_days !== undefined ? Number(body.max_lock_days) : locked ? 90 : 0,
      min_lock_days:
        locked && body.min_lock_days !== undefined ? Number(body.min_lock_days) : locked ? 30 : 0,
      nft_lock_standard: nftLockStandard,
      reward_mode_requested,
      reward_token_symbol:
        typeof body.reward_token_symbol === 'string' ? body.reward_token_symbol : null,
      reward_mint,
      reward_decimals,
      reward_rate: body.reward_rate !== undefined ? Number(body.reward_rate) : 1,
      notes: typeof body.notes === 'string' ? body.notes : null,
    })

    return NextResponse.json({ application }, { status: 201 })
  } catch (e) {
    console.error('[partners/nest-applications POST]', e)
    const msg = safeErrorMessage(e)
    if (msg.toLowerCase().includes('partner_nest_applications') || msg.includes('does not exist')) {
      return NextResponse.json(
        { error: 'Partner Nesting applications are not set up yet. Run migration 205.' },
        { status: 503 }
      )
    }
    if (
      msg.toLowerCase().includes('required') ||
      msg.toLowerCase().includes('must be') ||
      msg.toLowerCase().includes('invalid') ||
      msg.toLowerCase().includes('does not look') ||
      msg.toLowerCase().includes('only active')
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

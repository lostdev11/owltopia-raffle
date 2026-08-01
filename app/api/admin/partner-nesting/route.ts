import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  insertStakingPool,
  listPartnerStakingPoolsAdmin,
  type NftLockStandard,
} from '@/lib/db/staking-pools'
import {
  getPartnerCommunityCreatorByWallet,
  listPartnerCommunityCreatorsAdmin,
} from '@/lib/db/partner-community-creators-admin'
import { getDisplayNamesByWallets } from '@/lib/db/wallet-profiles'
import { isNftLockStandard } from '@/lib/nesting/nft-lock/types'
import { validatePoolAgainstNestingEmissionPolicy } from '@/lib/nesting/policy'
import {
  buildPartnerNestPoolPayload,
  partnerSlugFromLabel,
  validatePartnerNestCreateInput,
} from '@/lib/nesting/partner-nest-pool'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/partner-nesting — partners + existing partner-tagged nest pools.
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const [creators, pools] = await Promise.all([
      listPartnerCommunityCreatorsAdmin(),
      listPartnerStakingPoolsAdmin(),
    ])
    const wallets = creators.map((c) => c.creator_wallet).filter(Boolean)
    const profileNames = await getDisplayNamesByWallets(wallets)
    const partners = creators.map((c) => {
      const profile = profileNames[c.creator_wallet]?.trim() || null
      const label = c.display_label?.trim() || profile || c.creator_wallet.slice(0, 8)
      return {
        ...c,
        profile_display_name: profile,
        suggested_partner_slug: partnerSlugFromLabel(label, c.creator_wallet),
        suggested_pool_name: `${label} Nest`,
      }
    })

    return NextResponse.json({ partners, pools })
  } catch (e) {
    console.error('[admin/partner-nesting GET]', e)
    const msg = safeErrorMessage(e)
    if (msg.toLowerCase().includes('partner_community') || msg.includes('does not exist')) {
      return NextResponse.json(
        { error: 'Partner creators table missing. Run partner community migrations first.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * POST /api/admin/partner-nesting — create an NFT nest perch for a partner collection.
 * Body: {
 *   creator_wallet, collection_key,
 *   pool_name?, partner_slug?, locked?, max_lock_days?, min_lock_days?, nft_lock_standard?
 * }
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => null)
    const creatorWallet = normalizeSolanaWalletAddress(
      typeof body?.creator_wallet === 'string' ? body.creator_wallet : ''
    )
    if (!creatorWallet) {
      return NextResponse.json({ error: 'creator_wallet must be a valid Solana address' }, { status: 400 })
    }

    const partner = await getPartnerCommunityCreatorByWallet(creatorWallet)
    if (!partner) {
      return NextResponse.json(
        {
          error:
            'Wallet is not on the partner creators allowlist. Add them under Partner program creators first.',
        },
        { status: 400 }
      )
    }
    if (!partner.is_active) {
      return NextResponse.json(
        { error: 'Partner creator is inactive. Reactivate them before creating a nest perch.' },
        { status: 400 }
      )
    }

    const profileNames = await getDisplayNamesByWallets([creatorWallet])
    const profile = profileNames[creatorWallet]?.trim() || null
    const partnerLabel =
      partner.display_label?.trim() || profile || creatorWallet.slice(0, 8)

    const nftLockStandardRaw = body?.nft_lock_standard
    const nftLockStandard: NftLockStandard =
      nftLockStandardRaw !== undefined && isNftLockStandard(nftLockStandardRaw)
        ? nftLockStandardRaw
        : 'database_only'

    const locked =
      nftLockStandard === 'database_only'
        ? false
        : body?.locked === undefined
          ? false
          : body.locked === true || body.locked === 'true'
    const maxLockDays =
      body?.max_lock_days !== undefined && body?.max_lock_days !== null && body?.max_lock_days !== ''
        ? Number(body.max_lock_days)
        : undefined
    const minLockDays =
      body?.min_lock_days !== undefined && body?.min_lock_days !== null && body?.min_lock_days !== ''
        ? Number(body.min_lock_days)
        : undefined

    const createInput = {
      partnerLabel,
      partnerSlug:
        typeof body?.partner_slug === 'string' && body.partner_slug.trim()
          ? body.partner_slug
          : partnerSlugFromLabel(partnerLabel, creatorWallet),
      collectionMint: typeof body?.collection_key === 'string' ? body.collection_key : '',
      poolName: typeof body?.pool_name === 'string' ? body.pool_name : null,
      locked,
      maxLockDays,
      minLockDays,
      nftLockStandard,
    }

    const validationError = validatePartnerNestCreateInput(createInput)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const payload = buildPartnerNestPoolPayload(createInput)

    validatePoolAgainstNestingEmissionPolicy({
      asset_type: payload.asset_type,
      reward_token: payload.reward_token,
      reward_rate: payload.reward_rate,
      reward_rate_unit: payload.reward_rate_unit,
      partner_project_slug: payload.partner_project_slug,
      reward_mint: payload.reward_mint,
    })

    const pool = await insertStakingPool({
      ...payload,
      created_by: session.wallet,
    })

    return NextResponse.json({
      pool,
      partner: {
        creator_wallet: partner.creator_wallet,
        display_label: partner.display_label,
        partner_tier: partner.partner_tier,
      },
      next_steps:
        nftLockStandard === 'database_only'
          ? [
              'Soft nest: no freeze — holders keep transferable NFTs; rewards require continued ownership.',
              'Ask a holder to open Nesting and verify their NFTs appear for this perch.',
              'Confirm stake / claim / unstake with the 0.001 SOL platform fee when enabled.',
            ]
          : [
              'Confirm freeze authority / lock standard matches this collection (Core vs SPL).',
              'Run nesting freeze-readiness for a sample mint from the collection.',
              'Ask a holder to open Nesting and verify their NFTs appear for this perch.',
            ],
    })
  } catch (e) {
    console.error('[admin/partner-nesting POST]', e)
    const msg = safeErrorMessage(e)
    if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
      return NextResponse.json(
        { error: 'A pool with this slug already exists. Change the pool name and try again.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

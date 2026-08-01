/**
 * Partner Nesting pool payload + application validation helpers.
 * Run: npx tsx scripts/test-partner-nest-pool.ts
 */
import assert from 'node:assert/strict'
import {
  buildPartnerNestPoolPayload,
  isPartnerStakingPool,
  partnerSlugFromLabel,
  validatePartnerNestCreateInput,
} from '../lib/nesting/partner-nest-pool'
import { validatePartnerNestApplicationInput } from '../lib/db/partner-nest-applications'
import { validatePoolAgainstNestingEmissionPolicy } from '../lib/nesting/policy'
import { resolveRewardClaimRecording } from '../lib/nesting/reward-claim-record'
import { StakingUserError } from '../lib/nesting/errors'
import { isPartnerTokenRewardPool } from '../lib/nesting/partner-reward-vault'
import { partnerRewardAvailableUi } from '../lib/db/staking-pools'
import { resolveSplMintOnChain } from '../lib/solana/resolve-spl-mint'

async function main() {
  assert.equal(partnerSlugFromLabel('Misfits DAO'), 'misfits-dao')
  assert.equal(partnerSlugFromLabel('  '), 'partner')
  assert.equal(partnerSlugFromLabel('', 'AbCdEfGh123'), 'partner-abcdefgh')

  assert.equal(
    validatePartnerNestCreateInput({
      partnerLabel: 'Misfits',
      collectionMint: 'not-a-key',
    }),
    'Collection address does not look like a Solana public key.'
  )

  assert.equal(
    validatePartnerNestCreateInput({
      partnerLabel: 'Misfits',
      collectionMint: 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB',
      nftLockStandard: 'database_only',
      locked: true,
    }),
    'Soft nests (database_only) cannot use a freeze lock period.'
  )

  assert.equal(
    validatePartnerNestCreateInput({
      partnerLabel: 'Misfits',
      collectionMint: 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB',
      nftLockStandard: 'database_only',
    }),
    null
  )

  const softPayload = buildPartnerNestPoolPayload({
    partnerLabel: 'Undead Sols',
    collectionMint: 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB',
    nftLockStandard: 'database_only',
    locked: false,
  })
  assert.equal(softPayload.nft_lock_standard, 'database_only')
  assert.equal(softPayload.lock_period_days, 0)
  assert.equal(softPayload.adapter_mode, 'mock')
  assert.equal(softPayload.lock_enforcement_source, 'database')
  assert.equal(softPayload.is_onchain_enabled, false)

  assert.equal(
    validatePartnerNestCreateInput({
      partnerLabel: 'Misfits',
      collectionMint: 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB',
      locked: true,
      minLockDays: 90,
      maxLockDays: 30,
      nftLockStandard: 'auto',
    }),
    'Minimum lock days cannot be greater than maximum lock days.'
  )

  const payload = buildPartnerNestPoolPayload({
    partnerLabel: 'Misfits',
    collectionMint: 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB',
    locked: true,
    maxLockDays: 90,
    minLockDays: 30,
    nftLockStandard: 'mpl_core_freeze_delegate',
  })

  assert.equal(payload.asset_type, 'nft')
  assert.equal(payload.collection_key, 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB')
  assert.equal(payload.partner_project_slug, 'misfits')
  assert.equal(payload.reward_token, 'OWL')
  assert.equal(payload.reward_mint, null)
  assert.equal(payload.reward_rate, 1)
  assert.equal(payload.reward_rate_unit, 'daily')
  assert.equal(payload.lock_period_days, 90)
  assert.equal(payload.nft_lock_standard, 'mpl_core_freeze_delegate')
  assert.equal(payload.adapter_mode, 'onchain_enabled')
  assert.equal(payload.is_onchain_enabled, true)
  assert.ok(payload.slug.includes('misfits'))
  assert.ok(payload.name.toLowerCase().includes('misfits'))

  const partnerTokenPayload = buildPartnerNestPoolPayload({
    partnerLabel: 'Misfits',
    collectionMint: 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB',
    rewardMode: 'partner_token',
    rewardTokenSymbol: 'MISFIT',
    rewardMint: 'So11111111111111111111111111111111111111112',
    rewardRate: 2,
    nftLockStandard: 'mpl_core_freeze_delegate',
    locked: true,
    maxLockDays: 90,
    minLockDays: 30,
  })
  assert.equal(partnerTokenPayload.reward_token, 'MISFIT')
  assert.equal(partnerTokenPayload.reward_mint, 'So11111111111111111111111111111111111111112')
  assert.equal(partnerTokenPayload.reward_rate, 2)

  validatePoolAgainstNestingEmissionPolicy({
    asset_type: 'nft',
    reward_token: 'MISFIT',
    reward_rate: 2,
    reward_rate_unit: 'daily',
    partner_project_slug: 'misfits',
    reward_mint: 'So11111111111111111111111111111111111111112',
  })

  let blocked = false
  try {
    validatePoolAgainstNestingEmissionPolicy({
      asset_type: 'nft',
      reward_token: 'MISFIT',
      reward_rate: 2,
      reward_rate_unit: 'daily',
    })
  } catch (e) {
    blocked = e instanceof StakingUserError
  }
  assert.equal(blocked, true)

  assert.equal(
    validatePartnerNestApplicationInput({
      collection_key: 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB',
      reward_mode_requested: 'partner_token',
    }),
    'Partner reward token mint is required when requesting partner_token rewards.'
  )

  assert.equal(
    validatePartnerNestApplicationInput({
      collection_key: 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB',
      reward_mode_requested: 'partner_token',
      reward_mint: 'So11111111111111111111111111111111111111112',
      reward_token_symbol: 'MISFIT',
      reward_decimals: 9,
    }),
    null
  )

  let claimBlocked = false
  try {
    resolveRewardClaimRecording({
      poolRewardToken: 'MISFIT',
      transfer: { kind: 'skipped', reason: 'not_owl_token_rewards' },
      claimAmountUi: 1,
    })
  } catch (e) {
    claimBlocked = e instanceof StakingUserError
  }
  assert.equal(claimBlocked, true)

  assert.equal(isPartnerStakingPool({ partner_project_slug: 'misfits' }), true)
  assert.equal(isPartnerStakingPool({ partner_project_slug: null }), false)

  assert.equal(
    isPartnerTokenRewardPool({
      reward_token: 'MISFIT',
      reward_mint: 'So11111111111111111111111111111111111111112',
      partner_project_slug: 'misfits',
    }),
    true
  )
  assert.equal(
    isPartnerTokenRewardPool({
      reward_token: 'OWL',
      reward_mint: null,
      partner_project_slug: 'misfits',
    }),
    false
  )

  assert.equal(
    partnerRewardAvailableUi({ partner_reward_funded: 100, partner_reward_paid: 40 }),
    60
  )

  const badMint = await resolveSplMintOnChain('not-a-mint')
  assert.equal(badMint.ok, false)
  if (!badMint.ok) {
    assert.match(badMint.error, /public key|Solana/i)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        partnerNestPool: true,
        partnerSoftNest: true,
        partnerRewardToken: true,
        partnerRewardDeposit: true,
        rewardMintValidation: true,
      },
      null,
      2
    )
  )
}

void main()

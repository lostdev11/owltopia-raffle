/**
 * Claim all: deadline stop, resume, fee linking, bulk lock chunking, stale guard, ordering.
 * Run: npx tsx scripts/test-claim-all-deadline-resume.ts
 */
import assert from 'node:assert/strict'
import {
  claimAllExecutionDeadlineMs,
  shouldStopClaimAllBatchesForDeadline,
  CLAIM_ALL_DEADLINE_BUFFER_MS,
  CLAIM_ALL_ROUTE_MAX_DURATION_SEC,
} from '../lib/nesting/claim-all-deadline'
import {
  issueClaimAllEligibilityToken,
  verifyClaimAllEligibilityToken,
  CLAIM_ALL_ELIGIBILITY_TTL_MS,
} from '../lib/nesting/claim-all-eligibility'
import { buildOwlClaimPlansForPositions, buildFullPositionClaimPlan } from '../lib/nesting/claim-plan'
import type { StakingPositionRow } from '../lib/db/staking-positions'
import {
  CLAIM_FEE_RECOVERY_MAX_PAGES,
  CLAIM_FEE_RECOVERY_PAGE_SIZE,
} from '../lib/nesting/find-reusable-claim-platform-fee'
import { shouldShowClaimAllClosePageMessage } from '../lib/nesting/claim-all-ui-copy'
import { claimAllJobToPublicView } from '../lib/nesting/claim-all-job-runner'
import type { StakingClaimAllJobRow } from '../lib/db/staking-claim-all-jobs'
import {
  CLAIM_ALL_JOB_LOCK_STALE_MS,
  isClaimAllJobEligibleForCronQueue,
  isClaimAllJobLockHeldByAnotherWorker,
  resolveClaimAllInvocationStartedAtMs,
  shouldSkipClaimAllJobCronTickForInvocationDeadline,
} from '../lib/nesting/claim-all-job-scheduling'
import { splitClaimAllPlansIntoPayableBatches } from '../lib/nesting/claim-all-batch-planning'
import { meetsMinOwlClaimThreshold } from '../lib/staking/rewards'
import { NESTING_CLAIM_ALL_FETCH_TIMEOUT_MS } from '../lib/nesting/fetch-json'

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-32chars-min!!'

// Deadline stops before the final buffer window.
{
  const start = 1_000_000
  const deadline = claimAllExecutionDeadlineMs(start)
  assert.equal(deadline, start + CLAIM_ALL_ROUTE_MAX_DURATION_SEC * 1000)
  assert.equal(shouldStopClaimAllBatchesForDeadline(deadline, deadline - CLAIM_ALL_DEADLINE_BUFFER_MS), false)
  assert.equal(shouldStopClaimAllBatchesForDeadline(deadline, deadline - CLAIM_ALL_DEADLINE_BUFFER_MS + 1), true)
}

// Eligibility token round-trip and expiry.
{
  const wallet = '4Fo8qRnCM6d1RtFRz69T9MzwnGxhVkb1n4EpfC1FGuaG'
  const token = issueClaimAllEligibilityToken({
    wallet,
    eligiblePositionIds: [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ],
    feeUnits: 2,
    expiresAtMs: Date.now() + 60_000,
  })
  const parsed = verifyClaimAllEligibilityToken(token, wallet)
  assert.ok(parsed)
  assert.equal(parsed!.p.length, 2)
  assert.equal(parsed!.feeUnits, 2)
  const expired = issueClaimAllEligibilityToken({
    wallet,
    eligiblePositionIds: ['11111111-1111-4111-8111-111111111111'],
    feeUnits: 1,
    expiresAtMs: Date.now() - 1,
  })
  assert.equal(verifyClaimAllEligibilityToken(expired, wallet), null)
  assert.ok(CLAIM_ALL_ELIGIBILITY_TTL_MS >= 60_000)
}

// Largest pending nests first in Claim-all plans.
{
  const AS_OF_MS = Date.UTC(2026, 4, 19, 12, 0, 0)
  const mockOwlNest = (params: {
    id: string
    amount: number
    claimedRewards: number
  }): StakingPositionRow => {
    const stakedAt = new Date(AS_OF_MS - 30 * 86_400_000).toISOString()
    return {
      id: params.id,
      wallet_address: 'AnyWallet1111111111111111111111111111111111',
      pool_id: 'pool-1',
      asset_identifier: `mint-${params.id}`,
      amount: params.amount,
      reward_rate_snapshot: 1,
      reward_rate_unit_snapshot: 'daily',
      reward_token_snapshot: 'OWL',
      staked_at: stakedAt,
      unlock_at: null,
      unstaked_at: null,
      claimed_rewards: params.claimedRewards,
      status: 'active',
      created_at: stakedAt,
      updated_at: stakedAt,
    }
  }

  const plans = buildOwlClaimPlansForPositions(
    [mockOwlNest({ id: 'small', amount: 1, claimedRewards: 0 }), mockOwlNest({ id: 'big', amount: 50, claimedRewards: 0 })],
    AS_OF_MS,
    { forClaimAll: true }
  )
  assert.equal(plans.length, 2)
  assert.equal(plans[0]!.positionId, 'big')
  assert.ok(plans[0]!.payoutAmount > plans[1]!.payoutAmount)
}

// Fee recovery pagination constants (wallet-poisoning dust).
{
  assert.ok(CLAIM_FEE_RECOVERY_PAGE_SIZE >= 20)
  assert.ok(CLAIM_FEE_RECOVERY_MAX_PAGES * CLAIM_FEE_RECOVERY_PAGE_SIZE >= 800)
}

// Partial resume: stop when less than the buffer remains before the route deadline.
{
  const deadline = Date.now() + 20_000
  assert.equal(shouldStopClaimAllBatchesForDeadline(deadline, deadline - 14_000), true)
  assert.equal(shouldStopClaimAllBatchesForDeadline(deadline, deadline - 16_000), false)
}

// Close-page copy only after fee (not during wallet signature) and when a background job exists.
{
  assert.equal(
    shouldShowClaimAllClosePageMessage({
      phase: 'awaiting_wallet_signature',
      hasActiveBackgroundJob: true,
    }),
    false
  )
  assert.equal(
    shouldShowClaimAllClosePageMessage({ phase: 'submitting', hasActiveBackgroundJob: true }),
    true
  )
  assert.equal(
    shouldShowClaimAllClosePageMessage({ phase: 'submitting', hasActiveBackgroundJob: false }),
    false
  )
}

// Invocation deadline is pinned on the job and reused by after()/cron (not reset each tick).
{
  const pinned = 9_000_000
  const job = { invocation_started_at_ms: pinned }
  assert.equal(resolveClaimAllInvocationStartedAtMs(job, Date.now()), pinned)
  assert.equal(resolveClaimAllInvocationStartedAtMs({ invocation_started_at_ms: null }, pinned), pinned)
  const deadline = claimAllExecutionDeadlineMs(pinned)
  assert.equal(
    shouldSkipClaimAllJobCronTickForInvocationDeadline(
      { invocation_started_at_ms: pinned },
      deadline - CLAIM_ALL_DEADLINE_BUFFER_MS + 1
    ),
    true
  )
  assert.equal(
    shouldSkipClaimAllJobCronTickForInvocationDeadline(
      { invocation_started_at_ms: pinned },
      deadline - CLAIM_ALL_DEADLINE_BUFFER_MS - 1
    ),
    false
  )
}

// Live lock (~285s tick) must not be stealable at 180s; 330s stale window blocks cron.
{
  const now = Date.UTC(2026, 8, 26, 12, 0, 0)
  const lockedAt = new Date(now - 200_000).toISOString()
  assert.equal(
    isClaimAllJobLockHeldByAnotherWorker({ locked_at: lockedAt, lock_owner: 'worker-a' }, 'worker-b', now, 180_000),
    false
  )
  assert.equal(
    isClaimAllJobLockHeldByAnotherWorker({ locked_at: lockedAt, lock_owner: 'worker-a' }, 'worker-b', now, CLAIM_ALL_JOB_LOCK_STALE_MS),
    true
  )
  assert.ok(CLAIM_ALL_JOB_LOCK_STALE_MS >= 330_000)
}

// Cron skips jobs under invocation deadline margin and while lock is fresh.
{
  const now = Date.now()
  const invocation = now - (CLAIM_ALL_ROUTE_MAX_DURATION_SEC - 10) * 1000
  const nearDeadlineJob = {
    invocation_started_at_ms: invocation,
    pending_position_ids: ['a'],
    attempt_count: 0,
    max_attempts: 48,
    locked_at: null,
    lock_owner: null,
  }
  assert.equal(isClaimAllJobEligibleForCronQueue(nearDeadlineJob, now), false)
}

// Re-read from DB: nest already claimed by another worker yields no batch plan (no double pay).
{
  const AS_OF_MS = Date.UTC(2026, 4, 19, 12, 0, 0)
  const stakedAt = new Date(AS_OF_MS - 30 * 86_400_000).toISOString()
  const row: StakingPositionRow = {
    id: 'nest-1',
    wallet_address: 'Wallet1111111111111111111111111111111111',
    pool_id: 'pool-1',
    asset_identifier: 'mint-1',
    amount: 100,
    reward_rate_snapshot: 1,
    reward_rate_unit_snapshot: 'daily',
    reward_token_snapshot: 'OWL',
    staked_at: stakedAt,
    unlock_at: null,
    unstaked_at: null,
    claimed_rewards: 0,
    status: 'active',
    created_at: stakedAt,
    updated_at: stakedAt,
  }
  const plan = buildFullPositionClaimPlan(row, AS_OF_MS, { forClaimAll: true })
  assert.ok(plan && plan.payoutAmount > 0)
  row.claimed_rewards = plan!.newClaimedTotal
  assert.equal(buildFullPositionClaimPlan(row, AS_OF_MS, { forClaimAll: true }), null)
}

// Cron/admin job view exposes pending work for server-side resume (no browser required).
{
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    wallet_address: '4Fo8qRnCM6d1RtFRz69T9MzwnGxhVkb1n4EpfC1FGuaG',
    platform_fee_signature: 'sig',
    pool_id: '22222222-2222-4222-8222-222222222222',
    status: 'processing' as const,
    pending_position_ids: ['a', 'b'],
    completed_position_ids: ['c'],
    fee_units: 3,
    claim_all_eligibility_token: null,
    total_claimed_ui: 10,
    batches_completed: 1,
    batch_count_estimate: 2,
    attempt_count: 1,
    max_attempts: 48,
    last_error: null,
    lock_owner: 'cron',
    locked_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    invocation_started_at_ms: null,
  } satisfies StakingClaimAllJobRow
  const view = claimAllJobToPublicView(row)
  assert.equal(view.claim_all_complete, false)
  assert.equal(view.pending_nest_count, 2)
}

// Dust tail under 1 OWL must not fail Claim all after main batches pay out.
{
  const mk = (id: string, payoutAmount: number) => ({
    positionId: id,
    payoutAmount,
    newClaimedTotal: payoutAmount,
    claimableNow: payoutAmount,
    expectedClaimedRewards: 0,
  })
  const plans = [...Array(25).keys()].map((i) => mk(`big-${i}`, 2))
  plans.push(...[...Array(10).keys()].map((i) => mk(`dust-${i}`, 0.05)))
  const split = splitClaimAllPlansIntoPayableBatches(plans, 25)
  assert.equal(split.payableChunks.length, 1)
  assert.equal(split.skippedBelowMinimum.length, 10)
  assert.ok(meetsMinOwlClaimThreshold(split.payableChunks[0]!.reduce((s, p) => s + p.payoutAmount, 0)))
}

// Browser preview budget: defer on-chain lock verify so 250+ nests stay under ~115s client timeout.
{
  assert.equal(NESTING_CLAIM_ALL_FETCH_TIMEOUT_MS, 115_000)
  assert.ok(
    NESTING_CLAIM_ALL_FETCH_TIMEOUT_MS < CLAIM_ALL_ROUTE_MAX_DURATION_SEC * 1000,
    'preview uses a shorter client timeout than server maxDuration'
  )
}

console.log('test-claim-all-deadline-resume: ok')

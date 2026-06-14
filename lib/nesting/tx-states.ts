/**
 * Staking / nesting UI execution phases (client).
 * - `db_mock` path: preparing → submitting → syncing (no on-chain program yet).
 * - Future: insert awaiting_wallet_signature / confirming between submit and sync.
 */

export type NestingTxPhase =
  | 'idle'
  | 'preparing'
  | 'awaiting_wallet_signature'
  | 'submitting'
  | 'confirming'
  | 'syncing'
  | 'failed'

export type StakingExecutionPath = 'database_mock' | 'onchain_transaction'

/** Shipped on successful POST /api/me/staking/* for client hints (optional on client). */
export type StakingExecutionMeta = {
  path: StakingExecutionPath
}

const PHASE_LABEL: Record<NestingTxPhase, string> = {
  idle: '',
  preparing: 'Getting your nest ready…',
  awaiting_wallet_signature: 'Approve nest lock and platform fee in your wallet…',
  submitting: 'Confirming your nest…',
  confirming: 'Almost nested…',
  syncing: 'Finalizing your nest…',
  failed: 'That did not work—give it another try',
}

const CLAIM_PHASE_LABEL: Record<NestingTxPhase, string> = {
  idle: '',
  preparing: 'Processing your claim…',
  awaiting_wallet_signature: 'Approve in your wallet to finish claiming…',
  submitting: 'Sending OWL to your wallet…',
  confirming: 'Confirming payout…',
  syncing: 'Updating your balance…',
  failed: 'Claim failed — try again',
}

export type NestingTxPhaseLabelContext = 'default' | 'claim'

export function nestingTxPhaseLabel(
  phase: NestingTxPhase,
  context: NestingTxPhaseLabelContext = 'default'
): string {
  if (context === 'claim') {
    return CLAIM_PHASE_LABEL[phase] ?? phase
  }
  return PHASE_LABEL[phase] ?? phase
}

const IN_FLIGHT_PHASES: ReadonlySet<NestingTxPhase> = new Set([
  'preparing',
  'awaiting_wallet_signature',
  'submitting',
  'confirming',
  'syncing',
])

/** True while a wallet/API action is actively running (not idle or failed). */
export function isNestingTxPhaseInFlight(phase: NestingTxPhase): boolean {
  return IN_FLIGHT_PHASES.has(phase)
}

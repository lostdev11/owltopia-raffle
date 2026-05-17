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
  preparing: 'Getting things cozy…',
  awaiting_wallet_signature: 'Pop open your wallet and approve…',
  submitting: 'Sending it off…',
  confirming: 'Almost done…',
  syncing: 'Updating your nest…',
  failed: 'That did not work—give it another try',
}

export function nestingTxPhaseLabel(phase: NestingTxPhase): string {
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

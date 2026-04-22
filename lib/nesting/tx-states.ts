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
  preparing: 'Preparing…',
  awaiting_wallet_signature: 'Confirm in your wallet…',
  submitting: 'Submitting…',
  confirming: 'Confirming on-chain…',
  syncing: 'Syncing your nest…',
  failed: 'Action failed',
}

export function nestingTxPhaseLabel(phase: NestingTxPhase): string {
  return PHASE_LABEL[phase] ?? phase
}

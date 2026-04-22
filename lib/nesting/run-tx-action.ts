import type { NestingTxPhase } from '@/lib/nesting/tx-states'

export type RunNestingTxActionParams<T> = {
  onPhase: (phase: NestingTxPhase) => void
  /** Server call or wallet broadcast (e.g. fetch, sendTransaction). */
  execute: () => Promise<T>
  /** After success: refresh Supabase read model, confirm signature, etc. */
  afterSuccess?: () => Promise<void>
  /**
   * If set, runs after `preparing` and sets `awaiting_wallet_signature` (e.g. signTransaction).
   * Omit for DB-mock / SIWS-only flows to avoid a wallet popup step.
   */
  signStep?: () => Promise<void>
}

let microDelay = (): Promise<void> => Promise.resolve()

if (typeof queueMicrotask === 'function') {
  microDelay = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()))
} else {
  microDelay = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/**
 * One staking action shell: local prep → optional wallet sign → submit → post-success sync.
 * Rethrows `execute` errors; caller sets user-facing `actionError`. Always returns phase to `idle` on end.
 */
export async function runNestingTxAction<T>(params: RunNestingTxActionParams<T>): Promise<T> {
  const { onPhase, execute, afterSuccess, signStep } = params
  try {
    onPhase('preparing')
    await microDelay()
    if (signStep) {
      onPhase('awaiting_wallet_signature')
      await signStep()
    }
    onPhase('submitting')
    const result = await execute()
    onPhase('syncing')
    if (afterSuccess) {
      await afterSuccess()
    }
    onPhase('idle')
    return result
  } catch (e) {
    onPhase('failed')
    await microDelay()
    onPhase('idle')
    throw e
  }
}

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
  /** Skip the brief preparing step (e.g. OWL claim POST has no local prep). */
  skipPreparing?: boolean
  /**
   * NFT nest open manages preparing / wallet / sync phases inside `execute`.
   * Avoids the shell flashing `submitting` over those steps.
   */
  phasesOwnedByExecute?: boolean
  /** When aborted, phases return to `idle` without flashing `failed`. */
  signal?: AbortSignal
}

export function throwIfNestingAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

function isAbortError(e: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true
  if (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') return true
  return e instanceof Error && e.name === 'AbortError'
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
  const { onPhase, execute, afterSuccess, signStep, skipPreparing, phasesOwnedByExecute, signal } =
    params
  try {
    throwIfNestingAborted(signal)
    if (phasesOwnedByExecute) {
      const result = await execute()
      throwIfNestingAborted(signal)
      onPhase('syncing')
      if (afterSuccess) {
        await afterSuccess()
      }
      throwIfNestingAborted(signal)
      onPhase('idle')
      return result
    }
    if (!skipPreparing) {
      onPhase('preparing')
      await microDelay()
      throwIfNestingAborted(signal)
    }
    if (signStep) {
      onPhase('awaiting_wallet_signature')
      await signStep()
      throwIfNestingAborted(signal)
    }
    onPhase('submitting')
    const result = await execute()
    throwIfNestingAborted(signal)
    onPhase('syncing')
    if (afterSuccess) {
      await afterSuccess()
    }
    throwIfNestingAborted(signal)
    onPhase('idle')
    return result
  } catch (e) {
    if (!isAbortError(e, signal)) {
      onPhase('failed')
      await microDelay()
    }
    onPhase('idle')
    throw e
  }
}

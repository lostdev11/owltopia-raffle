import type { Connection, Transaction } from '@solana/web3.js'
import { VersionedTransaction } from '@solana/web3.js'

import { candyGuardSimulationLooksLikeBotTax } from '@/lib/solana/candy-guard-bot-tax'

export const DEFAULT_PHANTOM_PRESIM_FAIL_PREFIX =
  'Transaction would fail on-chain before wallet approval.'

/** Stuck simulateTransaction must not block the wallet approve popup. */
export const PHANTOM_PRESIM_TIMEOUT_MS = 8_000

export class PhantomPresimulateError extends Error {
  readonly name = 'PhantomPresimulateError'
  constructor(message: string) {
    super(message)
  }
}

export function isPhantomPresimulateError(err: unknown): err is PhantomPresimulateError {
  return err instanceof PhantomPresimulateError
}

export type PhantomPresimulateOptions = {
  /**
   * Prefix for the thrown error when simulation returns `err`.
   * Keep product-specific (e.g. escrow deposit vs generic send).
   */
  failMessagePrefix?: string
  /**
   * When true (default), RPC/simulate transport failures do not block the wallet prompt.
   * On-chain simulation errors (`sim.value.err`) always throw.
   */
  ignoreRpcErrors?: boolean
  /** Override default simulate timeout (ms). */
  timeoutMs?: number
  /**
   * Candy Guard `botTax` leaves `sim.value.err` null while still minting nothing and charging
   * fees. When true, reject simulations whose logs show bot-tax / guard rejection markers.
   */
  rejectCandyGuardBotTax?: boolean
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('presimulate-timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

/**
 * Phantom guidance: simulate with `sigVerify: false` before the wallet prompt so
 * transactions that would fail on-chain do not surface as
 * "This dApp could be malicious" simulation warnings.
 *
 * @see https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings
 */
export async function assertTransactionSimulatesClean(
  connection: Connection,
  tx: Transaction | VersionedTransaction,
  options?: PhantomPresimulateOptions
): Promise<void> {
  const failPrefix = options?.failMessagePrefix ?? DEFAULT_PHANTOM_PRESIM_FAIL_PREFIX
  const ignoreRpcErrors = options?.ignoreRpcErrors !== false
  const timeoutMs = options?.timeoutMs ?? PHANTOM_PRESIM_TIMEOUT_MS

  try {
    // Prefer VersionedTransaction + SimulateTransactionConfig (sigVerify / replaceRecentBlockhash).
    if (tx instanceof VersionedTransaction) {
      const sim = await withTimeout(
        connection.simulateTransaction(tx, {
          sigVerify: false,
          commitment: 'confirmed',
          replaceRecentBlockhash: true,
        }),
        timeoutMs
      )
      if (sim.value.err) {
        const logs = (sim.value.logs ?? []).slice(-10).join('\n')
        throw new PhantomPresimulateError(`${failPrefix}${logs ? `\n${logs}` : ''}`)
      }
      assertNoCandyGuardBotTax(sim.value.logs, options, failPrefix)
      return
    }

    // Legacy Transaction: compile to a versioned message so sigVerify/replaceRecentBlockhash apply
    // the same way Phantom simulates it. Falls back to the older overload if compiling fails.
    const legacy = tx as Transaction
    let sim
    try {
      sim = await withTimeout(
        connection.simulateTransaction(new VersionedTransaction(legacy.compileMessage()), {
          sigVerify: false,
          commitment: 'confirmed',
          replaceRecentBlockhash: true,
        }),
        timeoutMs
      )
    } catch (e) {
      if (isPhantomPresimulateError(e)) throw e
      // compile/sim overload failed or timed out — try legacy overload once (also timed).
      sim = await withTimeout(connection.simulateTransaction(legacy), timeoutMs)
    }
    if (sim.value.err) {
      const logs = (sim.value.logs ?? []).slice(-10).join('\n')
      throw new PhantomPresimulateError(`${failPrefix}${logs ? `\n${logs}` : ''}`)
    }
    assertNoCandyGuardBotTax(sim.value.logs, options, failPrefix)
  } catch (e) {
    if (isPhantomPresimulateError(e)) throw e
    if (!ignoreRpcErrors) throw e
    // RPC / simulate flakiness or timeout must not block a valid Phantom signAndSend prompt.
  }
}

function assertNoCandyGuardBotTax(
  logs: string[] | null | undefined,
  options: PhantomPresimulateOptions | undefined,
  failPrefix: string
): void {
  if (!options?.rejectCandyGuardBotTax) return
  const reason = candyGuardSimulationLooksLikeBotTax(logs)
  if (!reason) return
  throw new PhantomPresimulateError(`${failPrefix} ${reason}`)
}

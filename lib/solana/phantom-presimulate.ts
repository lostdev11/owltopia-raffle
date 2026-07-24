import type { Connection, Transaction } from '@solana/web3.js'
import { VersionedTransaction } from '@solana/web3.js'

export const DEFAULT_PHANTOM_PRESIM_FAIL_PREFIX =
  'Transaction would fail on-chain before wallet approval.'

export class PhantomPresimulateError extends Error {
  readonly name = 'PhantomPresimulateError'
  constructor(message: string) {
    super(message)
  }
}

export function isPhantomPresimulateError(err: unknown): boolean {
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

  try {
    // Prefer VersionedTransaction + SimulateTransactionConfig (sigVerify / replaceRecentBlockhash).
    if (tx instanceof VersionedTransaction) {
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false,
        commitment: 'confirmed',
        replaceRecentBlockhash: true,
      })
      if (sim.value.err) {
        const logs = (sim.value.logs ?? []).slice(-10).join('\n')
        throw new PhantomPresimulateError(`${failPrefix}${logs ? `\n${logs}` : ''}`)
      }
      return
    }

    // Legacy Transaction: older overload — omit signers so the node skips signature verification.
    const sim = await connection.simulateTransaction(tx as Transaction)
    if (sim.value.err) {
      const logs = (sim.value.logs ?? []).slice(-10).join('\n')
      throw new PhantomPresimulateError(`${failPrefix}${logs ? `\n${logs}` : ''}`)
    }
  } catch (e) {
    if (isPhantomPresimulateError(e)) throw e
    if (!ignoreRpcErrors) throw e
    // RPC / simulate flakiness must not block a valid Phantom signAndSend prompt.
  }
}
